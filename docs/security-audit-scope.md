# Security Audit Scope

## Scope

In scope:

- `packages/contracts/src/PredictionMarket.sol`
- `packages/contracts/src/PredictionMarketFactory.sol`
- `packages/contracts/src/FrontendRegistry.sol`
- `packages/contracts/src/UniswapV3TwapOracleAdapter.sol`
- interfaces used by those contracts
- relayer request validation and transaction submission path
- deployment scripts for Base Sepolia/Mainnet

Out of scope for the first code review unless explicitly added:

- mock contracts except where they affect tests
- frontend visual implementation
- third-party Uniswap v3 contracts
- token contracts such as USDC/WETH

## Core Security Properties

- Market contracts are immutable after deployment.
- Fee bps are fixed per factory and capped at `150`.
- Trading opens at `predictionStart - predictionDuration` and closes at `predictionStart + 5 seconds`.
- No bets are accepted before `tradingStart` or after `tradingEnd`.
- EIP-712 bet signatures are bound to chain ID and market address.
- Nonces prevent replay per user per market.
- High-s ECDSA signatures are rejected.
- Funds are held in the market contract until settle/refund/claim.
- Anyone can trigger settlement after `predictionEnd`.
- Invalid oracle state, tied price, or one-sided pool forces refund mode.
- `claimFor` and `refundFor` pay the target user, not the relayer.
- Per-market total pool is capped at `uint128.max` to keep payout math inside uint256 multiplication bounds.

## Local Checks

Run:

```bash
pnpm audit:security
```

This executes:

- Foundry tests: 23 tests currently pass.
- Foundry coverage: total line coverage is currently about 84.6%.
- Slither high-gate: high-severity false positives are excluded after triage; remaining medium/low/info findings are printed.
- Halmos: 3 symbolic properties currently pass.

Halmos properties cover:

- fee never exceeds total pool when fee bps is within cap
- pool-cap logic keeps accepted total pool inside `uint128.max`
- tick-score mapping preserves tick ordering

## Slither Triage

The security script excludes these high-severity false positives:

- `arbitrary-send-erc20`: `betWithSig` uses `transferFrom(intent.user, ...)`, but the contract verifies an EIP-712 signature from `intent.user`, binds it to the market address and chain ID, rejects replayed nonces, and rejects high-s signatures.
- `weak-prng`: modulo is used for deterministic median parity and Uniswap v3 negative tick rounding, not randomness.

Remaining findings and disposition:

- `incorrect-equality`: deterministic odd/even median branch; acceptable but auditors should review.
- `calls-loop`: adapter calls up to 5 configured pools; bounded by `MAX_POOLS`.
- `timestamp`: market windows are intentionally timestamp-based. Base block timestamp manipulation tolerance must be included in risk acceptance.
- `assembly`: signature parsing in `_recover`; isolated and covered by signature tests.
- `cyclomatic-complexity`: `betWithSig` validation path is dense; tests cover replay, tampering, frontend state, signature malleability, and window checks.

## External Audit Requirements

Before mainnet:

- independent smart-contract audit by a reputable firm
- focused review of TWAP manipulation, pool selection, observation cardinality, and timestamp tolerance
- formal review or stronger proof for payout arithmetic and refund invariants
- deployment dry run on Base Sepolia with production-like pool configuration
- relayer abuse review: allowlist, rate limits, CORS, gas griefing, duplicate submits, log monitoring
- incident response tabletop for oracle invalidation, settlement failures, and relayer key compromise

Do not represent the system as audited until the external audit is complete and public or privately delivered.
