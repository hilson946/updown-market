import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import {
  DEFAULT_FEE_BPS,
  DEFAULT_FRONTEND_ID,
  MAX_FEE_BPS,
  factoryAbi,
  frontendRegistryAbi,
  predictionDurations,
  uniswapV3TwapOracleAdapterAbi,
  type DurationKey,
  type LocalDeployment,
} from "@updown/shared";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnv({ path: ".env.deploy", override: true });
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const network = process.env.NETWORK ?? "base-sepolia";

const profiles = {
  "base-sepolia": {
    chainId: 84532,
    name: "Base Sepolia",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    explorer: "https://sepolia-explorer.base.org",
    uniswapV3Factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" as Address,
  },
  "base-mainnet": {
    chainId: 8453,
    name: "Base Mainnet",
    rpcEnv: "BASE_MAINNET_RPC_URL",
    explorer: "https://base.blockscout.com",
    uniswapV3Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address,
  },
} as const;

if (network !== "base-sepolia" && network !== "base-mainnet") {
  throw new Error("NETWORK must be base-sepolia or base-mainnet");
}

const profile = profiles[network];
const rpcUrl = process.env.RPC_URL ?? process.env[profile.rpcEnv];
if (!rpcUrl) {
  throw new Error(`Missing RPC_URL or ${profile.rpcEnv}`);
}

function requiredAddress(name: string): Address {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return getAddress(value);
}

function optionalAddress(name: string, fallback: Address): Address {
  const value = process.env[name];
  return value ? getAddress(value) : fallback;
}

function requiredPrivateKey(name: string): Hex {
  const value = process.env[name];
  if (!value?.startsWith("0x")) throw new Error(`Missing ${name}`);
  return value as Hex;
}

function parsePools(): Address[] {
  const raw = process.env.POOL_ADDRESSES;
  if (!raw) throw new Error("Missing POOL_ADDRESSES. Use Uniswap Info or factory.getPool to choose deep pools.");
  const pools = raw.split(",").map((item) => getAddress(item.trim()));
  if (pools.length === 0 || pools.length > 5) throw new Error("POOL_ADDRESSES must contain 1-5 pools");
  if (new Set(pools.map((pool) => pool.toLowerCase())).size !== pools.length) {
    throw new Error("POOL_ADDRESSES must not contain duplicates");
  }
  return pools;
}

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

const account = privateKeyToAccount(requiredPrivateKey("DEPLOYER_PRIVATE_KEY"));

const chain = {
  id: profile.chainId,
  name: profile.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "Base Explorer", url: profile.explorer } },
} as const;

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

