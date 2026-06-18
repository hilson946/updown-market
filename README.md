# UP/DOWN Prediction Market MVP

Base EVM style MVP for short-horizon UP/DOWN prediction markets.

The first version is intentionally small:

- Immutable per-market contracts.
- USDC-denominated pari-mutuel pools.
- Trading opens one full prediction duration before `predictionStart` and closes at `predictionStart + 5 seconds`.
- Users sign EIP-712 bet intents.
- A relayer submits `betWithSig` and pays gas.
- Mock TWAP oracle for local development.
- Uniswap v3 TWAP adapter for Base deployments.

## Layout

```text
apps/web          Next.js trading UI
apps/relayer      Fastify relayer
packages/contracts Foundry contracts and tests
packages/shared   ABI, typed data helpers, deployment loader
scripts           local deploy and integration scripts
```

## Quick Start

Install dependencies:

```bash
pnpm install
```

Run contract tests:

```bash
pnpm test:contracts
```

Run the full local security gate:

```bash
pnpm audit:security
```

Run a local chain in one terminal:

```bash
pnpm dev:anvil
```

Deploy local contracts in another terminal:

```bash
pnpm deploy:local
```

Start the relayer:

```bash
pnpm dev:relayer
```

Start the web app:

```bash
pnpm dev:web
```

Open `http://localhost:3000`.

Web routes:

- `/` public dapp homepage with protocol summary, Docs, GitHub, and Launch App.
- `/app` wallet-connected trading desk.
- `/docs` product, testing, and security notes.

The relayer listens on `http://localhost:8790` by default. Port `8787` was intentionally avoided because it is already used on this machine.

## Local Flow

The local deployment script deploys:

- `MockUSDC`
- `FrontendRegistry`
- `MockTwapOracle`
- `PredictionMarketFactory`
- 28 default demo markets across crypto, DeFi, sports, macro, and AI categories

Each demo market still uses the same immutable UP/DOWN contract shape. Local non-crypto categories are mock-oracle examples for product testing, not production sports or macro oracle integrations.

Market timing is anchored to the prediction window. A 1m market predicting 10:00:00 to 10:01:00 accepts bets from 9:59:00 through 10:00:04; at 10:00:05 it is locked. A 5m market predicting 10:00:00 to 10:05:00 accepts bets from 9:55:00 through 10:00:04. A 1h market uses the same rule: bets are accepted from one hour before the prediction start through prediction start plus 5 seconds.

It writes addresses to `packages/shared/src/deployments/localhost.json`.

The web app includes a public homepage, docs page, market discovery, category filters, duration filters, a trading ticket, Portfolio, and History views. Local mock deployments also show a `Get test USDC` control after wallet connection.

Run the integration script with Anvil running:

```bash
pnpm integration:local
```

It executes:

```text
deploy -> mint -> approve -> sign bet -> relayer-style submit -> set oracle prices -> settle -> claim
```

## Production Oracle

Production deployments use `UniswapV3TwapOracleAdapter`, configured per market before trading starts. It reads Uniswap v3 pool observations for the market's prediction start and end timestamps, normalizes base/quote direction, and settles on the median tick score across 1 to 5 configured pools.

Read [docs/oracle-design.md](docs/oracle-design.md) before using it. The adapter returns a monotonic tick score, not a human-readable USD price.

## Base Deployment

Copy the deployment template:

```bash
cp .env.deploy.example .env.deploy
```

Deploy to Base Sepolia:

```bash
pnpm build
pnpm audit:security
pnpm deploy:base-sepolia
```

Mainnet deployment uses:

```bash
NETWORK=base-mainnet pnpm deploy:base-mainnet
```

Read [docs/deployment-base.md](docs/deployment-base.md) for network constants, required env vars, pool selection, and post-deploy checks.

## Security Notes

This code now includes a production TWAP adapter and local security tooling, but it is not externally audited yet. Do not represent it as audited, and do not deploy real-money mainnet markets until independent audit and compliance approval are complete.

Security docs:

- [SECURITY.md](SECURITY.md)
- [docs/security-audit-scope.md](docs/security-audit-scope.md)
- [docs/compliance-strategy.md](docs/compliance-strategy.md)
