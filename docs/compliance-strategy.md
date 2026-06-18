# Compliance Strategy

This document is not legal advice. It is an engineering and product checklist for counsel, compliance, and operations before public launch.

## Product Classification

UP/DOWN markets can be treated as prediction markets, event contracts, derivatives, gaming, or gambling depending on jurisdiction, market subject, custody model, marketing, user location, and settlement design. Sports markets are especially sensitive and may require gambling licenses, sports-betting approvals, or licensed data feeds.

Do not launch real-money markets until qualified counsel approves the target jurisdictions and operating model.

## Launch Gating

Before mainnet access:

- define allowed jurisdictions and blocked jurisdictions
- implement IP geofencing and wallet-level eligibility checks where required
- implement sanctions screening
- define age restrictions and responsible-gaming controls
- decide whether KYC/AML is required for deposits, withdrawals, large wins, or all users
- publish risk disclosures and market rules
- define tax reporting obligations
- define record retention policy for orders, signatures, settlement data, relayer logs, and frontend attribution

## Sports Markets

Sports markets need additional controls:

- licensed odds/result data providers where required
- rules for cancellations, delays, abandoned games, replayed games, and statistic corrections
- clear lock times before event start
- jurisdiction-specific restrictions
- market surveillance for suspicious betting
- responsible-gaming limits and self-exclusion

The current MVP is crypto UP/DOWN only. Sports markets should not be enabled by simply changing frontend labels.

## Frontend And Affiliate Controls

The `frontendId` system supports attribution, but compliance owns which frontends are allowed.

Recommended controls:

- onboard frontend operators before registering IDs
- require legal terms for every frontend partner
- freeze or deactivate non-compliant frontend IDs in `FrontendRegistry`
- monitor frontend volume, suspicious traffic, and user complaints
- do not pay revenue share to sanctioned or unverified entities

## Relayer Controls

The relayer is not custodying user funds, but it can affect user experience and transaction submission.

Required controls:

- explicit `ALLOWED_MARKETS`
- exact CORS origins
- request body limits
- rate limits by IP and market
- max bet size
- signature verification before submission
- structured logs and alerting
- separate keys for deployer and relayer
- rapid key rotation procedure

## Market Governance

Immutable markets reduce admin abuse, but market creation is still a governance surface.

Before creating a market:

- verify asset pair and pool list
- verify TWAP window and minimum liquidity
- verify market duration and trading window
- verify public disclosures and jurisdiction rules
- document operator approval

## User Disclosures

The frontend should disclose:

- users can lose all wagered funds
- odds are pari-mutuel and change as the pool changes
- tied, invalid, one-sided, or oracle-failed markets refund
- relayer downtime does not prevent direct contract interaction
- Base finality and timestamp behavior affect settlement timing
- smart contracts and oracle design can have bugs until audited

## Mainnet Hold

Mainnet should remain blocked until:

- external audit completed
- audit fixes merged and re-tested
- compliance sign-off completed
- monitoring and incident response are live
- production RPC and relayer infrastructure are ready
- insurance/treasury/legal risk decisions are documented
