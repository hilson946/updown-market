import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config as loadEnv } from "dotenv";
import Fastify, { type FastifyReply } from "fastify";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIRECTION_DOWN,
  DIRECTION_UP,
  betIntentTypes,
  betIntentDomain,
  marketAbi,
  type BetIntent,
} from "@updown/shared";
import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

loadEnv({ path: ".env.local", override: true });
loadEnv();

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const chainId = Number(process.env.CHAIN_ID ?? "31337");
const port = Number(process.env.PORT ?? "8790");
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const maxBetAmount = BigInt(process.env.MAX_BET_AMOUNT_USDC ?? "10000") * 1_000000n;
const privateKey = (process.env.RELAYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const localChain = {
  ...foundry,
  id: chainId,
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
};

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: localChain, transport: http(rpcUrl) });

const app = Fastify({ logger: true, bodyLimit: 16 * 1024 });
await app.register(helmet);
await app.register(cors, { origin: corsOrigin });
await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX ?? "120"),
  timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
});

const addressSchema = z.string().refine((value): value is Address => isAddress(value), "invalid address");
const uintString = z.string().regex(/^\d+$/);
const positiveUintString = uintString.refine((value) => BigInt(value) > 0n, "must be positive");

const betSchema = z.object({
  market: addressSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  intent: z.object({
    user: addressSchema,
    direction: z.union([z.literal(1), z.literal(2)]),
    amount: positiveUintString,
    minExpectedPayout: uintString,
    frontendId: uintString,
    referrer: addressSchema,
    nonce: uintString,
    deadline: uintString,
  }),
});

const claimSchema = z.object({
  market: addressSchema,
  user: addressSchema,
});

const refundSchema = claimSchema;

function loadAllowedMarkets() {
  if (chainId === 31337) {
    try {
      const file = path.resolve(__dirname, "../../../packages/shared/src/deployments/localhost.json");
      const deployment = JSON.parse(readFileSync(file, "utf8")) as { markets?: Array<{ address: Address }> };
      const markets = new Set((deployment.markets ?? []).map((market) => market.address.toLowerCase()));
      if (markets.size > 0) return markets;
    } catch {
      return new Set<string>();
    }
  }

  const envMarkets = process.env.ALLOWED_MARKETS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (envMarkets?.length) {
    return new Set(envMarkets.map((item) => item.toLowerCase()));
  }

  return new Set<string>();
}

const startupAllowedMarkets = loadAllowedMarkets();
if (startupAllowedMarkets.size === 0) {
  throw new Error("ALLOWED_MARKETS_REQUIRED");
}

function toContractIntent(intent: z.infer<typeof betSchema>["intent"]): BetIntent {
  return {
    user: intent.user,
    direction: intent.direction,
    amount: BigInt(intent.amount),
    minExpectedPayout: BigInt(intent.minExpectedPayout),
    frontendId: BigInt(intent.frontendId),
    referrer: intent.referrer,
    nonce: BigInt(intent.nonce),
    deadline: BigInt(intent.deadline),
  };
}

async function ensureAllowedMarket(address: Address) {
  const allowedMarkets = loadAllowedMarkets();
  if (!allowedMarkets.has(address.toLowerCase())) {
    throw new Error("MARKET_NOT_ALLOWED");
  }
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") {
    throw new Error("MARKET_NOT_CONTRACT");
  }
}

async function sendContractTransaction(
  address: Address,
  functionName: "betWithSig" | "settle" | "claimFor" | "refundFor",
  args: readonly unknown[],
) {
  const { request } = await publicClient.simulateContract({
    account,
    address,
    abi: marketAbi,
    functionName,
    args,
  } as any);
  const hash = await walletClient.writeContract(request as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return {
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  };
}

function handleError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const status =
    message === "MARKET_NOT_ALLOWED" || message === "MARKET_NOT_CONTRACT" || message === "BET_AMOUNT_TOO_LARGE"
      ? 400
      : 500;
  return reply.code(status).send({ error: message });
}

app.get("/health", async () => ({
  ok: true,
  relayer: account.address,
  chainId,
  allowedMarkets: loadAllowedMarkets().size,
}));

app.post("/bets", async (request, reply) => {
  try {
    const parsed = betSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const intent = toContractIntent(body.intent);
    await ensureAllowedMarket(body.market);
    if (intent.amount > maxBetAmount) {
      return reply.code(400).send({ error: "BET_AMOUNT_TOO_LARGE" });
    }

    const valid = await publicClient.verifyTypedData({
      address: intent.user,
      domain: betIntentDomain(chainId, body.market),
      types: betIntentTypes,
      primaryType: "BetIntent",
      message: intent,
      signature: body.signature as Hex,
    });

    if (!valid) {
      return reply.code(400).send({ error: "INVALID_SIGNATURE" });
    }

    return sendContractTransaction(body.market, "betWithSig", [intent, body.signature as Hex]);
  } catch (error) {
    return handleError(reply, error);
  }
});

app.post("/settle/:market", async (request, reply) => {
  try {
    const params = z.object({ market: addressSchema }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "INVALID_MARKET" });
    }

    await ensureAllowedMarket(params.data.market);
    return sendContractTransaction(params.data.market, "settle", []);
  } catch (error) {
    return handleError(reply, error);
  }
});

app.post("/claim", async (request, reply) => {
  try {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", details: parsed.error.flatten() });
    }

    await ensureAllowedMarket(parsed.data.market);
    const claimable = await publicClient.readContract({
      address: parsed.data.market,
      abi: marketAbi,
      functionName: "claimable",
      args: [parsed.data.user],
    });

    if (claimable === 0n) {
      return reply.code(400).send({ error: "NOTHING_TO_CLAIM" });
    }

    return sendContractTransaction(parsed.data.market, "claimFor", [parsed.data.user]);
  } catch (error) {
    return handleError(reply, error);
  }
});

app.post("/refund", async (request, reply) => {
  try {
    const parsed = refundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", details: parsed.error.flatten() });
    }

    await ensureAllowedMarket(parsed.data.market);
    const [status, upStake, downStake] = await Promise.all([
      publicClient.readContract({
        address: parsed.data.market,
        abi: marketAbi,
        functionName: "currentStatus",
        args: [],
      }),
      publicClient.readContract({
        address: parsed.data.market,
        abi: marketAbi,
        functionName: "stakes",
        args: [parsed.data.user, DIRECTION_UP],
      }),
      publicClient.readContract({
        address: parsed.data.market,
        abi: marketAbi,
        functionName: "stakes",
        args: [parsed.data.user, DIRECTION_DOWN],
      }),
    ]);

    if (status !== 4) {
      return reply.code(400).send({ error: "MARKET_NOT_REFUNDING" });
    }
    if (upStake + downStake === 0n) {
      return reply.code(400).send({ error: "NOTHING_TO_REFUND" });
    }

    return sendContractTransaction(parsed.data.market, "refundFor", [parsed.data.user]);
  } catch (error) {
    return handleError(reply, error);
  }
});

await app.listen({ host: "0.0.0.0", port });
