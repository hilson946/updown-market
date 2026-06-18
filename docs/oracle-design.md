# Oracle Design

## Production Adapter

`UniswapV3TwapOracleAdapter` is the production oracle adapter for Base deployments. Each market is configured once before trading starts. A configuration binds:

- `baseToken` and `quoteToken`
- 1 to 5 Uniswap v3 pool addresses for that pair
- a TWAP window between 10 seconds and 1 day
- a minimum pool liquidity threshold

The adapter reads `predictionStart()` and `predictionEnd()` from the immutable market contract, then computes a TWAP tick ending at each timestamp. If any configured pool cannot provide observations, has insufficient liquidity, has malformed return arrays, or the requested target is in the future, the adapter returns `valid = false`; the market then enters refund mode.

## Median Across Pools

For each timestamp, every pool returns a TWAP tick. Pools whose `token0/token1` order is reversed relative to `baseToken/quoteToken` are normalized by negating the tick. The adapter sorts the normalized ticks and returns the median. For an even number of pools, it returns the average of the two middle ticks.

This protects against a single manipulated pool when at least three independent, deep pools are configured. It does not protect against all configured pools moving together or against liquidity disappearing before settlement.

## Tick Score

The market only needs ordering, not a human-readable USD price. The adapter returns:

```text
score = normalizedTick + 1_000_000
```

An end score above the start score means UP wins. An equal score triggers refund. The score must not be displayed as a dollar price.

## Pool Requirements

Before production deployment:

- Use the official Uniswap v3 factory or Uniswap Info to derive pool addresses.
- Choose pools with deep liquidity and active observations for the target asset pair.
- Confirm every pool has sufficient observation cardinality for `TWAP_WINDOW_SECONDS`.
- Prefer several fee tiers when they all have meaningful liquidity.
- Set `MIN_POOL_LIQUIDITY` above dust/liquidity-spoofing levels.

## Failure Behavior

Oracle failure is intentionally conservative:

- unconfigured market: refund
- settlement before prediction end: invalid from adapter, market also blocks early settlement
- missing pool observation: refund
- insufficient pool liquidity: refund
- tied start/end tick score: refund
- one-sided betting pool: refund

The product should surface refund states clearly in the frontend and relayer.
