# Security Policy

## Status

This project is not externally audited yet. Do not deploy real-money mainnet markets until:

- `pnpm audit:security` passes
- Base Sepolia deployment has been tested end to end
- an independent smart-contract audit is complete
- compliance approval is complete
- operational monitoring is live

## Reporting Vulnerabilities

For private deployments, report issues to the repository owner or project security contact. Include:

- affected contract or service
- exploit preconditions
- proof of concept or transaction trace
- impact estimate
- suggested mitigation, if known

Do not publicly disclose exploitable issues before the project owner has time to respond.

## Key Management

- Never commit `.env.deploy`, `.env.local`, private keys, mnemonic phrases, or RPC credentials.
- Use separate deployer and relayer keys.
- Use hardware wallet or multisig controls for mainnet deployments.
- Keep the relayer funded only with operational gas, not user funds.
- Rotate relayer keys immediately after suspected compromise.

## Production Controls

- Keep relayer market allowlists explicit.
- Keep CORS origins exact.
- Use paid/private RPC infrastructure for production.
- Monitor settlement failures, oracle invalid states, gas spikes, and repeated rejected intents.
- Keep generated deployment JSON and ABIs pinned per release.
