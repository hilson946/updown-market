import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FRONTEND_ID,
  DIRECTION_DOWN,
  DIRECTION_UP,
  betIntentDomain,
  betIntentTypes,
  marketAbi,
  mockOracleAbi,
  mockUsdcAbi,
  type BetIntent,
  type LocalDeployment,
  zeroAddress,
} from "@updown/shared";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const deployerPk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const alicePk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const bobPk = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;

async function loadDeployment(): Promise<LocalDeployment> {
  const file = path.join(root, "packages/shared/src/deployments/localhost.json");
  return JSON.parse(await readFile(file, "utf8")) as LocalDeployment;
}

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function expectPostError(url: string, body: unknown, expectedError: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (response.ok || data.error !== expectedError) {
    throw new Error(`Expected ${expectedError}, got ${response.status} ${JSON.stringify(data)}`);
  }
}

async function main() {
  const deployment = await loadDeployment();
  const relayerUrl = process.env.RELAYER_URL ?? "http://127.0.0.1:8790";
  const chain = {
    ...foundry,
    id: deployment.chainId,
    rpcUrls: { default: { http: [deployment.rpcUrl] } },
  };

  const deployer = privateKeyToAccount(deployerPk);
  const alice = privateKeyToAccount(alicePk);
  const bob = privateKeyToAccount(bobPk);
  const publicClient = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
  const testClient = createTestClient({ chain, mode: "anvil", transport: http(deployment.rpcUrl) });
  const deployerClient = createWalletClient({ account: deployer, chain, transport: http(deployment.rpcUrl) });
  const aliceClient = createWalletClient({ account: alice, chain, transport: http(deployment.rpcUrl) });
  const bobClient = createWalletClient({ account: bob, chain, transport: http(deployment.rpcUrl) });

  const health = await fetch(`${relayerUrl}/health`).then((response) => response.json());
  if (!health.ok) throw new Error("Relayer is not healthy");
  if (health.allowedMarkets < 3) throw new Error("Relayer market allowlist is not loaded");

  const market = deployment.markets[0];
  if (!market) throw new Error("No market in deployment");

  const amount = parseUnits("100", 6);

  await expectPostError(`${relayerUrl}/settle/0x0000000000000000000000000000000000000001`, undefined, "MARKET_NOT_ALLOWED");
  await expectPostError(
    `${relayerUrl}/bets`,
    {
      market: market.address,
      signature: "0x00",
      intent: {
        user: alice.address,
        direction: DIRECTION_UP,
        amount: parseUnits("10001", 6).toString(),
        minExpectedPayout: "0",
        frontendId: DEFAULT_FRONTEND_ID.toString(),
        referrer: zeroAddress,
        nonce: "999",
        deadline: "9999999999",
      },
    },
    "BET_AMOUNT_TOO_LARGE",
  );

  for (const user of [alice.address, bob.address]) {
    await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: deployment.mockUSDC,
        abi: mockUsdcAbi,
        functionName: "mint",
        args: [user, parseUnits("1000", 6)],
      }),
    });
  }

  await publicClient.waitForTransactionReceipt({
    hash: await aliceClient.writeContract({
      address: deployment.mockUSDC,
      abi: mockUsdcAbi,
      functionName: "approve",
      args: [market.address, parseUnits("1000", 6)],
    }),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await bobClient.writeContract({
      address: deployment.mockUSDC,
      abi: mockUsdcAbi,
      functionName: "approve",
      args: [market.address, parseUnits("1000", 6)],
    }),
  });

  const block = await publicClient.getBlock();
  const tradingStart = BigInt(market.tradingStart);
  if (block.timestamp < tradingStart) {
    await testClient.setNextBlockTimestamp({ timestamp: tradingStart });
    await testClient.mine({ blocks: 1 });
  }

  async function signBet(user: typeof alice, direction: number, nonce: bigint): Promise<[BetIntent, Hex]> {
    const currentBlock = await publicClient.getBlock();
    const intent: BetIntent = {
      user: user.address,
      direction,
      amount,
      minExpectedPayout: 0n,
      frontendId: DEFAULT_FRONTEND_ID,
      referrer: zeroAddress,
      nonce,
      deadline: currentBlock.timestamp + 120n,
    };
    const signature = await user.signTypedData({
      domain: betIntentDomain(deployment.chainId, market.address),
      types: betIntentTypes,
      primaryType: "BetIntent",
      message: intent,
    });
    return [intent, signature];
  }

  for (const [intent, signature] of [
    await signBet(alice, DIRECTION_UP, 1n),
    await signBet(bob, DIRECTION_DOWN, 1n),
  ] as const) {
    await postJson(`${relayerUrl}/bets`, {
      market: market.address,
      signature,
      intent: {
        ...intent,
        amount: intent.amount.toString(),
        minExpectedPayout: intent.minExpectedPayout.toString(),
        frontendId: intent.frontendId.toString(),
        nonce: intent.nonce.toString(),
        deadline: intent.deadline.toString(),
      },
    });
  }

  await publicClient.waitForTransactionReceipt({
    hash: await deployerClient.writeContract({
      address: deployment.mockTwapOracle,
      abi: mockOracleAbi,
      functionName: "setPrices",
      args: [market.address, 2_000_00000000n, 2_100_00000000n, true],
    }),
  });

  await testClient.setNextBlockTimestamp({ timestamp: BigInt(market.predictionEnd) });
  await testClient.mine({ blocks: 1 });
  await postJson(`${relayerUrl}/settle/${market.address}`);

  const claimable = await publicClient.readContract({
    address: market.address,
    abi: marketAbi,
    functionName: "claimable",
    args: [alice.address],
  });
  if (claimable !== 199_000000n) {
    throw new Error(`Unexpected claimable amount: ${claimable}`);
  }

  await postJson(`${relayerUrl}/claim`, { market: market.address, user: alice.address });

  const aliceBalance = await publicClient.readContract({
    address: deployment.mockUSDC,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [alice.address],
  });

  console.log(`Relayer flow market: ${market.address}`);
  console.log(`Alice claimable before claim: ${formatUnits(claimable, 6)} USDC`);
  console.log(`Alice balance after claim: ${formatUnits(aliceBalance, 6)} USDC`);
  console.log("Relayer HTTP integration flow completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
