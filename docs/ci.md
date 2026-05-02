# CI Policy

Default CI is the merge gate for implemented SendFIL behavior. It must be green
on `main`, and red default CI means the PR should not merge.

SendFIL is a client-only app, so tests must not depend on live wallets, real
transactions, live RPC calls, secrets, or `.env.local`.

## Local Commands

- `yarn ci:verify`: lint, typecheck, unit tests, and build.
- `yarn test:e2e:smoke`: Playwright smoke tests for the review/send flow.
- `yarn ci:all`: `ci:verify` plus e2e smoke.
- `yarn test:future`: future/target invariant tests that are not part of
  default CI.

## Test Lanes

- Unit and invariant tests live under `src/**/*.{test,spec}.{ts,tsx}`.
- E2E smoke tests live under `tests/e2e`.
- Future target tests use `*.future.test.*` or `*.future.spec.*`.

Default `yarn test` and `yarn test:unit` run implemented behavior only. Future
tests are excluded from the default lane.

## Future-Test Policy

Expected-red tests do not live in default CI. If a test describes required
product behavior that is not implemented yet, keep it visible as a future test
and run it intentionally with `yarn test:future`.

When the implementation lands, move the test out of the future lane so default
CI protects that behavior.

## SendFIL Rules

- Do not add tests that send real transactions.
- Do not require a real browser wallet or extension.
- Do not call live RPC from CI tests.
- Do not require secrets for default CI.
- Red-zone changes need targeted tests.

Red-zone areas include transaction builders, wallet signing/submission,
`msg.value` or value accounting, amount parsing, network gating, RPC guardrails,
and fee rows.

## Merge Rule

Do not merge unless GitHub Actions are green. If CI is red because a test covers
future behavior, move that test into the future lane and document the gap instead
of letting `main` stay red.
