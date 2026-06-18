import type { Address, TypedData } from "viem";

export const DIRECTION_UP = 1;
export const DIRECTION_DOWN = 2;
export const DEFAULT_FRONTEND_ID = 1n;
export const DEFAULT_FEE_BPS = 50;
export const MAX_FEE_BPS = 150;

export const predictionDurations = {
  "5m": 300n,
  "1h": 3600n,
  "1d": 86400n,
} as const;

export type DurationKey = keyof typeof predictionDurations;
export type MarketCategory = "Crypto" | "Sports" | "Macro" | "AI" | "DeFi";

export type BetIntent = {
  user: Address;
  direction: number;
  amount: bigint;
  minExpectedPayout: bigint;
  frontendId: bigint;
  referrer: Address;
  nonce: bigint;
  deadline: bigint;
};

export type LocalDeployment = {
  chainId: number;
  rpcUrl: string;
  deployer: Address;
  feeVault: Address;
  oracleKind?: "mock" | "uniswap-v3-twap";
  mockUSDC: Address;
  frontendRegistry: Address;
  mockTwapOracle?: Address;
  uniswapV3TwapOracleAdapter?: Address;
  predictionMarketFactory: Address;
  collateral?: Address;
  baseToken?: Address;
  quoteToken?: Address;
  poolAddresses?: Address[];
  markets: {
    label: DurationKey;
    assetSymbol: string;
    address: Address;
    category?: MarketCategory;
    eventTitle?: string;
    question?: string;
    slug?: string;
    icon?: string;
    baseSymbol?: string;
    quoteSymbol?: string;
    createdBlock?: string;
    tradingStart: string;
    tradingEnd: string;
    predictionStart: string;
    predictionEnd: string;
    predictionDuration: string;
  }[];
};

export const betIntentTypes = {
  BetIntent: [
    { name: "user", type: "address" },
    { name: "direction", type: "uint8" },
    { name: "amount", type: "uint256" },
    { name: "minExpectedPayout", type: "uint256" },
    { name: "frontendId", type: "uint256" },
    { name: "referrer", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const satisfies TypedData;

export function betIntentDomain(chainId: number, market: Address) {
  return {
    name: "UpDownPredictionMarket",
    version: "1",
    chainId,
    verifyingContract: market,
  } as const;
}

export const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

export const mockUsdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const marketAbi = [
  {
    type: "event",
    name: "BetPlaced",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "direction", type: "uint8", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "frontendId", type: "uint256", indexed: false },
      { name: "referrer", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "winningDirection", type: "uint8", indexed: true },
      { name: "startPrice", type: "uint256", indexed: false },
      { name: "endPrice", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "betWithSig",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "direction", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "minExpectedPayout", type: "uint256" },
          { name: "frontendId", type: "uint256" },
          { name: "referrer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claimFor",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "refundFor",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "previewPayout",
    stateMutability: "view",
    inputs: [
      { name: "direction", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "stakes",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalUp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalDown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "currentStatus",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "winningDirection",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "tradingStart",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tradingEnd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "predictionStart",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "predictionEnd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "assetSymbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const factoryAbi = [
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "assetSymbol", type: "string" },
      { name: "predictionStart", type: "uint256" },
      { name: "predictionDuration", type: "uint256" },
    ],
    outputs: [{ name: "market", type: "address" }],
  },
  {
    type: "function",
    name: "allMarkets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "market", type: "address", indexed: true },
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "assetSymbol", type: "string", indexed: false },
      { name: "tradingStart", type: "uint256", indexed: false },
      { name: "tradingEnd", type: "uint256", indexed: false },
      { name: "predictionStart", type: "uint256", indexed: false },
      { name: "predictionEnd", type: "uint256", indexed: false },
      { name: "predictionDuration", type: "uint256", indexed: false },
      { name: "feeBps", type: "uint16", indexed: false },
    ],
  },
] as const;

export const mockOracleAbi = [
  {
    type: "function",
    name: "setPrices",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "startPrice", type: "uint256" },
      { name: "endPrice", type: "uint256" },
      { name: "valid", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const uniswapV3TwapOracleAdapterAbi = [
  {
    type: "function",
    name: "configureMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "baseToken", type: "address" },
      { name: "quoteToken", type: "address" },
      { name: "pools", type: "address[]" },
      { name: "twapWindow", type: "uint32" },
      { name: "minLiquidity", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getMarketConfig",
    stateMutability: "view",
    inputs: [{ name: "market", type: "address" }],
    outputs: [
      { name: "configured", type: "bool" },
      { name: "baseToken", type: "address" },
      { name: "quoteToken", type: "address" },
      { name: "twapWindow", type: "uint32" },
      { name: "minLiquidity", type: "uint128" },
      { name: "pools", type: "address[]" },
    ],
  },
  {
    type: "event",
    name: "MarketConfigured",
    inputs: [
      { name: "market", type: "address", indexed: true },
      { name: "baseToken", type: "address", indexed: true },
      { name: "quoteToken", type: "address", indexed: true },
      { name: "twapWindow", type: "uint32", indexed: false },
      { name: "minLiquidity", type: "uint128", indexed: false },
      { name: "pools", type: "address[]", indexed: false },
    ],
  },
] as const;

export const frontendRegistryAbi = [
  {
    type: "function",
    name: "registerFrontend",
    stateMutability: "nonpayable",
    inputs: [
      { name: "frontendId", type: "uint256" },
      { name: "payout", type: "address" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
] as const;
