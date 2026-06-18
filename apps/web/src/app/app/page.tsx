"use client";

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
  type DurationKey,
  type LocalDeployment,
  type MarketCategory,
  zeroAddress,
} from "@updown/shared";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gauge,
  Github,
  History,
  Home as House,
  Layers,
  ListFilter,
  Loader2,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UsersRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  formatUnits,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useBlock,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContracts,
  useSignTypedData,
  useWriteContract,
} from "wagmi";

const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:8790";
const githubUrl = "https://github.com/hilson946/updown-market";

const STATUS_PENDING = 0;
const STATUS_TRADING = 1;
const STATUS_LOCKED = 2;
const STATUS_SETTLED = 3;
const STATUS_REFUNDING = 4;
const statusLabels = ["Pending", "Trading", "Locked", "Settled", "Refunding"];
const statusClasses = ["pending", "trading", "locked", "settled", "refunding"];
const durationOrder: DurationKey[] = ["5m", "1h", "1d"];
const categories: Array<"All" | MarketCategory> = ["All", "Crypto", "Sports", "Macro", "AI", "DeFi"];
const views = ["Markets", "Portfolio", "History"] as const;
const maxBetAmount = parseUnits("10000", 6);
const localMintAmount = parseUnits("10000", 6);
const tradePageSize = 10;

const betPlacedEvent = parseAbiItem(
  "event BetPlaced(address indexed user,uint8 indexed direction,uint256 amount,uint256 frontendId,address indexed referrer,uint256 nonce)",
);
const claimedEvent = parseAbiItem("event Claimed(address indexed user,uint256 amount)");
const refundedEvent = parseAbiItem("event Refunded(address indexed user,uint256 amount)");

type DeskView = (typeof views)[number];
type MarketItem = LocalDeployment["markets"][number];
type BoardStats = {
  status: number;
  totalUp: bigint;
  totalDown: bigint;
};
type PortfolioItem = {
  market: MarketItem;
  status: number;
  upStake: bigint;
  downStake: bigint;
  claimable: bigint;
  totalUp: bigint;
  totalDown: bigint;
};
type HistoryItem = {
  id: string;
  type: "Bet" | "Claim" | "Refund";
  market: MarketItem;
  amount: bigint;
  direction?: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  timestamp?: number;
};
type MarketTrade = {
  id: string;
  user: Address;
  amount: bigint;
  direction: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  timestamp?: number;
};

