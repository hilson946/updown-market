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
  type Address,
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

async function main() {
  const deployment = await loadDeployment();
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

  const market = deployment.markets[0];
  if (!market) throw new Error("No market in deployment");

  const amount = parseUnits("100", 6);

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

  const tradingStart = BigInt(market.tradingStart);
  const currentBlock = await publicClient.getBlock();
  if (currentBlock.timestamp < tradingStart) {
    await testClient.setNextBlockTimestamp({ timestamp: tradingStart });
    await testClient.mine({ blocks: 1 });
  }

  async function signBet(user: typeof alice, direction: number, nonce: bigint): Promise<[BetIntent, Hex]> {
    const block = await publicClient.getBlock();
    const intent: BetIntent = {
      user: user.address,
      direction,
      amount,
      minExpectedPayout: 0n,
      frontendId: DEFAULT_FRONTEND_ID,
      referrer: zeroAddress,
      nonce,
      deadline: block.timestamp + 120n,
    };

    const signature = await user.signTypedData({
      domain: betIntentDomain(deployment.chainId, market.address),
      types: betIntentTypes,
      primaryType: "BetIntent",
      message: intent,
    });
    return [intent, signature];
  }

  const [aliceIntent, aliceSig] = await signBet(alice, DIRECTION_UP, 1n);
  const [bobIntent, bobSig] = await signBet(bob, DIRECTION_DOWN, 1n);

  for (const [intent, signature] of [
    [aliceIntent, aliceSig],
    [bobIntent, bobSig],
  ] as const) {
    await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: market.address,
        abi: marketAbi,
        functionName: "betWithSig",
        args: [intent, signature],
      }),
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

  await publicClient.waitForTransactionReceipt({
    hash: await deployerClient.writeContract({
      address: market.address,
      abi: marketAbi,
      functionName: "settle",
      args: [],
    }),
  });

  const claimable = await publicClient.readContract({
    address: market.address,
    abi: marketAbi,
    functionName: "claimable",
    args: [alice.address],
  });

  await publicClient.waitForTransactionReceipt({
    hash: await deployerClient.writeContract({
      address: market.address,
      abi: marketAbi,
      functionName: "claimFor",
      args: [alice.address],
    }),
  });

  const aliceBalance = await publicClient.readContract({
    address: deployment.mockUSDC,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [alice.address],
  });

  console.log(`Market: ${market.address}`);
  console.log(`Alice claimable: ${formatUnits(claimable, 6)} USDC`);
  console.log(`Alice balance after claim: ${formatUnits(aliceBalance, 6)} USDC`);
  console.log("Local integration flow completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
