import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FEE_BPS,
  DEFAULT_FRONTEND_ID,
  factoryAbi,
  frontendRegistryAbi,
  predictionDurations,
  type DurationKey,
  type LocalDeployment,
  type MarketCategory,
} from "@updown/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const chainId = Number(process.env.CHAIN_ID ?? "31337");
const deployerPrivateKey = (process.env.DEPLOYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

const localChain = {
  ...foundry,
  id: chainId,
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
};

const account = privateKeyToAccount(deployerPrivateKey);
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: localChain, transport: http(rpcUrl) });

type LocalMarketTemplate = {
  category: MarketCategory;
  slug: string;
  icon: string;
  baseSymbol: string;
  quoteSymbol: string;
  eventTitle: string;
  question: string;
};

const localMarketTemplates: LocalMarketTemplate[] = [
  {
    category: "Crypto",
    slug: "btc-usdc",
    icon: "BTC",
    baseSymbol: "BTC",
    quoteSymbol: "USDC",
    eventTitle: "Bitcoin",
    question: "Will BTC finish higher than its lock price?",
  },
  {
    category: "Crypto",
    slug: "eth-usdc",
    icon: "ETH",
    baseSymbol: "ETH",
    quoteSymbol: "USDC",
    eventTitle: "Ethereum",
    question: "Will ETH finish higher than its lock price?",
  },
  {
    category: "Crypto",
    slug: "sol-usdc",
    icon: "SOL",
    baseSymbol: "SOL",
    quoteSymbol: "USDC",
    eventTitle: "Solana",
    question: "Will SOL finish higher than its lock price?",
  },
  {
    category: "DeFi",
    slug: "base-tvl",
    icon: "BASE",
    baseSymbol: "BASE TVL",
    quoteSymbol: "USDC",
    eventTitle: "Base DeFi TVL",
    question: "Will Base TVL index finish higher than lock?",
  },
  {
    category: "Sports",
    slug: "nba-total",
    icon: "NBA",
    baseSymbol: "NBA TOTAL",
    quoteSymbol: "USDC",
    eventTitle: "NBA Live Total",
    question: "Will the live total-points index finish higher than lock?",
  },
  {
    category: "Macro",
    slug: "fed-rate",
    icon: "FED",
    baseSymbol: "FED",
    quoteSymbol: "USDC",
    eventTitle: "Fed Rate Odds",
    question: "Will the rate-cut odds index finish higher than lock?",
  },
  {
    category: "AI",
    slug: "nvda-index",
    icon: "NVDA",
    baseSymbol: "NVDA",
    quoteSymbol: "USDC",
    eventTitle: "AI Compute Basket",
    question: "Will the AI compute index finish higher than lock?",
  },
];

type Artifact = {
  abi: Abi;
  bytecode: {
    object: Hex;
  };
};

async function artifact(contractName: string): Promise<Artifact> {
  const file = path.join(root, "packages/contracts/out", `${contractName}.sol`, `${contractName}.json`);
  return JSON.parse(await readFile(file, "utf8")) as Artifact;
}

async function deploy(contractName: string, args: readonly unknown[] = []): Promise<Address> {
  const item = await artifact(contractName);
  const hash = await walletClient.deployContract({
    abi: item.abi,
    bytecode: item.bytecode.object,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`No contract address for ${contractName}`);
  }
  console.log(`${contractName}: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function main() {
  const mockUSDC = await deploy("MockUSDC");
  const frontendRegistry = await deploy("FrontendRegistry");
  const mockTwapOracle = await deploy("MockTwapOracle");
  const predictionMarketFactory = await deploy("PredictionMarketFactory", [
    mockUSDC,
    mockTwapOracle,
    frontendRegistry,
    account.address,
    DEFAULT_FEE_BPS,
  ]);

  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: frontendRegistry,
      abi: frontendRegistryAbi,
      functionName: "registerFrontend",
      args: [DEFAULT_FRONTEND_ID, account.address, "local://default-frontend"],
    }),
  });

  const marketBlock = await publicClient.getBlock();
  const tradingOpenDelay = 120n;

  const markets: LocalDeployment["markets"] = [];
  for (const template of localMarketTemplates) {
    for (const [label, duration] of Object.entries(predictionDurations) as [DurationKey, bigint][]) {
      const assetSymbol = `${template.baseSymbol}/${template.quoteSymbol} ${label}`;
      const predictionStart = marketBlock.timestamp + duration + tradingOpenDelay;
      const hash = await walletClient.writeContract({
        address: predictionMarketFactory,
        abi: factoryAbi,
        functionName: "createMarket",
        args: [
          keccak256(toBytes(`${template.slug}/${label}`)),
          assetSymbol,
          predictionStart,
          duration,
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const [created] = parseEventLogs({
        abi: factoryAbi,
        eventName: "MarketCreated",
        logs: receipt.logs,
      });

      if (!created) throw new Error(`MarketCreated event missing for ${template.slug}/${label}`);

      markets.push({
        label,
        assetSymbol: created.args.assetSymbol,
        address: created.args.market,
        category: template.category,
        eventTitle: template.eventTitle,
        question: template.question,
        slug: template.slug,
        icon: template.icon,
        baseSymbol: template.baseSymbol,
        quoteSymbol: template.quoteSymbol,
        createdBlock: receipt.blockNumber.toString(),
        tradingStart: created.args.tradingStart.toString(),
        tradingEnd: created.args.tradingEnd.toString(),
        predictionStart: created.args.predictionStart.toString(),
        predictionEnd: created.args.predictionEnd.toString(),
        predictionDuration: created.args.predictionDuration.toString(),
      });

      console.log(`${template.slug} ${label} market: ${created.args.market}`);
    }
  }

  const deployment: LocalDeployment = {
    chainId,
    rpcUrl,
    deployer: account.address,
    feeVault: account.address,
    oracleKind: "mock",
    mockUSDC,
    frontendRegistry,
    mockTwapOracle,
    predictionMarketFactory,
    markets,
  };

  const deploymentDir = path.join(root, "packages/shared/src/deployments");
  await mkdir(deploymentDir, { recursive: true });
  await writeFile(path.join(deploymentDir, "localhost.json"), JSON.stringify(deployment, null, 2));

  await writeFile(
    path.join(root, "apps/web/.env.local"),
    [
      `NEXT_PUBLIC_CHAIN_ID=${chainId}`,
      `NEXT_PUBLIC_RPC_URL=${rpcUrl}`,
      `NEXT_PUBLIC_RELAYER_URL=http://localhost:8790`,
      `NEXT_PUBLIC_MOCK_USDC=${mockUSDC}`,
      `NEXT_PUBLIC_FACTORY=${predictionMarketFactory}`,
      `NEXT_PUBLIC_ORACLE=${mockTwapOracle}`,
      `NEXT_PUBLIC_DEFAULT_MARKET=${markets[0]?.address ?? ""}`,
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "apps/relayer/.env.local"),
    [
      `RPC_URL=${rpcUrl}`,
      `CHAIN_ID=${chainId}`,
      "PORT=8790",
      "CORS_ORIGIN=http://localhost:3000",
      `ALLOWED_MARKETS=${markets.map((market) => market.address).join(",")}`,
      "MAX_BET_AMOUNT_USDC=10000",
      "RATE_LIMIT_MAX=120",
      "RATE_LIMIT_WINDOW=1 minute",
      `RELAYER_PRIVATE_KEY=${deployerPrivateKey}`,
      "",
    ].join("\n"),
  );

  console.log("Deployment written to packages/shared/src/deployments/localhost.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