function compactAddress(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdc(value?: bigint) {
  return Number(formatUnits(value ?? 0n, 6)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function secondsLeft(target: string | undefined, nowSeconds: number) {
  if (!target) return 0;
  return Math.max(Number(BigInt(target) - BigInt(nowSeconds)), 0);
}

function timestampValue(value: string | undefined) {
  if (!value) return 0n;
  return BigInt(value);
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function marketTitle(market?: MarketItem) {
  if (!market) return "Select a market";
  return market.eventTitle ?? market.assetSymbol.replace(` ${market.label}`, "");
}

function marketQuestion(market?: MarketItem) {
  if (!market) return "";
  return market.question ?? `Will ${market.assetSymbol} finish higher than its lock price?`;
}

function marketKey(market: MarketItem) {
  return market.address.toLowerCase();
}

function marketSort(a: MarketItem, b: MarketItem) {
  const categoryDelta = categories.indexOf(a.category ?? "All") - categories.indexOf(b.category ?? "All");
  if (categoryDelta !== 0) return categoryDelta;
  return marketTitle(a).localeCompare(marketTitle(b));
}

function pct(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) return "50.0%";
  return `${(Number((numerator * 1000n) / denominator) / 10).toFixed(1)}%`;
}

function formatTime(timestamp?: number) {
  if (!timestamp) return "--";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function liveStatus(rawStatus: number, market: MarketItem | undefined, nowSeconds: bigint) {
  if (rawStatus >= STATUS_SETTLED) return rawStatus;
  if (!market) return rawStatus;
  if (nowSeconds < timestampValue(market.tradingStart)) return STATUS_PENDING;
  if (nowSeconds < timestampValue(market.tradingEnd)) return STATUS_TRADING;
  return STATUS_LOCKED;
}

export default function Home() {
  const [deployment, setDeployment] = useState<LocalDeployment | null>(null);
  const [deployError, setDeployError] = useState("");
  const [activeView, setActiveView] = useState<DeskView>("Markets");
  const [selectedCategory, setSelectedCategory] = useState<"All" | MarketCategory>("All");
  const [selectedDuration, setSelectedDuration] = useState<DurationKey>("5m");
  const [selectedMarketAddress, setSelectedMarketAddress] = useState<Address | null>(null);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<number>(DIRECTION_UP);
  const [amount, setAmount] = useState("25");
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const [blockClock, setBlockClock] = useState<{ timestamp: number; observedAt: number } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [marketTrades, setMarketTrades] = useState<MarketTrade[]>([]);
  const [marketTradesLoading, setMarketTradesLoading] = useState(false);
  const [marketTradesError, setMarketTradesError] = useState("");
  const [tradePage, setTradePage] = useState(0);

  const publicClient = usePublicClient();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { data: latestBlock } = useBlock({ watch: true });

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!latestBlock) return;
    setBlockClock({ timestamp: Number(latestBlock.timestamp), observedAt: Date.now() });
  }, [latestBlock]);

  useEffect(() => {
    fetch("/api/deployment")
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).message ?? "Deployment missing");
        return response.json();
      })
      .then((data: LocalDeployment) => {
        setDeployment(data);
        setSelectedMarketAddress(data.markets[0]?.address ?? null);
        setDeployError("");
      })
      .catch((error) => {
        setDeployError(error.message);
      });
  }, []);

  const allMarkets = deployment?.markets ?? [];
  const visibleMarkets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allMarkets
      .filter((item) => item.label === selectedDuration)
      .filter((item) => selectedCategory === "All" || item.category === selectedCategory)
      .filter((item) => {
        if (!needle) return true;
        return [item.assetSymbol, item.eventTitle, item.question, item.category, item.baseSymbol]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort(marketSort);
  }, [allMarkets, query, selectedCategory, selectedDuration]);

  useEffect(() => {
    if (!deployment) return;
    const current = selectedMarketAddress
      ? deployment.markets.find((item) => item.address.toLowerCase() === selectedMarketAddress.toLowerCase())
      : undefined;
    if (current && current.label === selectedDuration && (selectedCategory === "All" || current.category === selectedCategory)) {
      return;
    }
    setSelectedMarketAddress(visibleMarkets[0]?.address ?? deployment.markets[0]?.address ?? null);
  }, [deployment, selectedCategory, selectedDuration, selectedMarketAddress, visibleMarkets]);

  const market = useMemo(
    () =>
      allMarkets.find((item) => item.address.toLowerCase() === selectedMarketAddress?.toLowerCase()) ??
      visibleMarkets[0] ??
      allMarkets[0],
    [allMarkets, selectedMarketAddress, visibleMarkets],
  );

  useEffect(() => {
    setTradePage(0);
  }, [market?.address]);

  const parsedAmount = useMemo(() => {
    try {
      if (!amount || !/^\d*(\.\d{0,6})?$/.test(amount)) return 0n;
      return parseUnits(amount, 6);
    } catch {
      return 0n;
    }
  }, [amount]);

  const boardReads = useReadContracts({
    allowFailure: true,
    query: {
      enabled: allMarkets.length > 0,
      refetchInterval: 4000,
    },
    contracts: allMarkets.flatMap((item) => [
      { address: item.address, abi: marketAbi, functionName: "currentStatus" as const },
      { address: item.address, abi: marketAbi, functionName: "totalUp" as const },
      { address: item.address, abi: marketAbi, functionName: "totalDown" as const },
    ]),
  });

  const boardStats = useMemo(() => {
    const stats = new Map<string, BoardStats>();
    allMarkets.forEach((item, index) => {
      const offset = index * 3;
      stats.set(marketKey(item), {
        status: Number(boardReads.data?.[offset]?.result ?? 0),
        totalUp: (boardReads.data?.[offset + 1]?.result as bigint | undefined) ?? 0n,
        totalDown: (boardReads.data?.[offset + 2]?.result as bigint | undefined) ?? 0n,
      });
    });
    return stats;
  }, [allMarkets, boardReads.data]);

  const reads = useReadContracts({
    allowFailure: true,
    query: {
      enabled: Boolean(deployment && market),
      refetchInterval: 3000,
    },
    contracts:
      deployment && market
        ? [
            { address: market.address, abi: marketAbi, functionName: "totalUp" },
            { address: market.address, abi: marketAbi, functionName: "totalDown" },
            { address: market.address, abi: marketAbi, functionName: "currentStatus" },
            { address: market.address, abi: marketAbi, functionName: "previewPayout", args: [direction, parsedAmount] },
            { address: deployment.mockUSDC, abi: mockUsdcAbi, functionName: "balanceOf", args: [address ?? zeroAddress] },
            { address: deployment.mockUSDC, abi: mockUsdcAbi, functionName: "allowance", args: [address ?? zeroAddress, market.address] },
            { address: market.address, abi: marketAbi, functionName: "claimable", args: [address ?? zeroAddress] },
            { address: market.address, abi: marketAbi, functionName: "stakes", args: [address ?? zeroAddress, DIRECTION_UP] },
            { address: market.address, abi: marketAbi, functionName: "stakes", args: [address ?? zeroAddress, DIRECTION_DOWN] },
          ]
        : [],
  });

  const portfolioReads = useReadContracts({
    allowFailure: true,
    query: {
      enabled: Boolean(deployment && address),
      refetchInterval: 5000,
    },
    contracts:
      deployment && address
        ? deployment.markets.flatMap((item) => [
            { address: item.address, abi: marketAbi, functionName: "currentStatus" as const },
            { address: item.address, abi: marketAbi, functionName: "stakes" as const, args: [address, DIRECTION_UP] },
            { address: item.address, abi: marketAbi, functionName: "stakes" as const, args: [address, DIRECTION_DOWN] },
            { address: item.address, abi: marketAbi, functionName: "claimable" as const, args: [address] },
            { address: item.address, abi: marketAbi, functionName: "totalUp" as const },
            { address: item.address, abi: marketAbi, functionName: "totalDown" as const },
          ])
        : [],
  });

  const portfolioItems = useMemo<PortfolioItem[]>(() => {
    if (!deployment || !address) return [];
    return deployment.markets
      .map((item, index) => {
        const offset = index * 6;
        return {
          market: item,
          status: Number(portfolioReads.data?.[offset]?.result ?? 0),
          upStake: (portfolioReads.data?.[offset + 1]?.result as bigint | undefined) ?? 0n,
          downStake: (portfolioReads.data?.[offset + 2]?.result as bigint | undefined) ?? 0n,
          claimable: (portfolioReads.data?.[offset + 3]?.result as bigint | undefined) ?? 0n,
          totalUp: (portfolioReads.data?.[offset + 4]?.result as bigint | undefined) ?? 0n,
          totalDown: (portfolioReads.data?.[offset + 5]?.result as bigint | undefined) ?? 0n,
        };
      })
      .filter((item) => item.upStake + item.downStake + item.claimable > 0n)
      .sort((a, b) => Number(BigInt(b.market.predictionEnd) - BigInt(a.market.predictionEnd)));
  }, [address, deployment, portfolioReads.data]);

  useEffect(() => {
    if (!deployment || !address || !publicClient || deployment.markets.length === 0) {
      setHistory([]);
      return;
    }

    let cancelled = false;
    const activeDeployment = deployment;
    const activePublicClient = publicClient;
    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const marketAddresses = activeDeployment.markets.map((item) => item.address);
        const marketLookup = new Map(activeDeployment.markets.map((item) => [marketKey(item), item]));
        const fromBlock = activeDeployment.markets.reduce((min, item) => {
          const created = item.createdBlock ? BigInt(item.createdBlock) : 0n;
          return created < min ? created : min;
        }, activeDeployment.markets[0]?.createdBlock ? BigInt(activeDeployment.markets[0].createdBlock) : 0n);

        const [betLogs, claimLogs, refundLogs] = await Promise.all([
          activePublicClient.getLogs({ address: marketAddresses, event: betPlacedEvent, args: { user: address }, fromBlock, toBlock: "latest" }),
          activePublicClient.getLogs({ address: marketAddresses, event: claimedEvent, args: { user: address }, fromBlock, toBlock: "latest" }),
          activePublicClient.getLogs({ address: marketAddresses, event: refundedEvent, args: { user: address }, fromBlock, toBlock: "latest" }),
        ]);

        const items: HistoryItem[] = [
          ...betLogs.map((log) => ({
            id: `${log.transactionHash}-${log.logIndex}`,
            type: "Bet" as const,
            market: marketLookup.get(log.address.toLowerCase())!,
            amount: log.args.amount ?? 0n,
            direction: Number(log.args.direction ?? 0),
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            txHash: log.transactionHash,
          })),
          ...claimLogs.map((log) => ({
            id: `${log.transactionHash}-${log.logIndex}`,
            type: "Claim" as const,
            market: marketLookup.get(log.address.toLowerCase())!,
            amount: log.args.amount ?? 0n,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            txHash: log.transactionHash,
          })),
          ...refundLogs.map((log) => ({
            id: `${log.transactionHash}-${log.logIndex}`,
            type: "Refund" as const,
            market: marketLookup.get(log.address.toLowerCase())!,
            amount: log.args.amount ?? 0n,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            txHash: log.transactionHash,
          })),
        ].filter((item) => item.market);

        const blockNumbers = Array.from(new Set(items.map((item) => item.blockNumber.toString())));
        const blocks = await Promise.all(blockNumbers.map((blockNumber) => activePublicClient.getBlock({ blockNumber: BigInt(blockNumber) })));
        const timestamps = new Map(blocks.map((block) => [block.number.toString(), Number(block.timestamp)]));
        const withTimes = items
          .map((item) => ({ ...item, timestamp: timestamps.get(item.blockNumber.toString()) }))
          .sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);

        if (!cancelled) setHistory(withTimes);
      } catch (error) {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "History unavailable");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [address, deployment, historyVersion, publicClient]);

  useEffect(() => {
    if (!market || !publicClient) {
      setMarketTrades([]);
      return;
    }

    let cancelled = false;
    const activeMarket = market;
    const activePublicClient = publicClient;
    async function loadMarketTrades() {
      setMarketTradesLoading(true);
      setMarketTradesError("");
      try {
        const fromBlock = activeMarket.createdBlock ? BigInt(activeMarket.createdBlock) : 0n;
        const betLogs = await activePublicClient.getLogs({
          address: activeMarket.address,
          event: betPlacedEvent,
          fromBlock,
          toBlock: "latest",
        });

        const sorted = betLogs
          .map((log) => ({
            id: `${log.transactionHash}-${log.logIndex}`,
            user: (log.args.user ?? zeroAddress) as Address,
            amount: log.args.amount ?? 0n,
            direction: Number(log.args.direction ?? 0),
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            txHash: log.transactionHash,
          }))
          .sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);

        const recent = sorted.slice(0, 12);
        const blockNumbers = Array.from(new Set(recent.map((item) => item.blockNumber.toString())));
        const blocks = await Promise.all(blockNumbers.map((blockNumber) => activePublicClient.getBlock({ blockNumber: BigInt(blockNumber) })));
        const timestamps = new Map(blocks.map((block) => [block.number.toString(), Number(block.timestamp)]));
        const withTimes = sorted.map((item) => ({ ...item, timestamp: timestamps.get(item.blockNumber.toString()) }));

        if (!cancelled) setMarketTrades(withTimes);
      } catch (error) {
        if (!cancelled) setMarketTradesError(error instanceof Error ? error.message : "Market trades unavailable");
      } finally {
        if (!cancelled) setMarketTradesLoading(false);
      }
    }

    void loadMarketTrades();
    return () => {
      cancelled = true;
    };
  }, [historyVersion, market, publicClient]);

  const totalUp = reads.data?.[0]?.result as bigint | undefined;
  const totalDown = reads.data?.[1]?.result as bigint | undefined;
  const status = Number(reads.data?.[2]?.result ?? 0);
  const preview = reads.data?.[3]?.result as bigint | undefined;
  const balance = reads.data?.[4]?.result as bigint | undefined;
  const allowance = reads.data?.[5]?.result as bigint | undefined;
  const claimable = reads.data?.[6]?.result as bigint | undefined;
  const upStake = reads.data?.[7]?.result as bigint | undefined;
  const downStake = reads.data?.[8]?.result as bigint | undefined;
  const refundable = (upStake ?? 0n) + (downStake ?? 0n);

  const chainNow = blockClock
    ? blockClock.timestamp + Math.floor((nowTick - blockClock.observedAt) / 1000)
    : Math.floor(nowTick / 1000);
  const chainNowBigInt = BigInt(chainNow);
  const tradingStartAt = timestampValue(market?.tradingStart);
  const tradingEndAt = timestampValue(market?.tradingEnd);
  const predictionStartAt = timestampValue(market?.predictionStart);
  const tradingLeft = secondsLeft(market?.tradingEnd, chainNow);
  const tradingOpensIn = secondsLeft(market?.tradingStart, chainNow);
  const predictionStartsIn = secondsLeft(market?.predictionStart, chainNow);
  const predictionLeft = secondsLeft(market?.predictionEnd, chainNow);
  const isBeforeTrading = Boolean(market) && chainNowBigInt < tradingStartAt;
  const isTradingWindowOpen =
    Boolean(market) && chainNowBigInt >= tradingStartAt && chainNowBigInt < tradingEndAt;
  const isBeforePrediction = Boolean(market) && chainNowBigInt < predictionStartAt;
  const displayStatus = liveStatus(status, market, chainNowBigInt);

  const amountError = useMemo(() => {
    if (!amount || parsedAmount === 0n) return "";
    if (!/^\d*(\.\d{0,6})?$/.test(amount)) return "Use up to 6 decimals.";
    if (parsedAmount > maxBetAmount) return "Max bet is 10,000 USDC.";
    if (balance !== undefined && parsedAmount > balance) return "Insufficient USDC.";
    return "";
  }, [amount, balance, parsedAmount]);

  const totalUpValue = totalUp ?? 0n;
  const totalDownValue = totalDown ?? 0n;
  const userUpValue = upStake ?? 0n;
  const userDownValue = downStake ?? 0n;
  const totalPool = totalUpValue + totalDownValue;
  const userPool = userUpValue + userDownValue;
  const otherUpPool = totalUpValue > userUpValue ? totalUpValue - userUpValue : 0n;
  const otherDownPool = totalDownValue > userDownValue ? totalDownValue - userDownValue : 0n;
  const otherPool = otherUpPool + otherDownPool;
  const upShare = totalPool === 0n ? 50 : Number((totalUpValue * 10000n) / totalPool) / 100;
  const downShare = Math.max(0, 100 - upShare);
  const userPoolShare = totalPool === 0n ? 0 : Number((userPool * 10000n) / totalPool) / 100;
  const marketTradeVolume = marketTrades.reduce((sum, item) => sum + item.amount, 0n);
  const marketTradeUpVolume = marketTrades
    .filter((item) => item.direction === DIRECTION_UP)
    .reduce((sum, item) => sum + item.amount, 0n);
  const marketTradeDownVolume = marketTrades
    .filter((item) => item.direction === DIRECTION_DOWN)
    .reduce((sum, item) => sum + item.amount, 0n);
  const marketTradeUpCount = marketTrades.filter((item) => item.direction === DIRECTION_UP).length;
  const marketTradeDownCount = marketTrades.filter((item) => item.direction === DIRECTION_DOWN).length;
  const tradePageCount = Math.max(1, Math.ceil(marketTrades.length / tradePageSize));
  const safeTradePage = Math.min(tradePage, tradePageCount - 1);
  const tradeStartIndex = safeTradePage * tradePageSize;
  const tradeEndIndex = Math.min(tradeStartIndex + tradePageSize, marketTrades.length);
  const pagedMarketTrades = marketTrades.slice(tradeStartIndex, tradeEndIndex);
  const currentAddressLower = address?.toLowerCase();
  const canUseDevTools =
    deployment?.chainId === 31337 &&
    deployment.oracleKind === "mock" &&
    Boolean(deployment.mockTwapOracle) &&
    process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS !== "false";
  const canBet = isConnected && pending === "" && displayStatus === STATUS_TRADING && isTradingWindowOpen && parsedAmount > 0n && !amountError;
  const needsApproval = parsedAmount > 0n && (allowance ?? 0n) < parsedAmount;
  const activeExposure = portfolioItems.reduce((sum, item) => sum + item.upStake + item.downStake, 0n);
  const openClaimable = portfolioItems.reduce((sum, item) => sum + item.claimable, 0n);

  useEffect(() => {
    if (tradePage > tradePageCount - 1) setTradePage(tradePageCount - 1);
  }, [tradePage, tradePageCount]);

  async function refreshAll() {
    await Promise.all([reads.refetch(), boardReads.refetch(), portfolioReads.refetch()]);
    setHistoryVersion((value) => value + 1);
  }

  async function approve() {
    if (!deployment || !market) return;
    setPending("approve");
    setNotice("");
    try {
      const hash = await writeContractAsync({
        address: deployment.mockUSDC,
        abi: mockUsdcAbi,
        functionName: "approve",
        args: [market.address, parsedAmount],
      });
      setNotice(`Approve submitted: ${compactAddress(hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Approve failed");
    } finally {
      setPending("");
    }
  }

  async function mintUsdc() {
    if (!deployment || !address) return;
    setPending("mint");
    setNotice("");
    try {
      const hash = await writeContractAsync({
        address: deployment.mockUSDC,
        abi: mockUsdcAbi,
        functionName: "mint",
        args: [address, localMintAmount],
      });
      setNotice(`Test USDC submitted: ${compactAddress(hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Mint failed");
    } finally {
      setPending("");
    }
  }

  async function placeBet() {
    if (!deployment || !market || !address) return;
    if (parsedAmount <= 0n) {
      setNotice("Enter an amount first.");
      return;
    }

    setPending("bet");
    setNotice("");
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
      const minExpectedPayout = ((preview ?? 0n) * 95n) / 100n;
      const intent: BetIntent = {
        user: address,
        direction,
        amount: parsedAmount,
        minExpectedPayout,
        frontendId: DEFAULT_FRONTEND_ID,
        referrer: zeroAddress,
        nonce: BigInt(Date.now()),
        deadline,
      };

      const signature = await signTypedDataAsync({
        domain: betIntentDomain(deployment.chainId, market.address),
        types: betIntentTypes,
        primaryType: "BetIntent",
        message: intent,
      });

      const response = await fetch(`${relayerUrl}/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Relayer rejected bet");
      setNotice(`Bet relayed: ${compactAddress(result.hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Bet failed");
    } finally {
      setPending("");
    }
  }

  async function settle() {
    if (!market) return;
    setPending("settle");
    setNotice("");
    try {
      const response = await fetch(`${relayerUrl}/settle/${market.address}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Settle failed");
      setNotice(`Settle submitted: ${compactAddress(result.hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Settle failed");
    } finally {
      setPending("");
    }
  }

  async function setMockOracle(mode: "up" | "down" | "tie" | "invalid") {
    if (!deployment?.mockTwapOracle || !market) return;
    setPending(`oracle-${mode}`);
    setNotice("");
    try {
      const startPrice = 2_000_00000000n;
      const endPrice =
        mode === "up" ? 2_100_00000000n : mode === "down" ? 1_900_00000000n : 2_000_00000000n;
      const valid = mode !== "invalid";
      const hash = await writeContractAsync({
        address: deployment.mockTwapOracle,
        abi: mockOracleAbi,
        functionName: "setPrices",
        args: [market.address, startPrice, endPrice, valid],
      });
      setNotice(`Oracle ${mode} submitted: ${compactAddress(hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Oracle update failed");
    } finally {
      setPending("");
    }
  }

  async function claim() {
    if (!market || !address) return;
    setPending("claim");
    setNotice("");
    try {
      const response = await fetch(`${relayerUrl}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: market.address, user: address }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Claim failed");
      setNotice(`Claim submitted: ${compactAddress(result.hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Claim failed");
    } finally {
      setPending("");
    }
  }

  async function refund() {
    if (!market || !address) return;
    setPending("refund");
    setNotice("");
    try {
      const response = await fetch(`${relayerUrl}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: market.address, user: address }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Refund failed");
      setNotice(`Refund submitted: ${compactAddress(result.hash)}`);
      await refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refund failed");
    } finally {
      setPending("");
    }
  }

  function openMarket(item: MarketItem) {
    setSelectedMarketAddress(item.address);
    setSelectedDuration(item.label);
    setSelectedCategory(item.category ?? "All");
    setActiveView("Markets");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">UP/DOWN MARKET</p>
          <h1>Prediction Markets</h1>
          <div className="appLinkRow">
            <Link href="/">
              <House size={14} />
              Home
            </Link>
            <Link href="/docs">
              <BookOpen size={14} />
              Docs
            </Link>
            <a href={githubUrl} target="_blank" rel="noreferrer">
              <Github size={14} />
              GitHub
            </a>
          </div>
        </div>
        <nav className="viewTabs" aria-label="Desk views">
          {views.map((view) => (
            <button key={view} className={activeView === view ? "active" : ""} onClick={() => setActiveView(view)}>
              {view === "Markets" ? <Layers size={16} /> : view === "Portfolio" ? <Briefcase size={16} /> : <History size={16} />}
              {view}
            </button>
          ))}
        </nav>
        <div className="walletBox">
          {isConnected ? (
            <>
              <span>{compactAddress(address)}</span>
              <button className="iconTextButton secondary" onClick={() => disconnect()}>
                <Wallet size={16} />
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="iconTextButton"
              onClick={() => connect({ connector: connectors[0] })}
              disabled={connectPending || !connectors[0]}
            >
              {connectPending ? <Loader2 size={16} className="spin" /> : <Wallet size={16} />}
              Connect
            </button>
          )}
        </div>
      </header>

      {deployError ? <div className="notice error">{deployError}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <section className="deskGrid">
        <aside className="leftRail">
          <div className="filterPanel">
            <div className="railHeader">
              <ListFilter size={17} />
              <span>Markets</span>
            </div>
            <label className="searchBox">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search markets" />
            </label>
            <div className="categoryList">
              {categories.map((category) => (
                <button
                  key={category}
                  className={selectedCategory === category ? "active" : ""}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="segmented">
              {durationOrder.map((duration) => (
                <button
                  key={duration}
                  className={duration === selectedDuration ? "active" : ""}
                  onClick={() => setSelectedDuration(duration)}
                >
                  {duration}
                </button>
              ))}
            </div>
          </div>

          <div className="accountPanel">
            <div className="railHeader">
              <Wallet size={17} />
              <span>Account</span>
            </div>
            <dl className="metricList compact">
              <div>
                <dt>Balance</dt>
                <dd>{formatUsdc(balance)} USDC</dd>
              </div>
              <div>
                <dt>Exposure</dt>
                <dd>{formatUsdc(activeExposure)} USDC</dd>
              </div>
              <div>
                <dt>Claimable</dt>
                <dd>{formatUsdc(openClaimable)} USDC</dd>
              </div>
              <div>
                <dt>Chain</dt>
                <dd>{deployment?.chainId ?? "..."}</dd>
              </div>
            </dl>
            {canUseDevTools ? (
              <button className="mintButton" onClick={mintUsdc} disabled={!address || pending !== ""}>
                {pending === "mint" ? <Loader2 size={16} className="spin" /> : <Wallet size={16} />}
                Get test USDC
              </button>
            ) : null}
          </div>
        </aside>

        {activeView === "Markets" ? (
          <>
            <section className="marketColumn">
              <div className="marketColumnHeader">
                <div>
                  <p className="eyebrow">{selectedCategory.toUpperCase()}</p>
                  <h2>{selectedDuration} Markets</h2>
                </div>
                <button className="iconButton" title="Refresh" onClick={refreshAll}>
                  <RefreshCw size={18} />
                </button>
              </div>
              <div className="marketList">
                {visibleMarkets.map((item) => {
                  const stats = boardStats.get(marketKey(item)) ?? { status: 0, totalUp: 0n, totalDown: 0n };
                  const itemStatus = liveStatus(stats.status, item, chainNowBigInt);
                  const pool = stats.totalUp + stats.totalDown;
                  return (
                    <button
                      key={item.address}
                      className={`marketCard ${item.address.toLowerCase() === market?.address.toLowerCase() ? "selected" : ""}`}
                      onClick={() => setSelectedMarketAddress(item.address)}
                    >
                      <span className="assetBadge">{item.icon ?? item.baseSymbol ?? item.category ?? "MKT"}</span>
                      <span className="marketCardMain">
                        <span>
                          <b>{marketTitle(item)}</b>
                          <em>{marketQuestion(item)}</em>
                        </span>
                        <span className="miniStats">
                          <small>UP {formatUsdc(stats.totalUp)}</small>
                          <small>DOWN {formatUsdc(stats.totalDown)}</small>
                        </span>
                        <span className="miniPool">
                          <i style={{ width: pct(stats.totalUp, pool) }} />
                        </span>
                      </span>
                      <span className="marketCardMeta">
                        <strong>{formatUsdc(pool)}</strong>
                        <small className={statusClasses[itemStatus] ?? "locked"}>{statusLabels[itemStatus] ?? "Unknown"}</small>
                      </span>
                    </button>
                  );
                })}
                {visibleMarkets.length === 0 ? <div className="emptyState">No matching markets.</div> : null}
              </div>
            </section>

            <section className="tradePanel">
              <div className="tradeHeader">
                <div>
                  <p className="eyebrow">{market?.category ?? "MARKET"}</p>
                  <h2>{marketTitle(market)}</h2>
                  <span>{marketQuestion(market)}</span>
                </div>
                <span className={`statusPill ${statusClasses[displayStatus] ?? "locked"}`}>
                  <i />
                  {statusLabels[displayStatus] ?? "Unknown"}
                </span>
              </div>

              <div className="tickerStrip">
                <div>
                  <span>{isBeforeTrading ? "Bet opens" : "Bet closes"}</span>
                  <strong>{formatDuration(isBeforeTrading ? tradingOpensIn : tradingLeft)}</strong>
                </div>
                <div>
                  <span>{isBeforePrediction ? "Prediction starts" : "Prediction left"}</span>
                  <strong>{formatDuration(isBeforePrediction ? predictionStartsIn : predictionLeft)}</strong>
                </div>
                <div>
                  <span>Pool</span>
                  <strong>{formatUsdc(totalPool)} USDC</strong>
                </div>
                <div>
                  <span>{isConnected ? "Other traders" : "Public pool"}</span>
                  <strong>{formatUsdc(isConnected ? otherPool : totalPool)} USDC</strong>
                </div>
              </div>

              <div className="poolBar" aria-label="Pool split">
                <span style={{ width: `${upShare}%` }} />
                <b style={{ width: `${downShare}%` }} />
              </div>

              <div className="poolStats" aria-label="Current pool trading volume">
                <div className="up">
                  <span>UP pool</span>
                  <strong>{formatUsdc(totalUpValue)} USDC</strong>
                  <em>{pct(totalUpValue, totalPool)}</em>
                </div>
                <div className="down">
                  <span>DOWN pool</span>
                  <strong>{formatUsdc(totalDownValue)} USDC</strong>
                  <em>{pct(totalDownValue, totalPool)}</em>
                </div>
                <div>
                  <span>{isConnected ? "Other traders" : "Public pool"}</span>
                  <strong>{formatUsdc(isConnected ? otherPool : totalPool)} USDC</strong>
                  <em>{isConnected ? `${formatUsdc(otherUpPool)} UP / ${formatUsdc(otherDownPool)} DOWN` : "Connect to exclude your trades"}</em>
                </div>
                <div>
                  <span>Your share</span>
                  <strong>{formatUsdc(userPool)} USDC</strong>
                  <em>{formatPercent(userPoolShare)}</em>
                </div>
              </div>

              <div className="directionGrid">
                <button className={`direction up ${direction === DIRECTION_UP ? "selected" : ""}`} onClick={() => setDirection(DIRECTION_UP)}>
                  <ArrowUp size={24} />
                  <span>UP</span>
                </button>
                <button className={`direction down ${direction === DIRECTION_DOWN ? "selected" : ""}`} onClick={() => setDirection(DIRECTION_DOWN)}>
                  <ArrowDown size={24} />
                  <span>DOWN</span>
                </button>
              </div>

              <label className="amountBox">
                <span>Amount</span>
                <div>
                  <input
                    value={amount}
                    onChange={(event) => {
                      const next = event.target.value.trim();
                      if (next === "" || /^\d*(\.\d{0,6})?$/.test(next)) setAmount(next);
                    }}
                    inputMode="decimal"
                    aria-invalid={Boolean(amountError)}
                  />
                  <b>USDC</b>
                </div>
                {amountError ? <em>{amountError}</em> : null}
              </label>

              <div className="quoteGrid">
                <div>
                  <span>Preview payout</span>
                  <strong>{formatUsdc(preview)} USDC</strong>
                </div>
                <div>
                  <span>Balance</span>
                  <strong>{formatUsdc(balance)} USDC</strong>
                </div>
                <div>
                  <span>Your UP</span>
                  <strong>{formatUsdc(upStake)} USDC</strong>
                </div>
                <div>
                  <span>Your DOWN</span>
                  <strong>{formatUsdc(downStake)} USDC</strong>
                </div>
              </div>

              <div className="marketFlow">
                <div className="marketFlowHeader">
                  <div>
                    <span><ReceiptText size={15} />Total volume</span>
                    <strong>
                      {formatUsdc(marketTradeVolume)} USDC
                    </strong>
                    <em>{marketTrades.length} fills</em>
                  </div>
                  <div>
                    <span><ArrowUp size={15} />UP volume</span>
                    <strong>{formatUsdc(marketTradeUpVolume)} USDC</strong>
                    <em>{marketTradeUpCount} fills</em>
                  </div>
                  <div>
                    <span><ArrowDown size={15} />DOWN volume</span>
                    <strong>{formatUsdc(marketTradeDownVolume)} USDC</strong>
                    <em>{marketTradeDownCount} fills</em>
                  </div>
                </div>
                {marketTradesError ? <div className="inlineError">{marketTradesError}</div> : null}
                <div className="tradeTapeHeader">
                  <div>
                    <span><UsersRound size={15} />Latest trades</span>
                    <strong>
                      {marketTrades.length === 0 ? "No fills" : `Showing ${tradeStartIndex + 1}-${tradeEndIndex} of ${marketTrades.length}`}
                    </strong>
                  </div>
                  <div className="pager" aria-label="Trade pagination">
                    <button
                      className="pageButton"
                      onClick={() => setTradePage((page) => Math.max(0, page - 1))}
                      disabled={safeTradePage === 0}
                      title="Previous trades"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="tradePageLabel">Page {safeTradePage + 1} / {tradePageCount}</span>
                    <button
                      className="pageButton"
                      onClick={() => setTradePage((page) => Math.min(tradePageCount - 1, page + 1))}
                      disabled={safeTradePage >= tradePageCount - 1}
                      title="Next trades"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="tradeTape">
                  {marketTradesLoading && pagedMarketTrades.length === 0 ? (
                    <div className="tapeEmpty">
                      <Loader2 size={16} className="spin" />
                      Loading trades
                    </div>
                  ) : pagedMarketTrades.length === 0 ? (
                    <div className="tapeEmpty">No fills yet.</div>
                  ) : (
                    pagedMarketTrades.map((item) => {
                      const isOwnTrade = currentAddressLower && item.user.toLowerCase() === currentAddressLower;
                      return (
                        <div key={item.id} className="tradePrint">
                          <span className={`tradeSide ${item.direction === DIRECTION_UP ? "up" : "down"}`}>
                            {item.direction === DIRECTION_UP ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                            {item.direction === DIRECTION_UP ? "UP" : "DOWN"}
                          </span>
                          <span>
                            <b>{formatUsdc(item.amount)} USDC</b>
                            <em>{isOwnTrade ? "You" : compactAddress(item.user)} · {formatTime(item.timestamp)}</em>
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="actionRow">
                {needsApproval ? (
                  <button className="primaryButton" onClick={approve} disabled={!isConnected || pending !== "" || Boolean(amountError)}>
                    {pending === "approve" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                    Approve USDC
                  </button>
                ) : (
                  <button className="primaryButton" onClick={placeBet} disabled={!canBet}>
                    {pending === "bet" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                    Sign Bet
                  </button>
                )}
                <button className="secondaryButton" onClick={settle} disabled={!market || pending !== ""}>
                  {pending === "settle" ? <Loader2 size={18} className="spin" /> : <Clock3 size={18} />}
                  Settle
                </button>
                <button className="secondaryButton" onClick={claim} disabled={!address || pending !== "" || (claimable ?? 0n) === 0n}>
                  {pending === "claim" ? <Loader2 size={18} className="spin" /> : <Wallet size={18} />}
                  Claim {formatUsdc(claimable)}
                </button>
                <button className="secondaryButton" onClick={refund} disabled={!address || pending !== "" || displayStatus !== STATUS_REFUNDING || refundable === 0n}>
                  {pending === "refund" ? <Loader2 size={18} className="spin" /> : <RotateCcw size={18} />}
                  Refund
                </button>
              </div>

              {canUseDevTools ? (
                <div className="devPanel">
                  <div>
                    <p className="eyebrow">LOCAL DEV</p>
                    <strong>Anvil tools</strong>
                  </div>
                  <div className="devActions">
                    <button className="secondaryButton" onClick={() => setMockOracle("up")} disabled={!market || pending !== ""}>
                      <ArrowUp size={18} />
                      Oracle UP
                    </button>
                    <button className="secondaryButton" onClick={() => setMockOracle("down")} disabled={!market || pending !== ""}>
                      <ArrowDown size={18} />
                      Oracle DOWN
                    </button>
                    <button className="secondaryButton" onClick={() => setMockOracle("tie")} disabled={!market || pending !== ""}>
                      <Activity size={18} />
                      Tie
                    </button>
                    <button className="secondaryButton" onClick={() => setMockOracle("invalid")} disabled={!market || pending !== ""}>
                      <RotateCcw size={18} />
                      Invalid
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : activeView === "Portfolio" ? (
          <section className="widePanel">
            <div className="wideHeader">
              <div>
                <p className="eyebrow">PORTFOLIO</p>
                <h2>Positions</h2>
              </div>
              <div className="summaryStrip">
                <span>
                  <Briefcase size={15} />
                  {formatUsdc(activeExposure)} USDC
                </span>
                <span>
                  <Gauge size={15} />
                  {formatUsdc(openClaimable)} Claimable
                </span>
              </div>
            </div>
            {!address ? <div className="emptyState">Connect wallet to view portfolio.</div> : null}
            {address && portfolioItems.length === 0 ? <div className="emptyState">No positions yet.</div> : null}
            <div className="positionList">
              {portfolioItems.map((item) => {
                const pool = item.totalUp + item.totalDown;
                const itemStatus = liveStatus(item.status, item.market, chainNowBigInt);
                return (
                  <button key={item.market.address} className="positionRow" onClick={() => openMarket(item.market)}>
                    <span className="assetBadge">{item.market.icon ?? item.market.baseSymbol ?? "MKT"}</span>
                    <span>
                      <b>{marketTitle(item.market)}</b>
                      <em>{item.market.label} · {statusLabels[itemStatus] ?? "Unknown"}</em>
                    </span>
                    <span>
                      <small>UP</small>
                      <strong>{formatUsdc(item.upStake)}</strong>
                    </span>
                    <span>
                      <small>DOWN</small>
                      <strong>{formatUsdc(item.downStake)}</strong>
                    </span>
                    <span>
                      <small>Claimable</small>
                      <strong>{formatUsdc(item.claimable)}</strong>
                    </span>
                    <span>
                      <small>Pool</small>
                      <strong>{formatUsdc(pool)}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="widePanel">
            <div className="wideHeader">
              <div>
                <p className="eyebrow">HISTORY</p>
                <h2>Trades</h2>
              </div>
              <button className="iconTextButton secondary" onClick={() => setHistoryVersion((value) => value + 1)} disabled={!address || historyLoading}>
                {historyLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                Refresh
              </button>
            </div>
            {!address ? <div className="emptyState">Connect wallet to view history.</div> : null}
            {historyError ? <div className="notice error">{historyError}</div> : null}
            {address && !historyLoading && history.length === 0 ? <div className="emptyState">No trades yet.</div> : null}
            <div className="historyList">
              {history.map((item) => (
                <button key={item.id} className="historyRow" onClick={() => openMarket(item.market)}>
                  <span className={`historyType ${item.type.toLowerCase()}`}>{item.type}</span>
                  <span>
                    <b>{marketTitle(item.market)}</b>
                    <em>
                      {item.direction ? (item.direction === DIRECTION_UP ? "UP" : "DOWN") : item.type} · {item.market.label}
                    </em>
                  </span>
                  <span>
                    <small>Amount</small>
                    <strong>{formatUsdc(item.amount)} USDC</strong>
                  </span>
                  <span>
                    <small>Time</small>
                    <strong>{formatTime(item.timestamp)}</strong>
                  </span>
                  <span>
                    <small>Tx</small>
                    <strong>{compactAddress(item.txHash)}</strong>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <aside className="rightRail">
          <div className="assurancePanel">
            <div className="railHeader">
              <ShieldCheck size={17} />
              <span>Controls</span>
            </div>
            <div className="controlGrid">
              <span>Market allowlist</span>
              <strong>On</strong>
              <span>Exact approval</span>
              <strong>On</strong>
              <span>Relayer limits</span>
              <strong>On</strong>
            </div>
          </div>
          <div className="assurancePanel compactPanel">
            <div className="railHeader">
              <BarChart3 size={17} />
              <span>Selected</span>
            </div>
            <dl className="metricList compact">
              <div>
                <dt>Market</dt>
                <dd>{compactAddress(market?.address)}</dd>
              </div>
              <div>
                <dt>UP Pool</dt>
                <dd>{formatUsdc(totalUp)}</dd>
              </div>
              <div>
                <dt>DOWN Pool</dt>
                <dd>{formatUsdc(totalDown)}</dd>
              </div>
              <div>
                <dt>Refundable</dt>
                <dd>{displayStatus === STATUS_REFUNDING ? formatUsdc(refundable) : "0.00"}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>
    </main>
  );
}
