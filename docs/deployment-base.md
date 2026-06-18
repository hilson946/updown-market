# Base Deployment Runbook

## Networks

The deployment script supports:

- Base Sepolia: chain ID `84532`
- Base Mainnet: chain ID `8453`

The public Base RPC endpoints are useful for testing but are rate-limited and should not be used for production systems. Use a paid node provider or your own node for mainnet.

## Official References

- Base network parameters: https://docs.base.org/base-chain/quickstart/connecting-to-base
- Uniswap v3 Base deployments: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
- USDC addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses

Current Uniswap v3 factory addresses used by the script for operator verification:

- Base Mainnet: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`
- Base Sepolia: `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`

WETH on Base and Base Sepolia is `0x4200000000000000000000000000000000000006` per Uniswap's Base deployment docs. Native USDC on Base mainnet is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; verify token addresses again before deployment.

## Prepare Environment

```bash
cp .env.deploy.example .env.deploy
```

Set:

- `NETWORK=base-sepolia` or `base-mainnet`
- `BASE_SEPOLIA_RPC_URL` or `BASE_MAINNET_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `COLLATERAL_ADDRESS`
- `BASE_TOKEN`
- `QUOTE_TOKEN`
- `POOL_ADDRESSES`
- `FEE_VAULT`
- `FRONTEND_PAYOUT`

Optional timing:

- `TRADING_START_DELAY_SECONDS` controls how soon the betting window opens after deployment. For each duration, `predictionStart = current block time + predictionDuration + TRADING_START_DELAY_SECONDS`, so a 5m market opens for betting after the delay and predicts the following 5-minute window.

For production, the deployer key should be controlled by a hardware wallet or a short-lived deployment wallet funded only for the deployment. Do not reuse the relayer key.

## Deploy

```bash
pnpm install
pnpm build
pnpm audit:security
pnpm deploy:base-sepolia
```

For mainnet:

```bash
NETWORK=base-mainnet pnpm deploy:base-mainnet
```

The script writes:

- `packages/shared/src/deployments/base-sepolia.generated.json`
- `packages/shared/src/deployments/base-sepolia.relayer.env.example`
- matching `base-mainnet.*` files for mainnet

These generated files are ignored by git. Copy the generated deployment JSON into the release artifact or deployment secret store used by the frontend.

## Relayer

The generated relayer env file contains:

- RPC URL
- chain ID
- CORS origin placeholder
- market allowlist
- max bet size
- rate limit settings

Before production:

- replace `RELAYER_PRIVATE_KEY`
- set `CORS_ORIGIN` to the exact frontend origin
- keep `ALLOWED_MARKETS` explicit
- fund the relayer with enough ETH for settlement/claim/refund gas
- monitor failed simulations and high gas spikes

## Post-Deploy Checklist

- Verify every contract address on the Base explorer.
- Confirm `FrontendRegistry` has the expected frontend ID and payout address.
- Confirm each market uses the TWAP adapter, not the mock oracle.
- Confirm adapter config for each market: base token, quote token, pool list, TWAP window, minimum liquidity.
- Dry-run a tiny Sepolia market end to end before mainnet.
- Do not create mainnet markets until external audit sign-off and compliance approval are complete.