async function deploy(contractName: string, args: readonly unknown[] = []): Promise<Address> {
  const item = await artifact(contractName);
  const hash = await walletClient.deployContract({
    abi: item.abi,
    bytecode: item.bytecode.object,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`No contract address for ${contractName}`);
  console.log(`${contractName}: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function main() {
  const connectedChainId = await publicClient.getChainId();
  if (connectedChainId !== profile.chainId) {
    throw new Error(`RPC chainId ${connectedChainId} does not match ${profile.name} (${profile.chainId})`);
  }

  const collateral = requiredAddress("COLLATERAL_ADDRESS");
  const feeVault = optionalAddress("FEE_VAULT", account.address);
  const baseToken = requiredAddress("BASE_TOKEN");
  const quoteToken = requiredAddress("QUOTE_TOKEN");
  const poolAddresses = parsePools();
  const frontendPayout = optionalAddress("FRONTEND_PAYOUT", account.address);
  const frontendId = BigInt(process.env.FRONTEND_ID ?? DEFAULT_FRONTEND_ID.toString());
  const feeBps = Number(process.env.FEE_BPS ?? DEFAULT_FEE_BPS);
  const twapWindow = Number(process.env.TWAP_WINDOW_SECONDS ?? "60");
  const minLiquidity = BigInt(process.env.MIN_POOL_LIQUIDITY ?? "1");
  const tradingStartDelay = BigInt(process.env.TRADING_START_DELAY_SECONDS ?? "900");
  const durationLabels = (process.env.MARKET_DURATIONS ?? "1m,5m,1h,1d")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as DurationKey[];

  for (const label of durationLabels) {
    if (!(label in predictionDurations)) throw new Error(`Unsupported MARKET_DURATIONS value: ${label}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new Error(`FEE_BPS must be an integer between 0 and ${MAX_FEE_BPS}`);
  }
  if (!Number.isInteger(twapWindow) || twapWindow < 10 || twapWindow > 86400) {
    throw new Error("TWAP_WINDOW_SECONDS must be an integer between 10 and 86400");
  }
  if (minLiquidity <= 0n) throw new Error("MIN_POOL_LIQUIDITY must be positive");

  const frontendRegistry = await deploy("FrontendRegistry");
  const oracleAdapter = await deploy("UniswapV3TwapOracleAdapter", [account.address]);
  const predictionMarketFactory = await deploy("PredictionMarketFactory", [
    collateral,
    oracleAdapter,
    frontendRegistry,
    feeVault,
    feeBps,
  ]);

  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: frontendRegistry,
      abi: frontendRegistryAbi,
      functionName: "registerFrontend",
      args: [frontendId, frontendPayout, `${network}://default-frontend`],
    }),
  });

  const block = await publicClient.getBlock();
  const markets: LocalDeployment["markets"] = [];

  for (const label of durationLabels) {
    const duration = predictionDurations[label];
    const predictionStart = block.timestamp + duration + tradingStartDelay;
    const hash = await walletClient.writeContract({
      address: predictionMarketFactory,
      abi: factoryAbi,
      functionName: "createMarket",
      args: [keccak256(toBytes(`${network}/ETH-USDC/${label}`)), `ETH/USDC ${label}`, predictionStart, duration],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [created] = parseEventLogs({
      abi: factoryAbi,
      eventName: "MarketCreated",
      logs: receipt.logs,
    });
    if (!created) throw new Error(`MarketCreated event missing for ${label}`);

    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.writeContract({
        address: oracleAdapter,
        abi: uniswapV3TwapOracleAdapterAbi,
        functionName: "configureMarket",
        args: [created.args.market, baseToken, quoteToken, poolAddresses, twapWindow, minLiquidity],
      }),
    });

    markets.push({
      label,
      assetSymbol: created.args.assetSymbol,
      address: created.args.market,
      category: "Crypto",
      eventTitle: "Ethereum",
      question: "Will ETH finish higher than its lock price?",
      slug: "eth-usdc",
      icon: "ETH",
      baseSymbol: "ETH",
      quoteSymbol: "USDC",
      createdBlock: receipt.blockNumber.toString(),
      tradingStart: created.args.tradingStart.toString(),
      tradingEnd: created.args.tradingEnd.toString(),
      predictionStart: created.args.predictionStart.toString(),
      predictionEnd: created.args.predictionEnd.toString(),
      predictionDuration: created.args.predictionDuration.toString(),
    });
    console.log(`${label} market: ${created.args.market}`);
  }

  const deployment: LocalDeployment = {
    chainId: profile.chainId,
    rpcUrl,
    deployer: account.address,
    feeVault,
    oracleKind: "uniswap-v3-twap",
    mockUSDC: collateral,
    frontendRegistry,
    uniswapV3TwapOracleAdapter: oracleAdapter,
    predictionMarketFactory,
    collateral,
    baseToken,
    quoteToken,
    poolAddresses,
    markets,
  };

  const deploymentDir = path.join(root, "packages/shared/src/deployments");
  await mkdir(deploymentDir, { recursive: true });
  const deploymentFile = path.join(deploymentDir, `${network}.generated.json`);
  await writeFile(deploymentFile, JSON.stringify(deployment, null, 2));

  const relayerEnv = [
    `RPC_URL=${rpcUrl}`,
    `CHAIN_ID=${profile.chainId}`,
    "PORT=8790",
    "CORS_ORIGIN=https://YOUR_FRONTEND_DOMAIN",
    `ALLOWED_MARKETS=${markets.map((market) => market.address).join(",")}`,
    "MAX_BET_AMOUNT_USDC=10000",
    "RATE_LIMIT_MAX=120",
    "RATE_LIMIT_WINDOW=1 minute",
    "RELAYER_PRIVATE_KEY=0xREPLACE_WITH_RELAYER_KEY",
    "",
  ].join("\n");
  await writeFile(path.join(deploymentDir, `${network}.relayer.env.example`), relayerEnv);

  console.log(`Deployment written to ${deploymentFile}`);
  console.log(`Uniswap v3 factory for ${profile.name}: ${profile.uniswapV3Factory}`);
  console.log(`Relayer allowlist: ${markets.map((market) => market.address).join(",")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
