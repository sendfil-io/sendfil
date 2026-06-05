# ATOMIC Error Handling

This note documents the current ATOMIC batch execution boundary in `sendfil`.

## Scope

Current transaction-layer scope:

- `Standard` FEVM batch execution only
- single-signer wallet path
- Filecoin Mainnet and Calibration network config
- `PARTIAL` and `ATOMIC` behavior in the batch builder, execution hooks, error mapper, telemetry, and review modal copy

Current live UI scope:

- `PARTIAL` is the only selectable mode in `App.tsx`.
- Selecting `ATOMIC` opens the unavailable-capability modal and leaves the batch on `PARTIAL`.
- `App.tsx` currently passes `PARTIAL` into review estimation and send submission.

Out of scope:

- `ThinBatch`
- making `ATOMIC` user-selectable in the live app UI

## Semantic contract

- `PARTIAL`: internal calls set `allowFailure=true`. Successful transfers may finalize even if another call fails.
- `ATOMIC`: internal calls set `allowFailure=false`. Any failing internal call reverts the full `aggregate3Value(...)` transaction.

Both modes still encode through `aggregate3Value(...)`. There is no separate `aggregate3(...)` encoding path in this repo today. The all-or-revert guarantee comes from `allowFailure=false` on every call. That behavior is available to callers that pass `ATOMIC` into the transaction hooks, but the live `App.tsx` UI does not currently pass `ATOMIC`.

## Execution pipeline

The transaction-layer path is:

1. `App.tsx` collects validated recipients plus fee rows.
2. `useExecuteBatch` prepares a `PreparedBatchExecution` from the selected `errorMode`.
3. Review-step preflight calls the same FEVM batch builder used at send time.
4. ATOMIC execution reruns FEVM preflight before submission to block obvious full-batch reverts.
5. The wallet submits the multicall transaction through wagmi.
6. Receipt tracking updates pending, confirmed, or failed state with a normalized execution error.

Current live-app caveat: in the present UI, step 2 always receives `PARTIAL` from `App.tsx`. The ATOMIC path above is covered by lower-level tests and component copy, but it is not reachable from the main user flow until the selector gate is removed and E2E coverage is updated.

## Error taxonomy

The domain error model is `BatchExecutionError` with these categories:

- `USER_REJECTED`
- `INSUFFICIENT_FUNDS`
- `INVALID_RECIPIENT`
- `SIMULATION_REVERT`
- `ONCHAIN_REVERT_ATOMIC`
- `RPC_FAILURE`
- `UNKNOWN`

The mapper lives in `src/lib/transaction/errorHandling.ts`.

## UX copy rules

- Review mode always shows an execution-semantics summary for the selected mode.
- ATOMIC preflight failures block send and explain that the whole batch would revert.
- ATOMIC failed-state copy explicitly says that no transfers were finalized.
- PARTIAL failed-state copy preserves the possibility that some transfers may already be finalized.

Current live-app caveat: these ATOMIC copy rules are implemented in `ReviewTransactionModal`, but they only render when the modal receives an ATOMIC configuration from tests or lower-level callers.

## Telemetry

The client emits structured telemetry from `src/lib/transaction/telemetry.ts`:

- `batch_preflight_succeeded`
- `batch_preflight_failed`
- `batch_submission_requested`
- `batch_submitted`
- `batch_confirmed`
- `batch_failed`

Each event includes `errorMode`, `recipientCount`, `totalValueAttoFil`, network identity, and any available gas estimate, transaction hash, or normalized error category.

## Test coverage

Implemented coverage:

- unit tests for `allowFailure` invariants in `buildMulticallBatch`
- unit tests for execution-error classification
- component tests for ATOMIC review and failure messaging
- Playwright review-flow coverage that asserts ATOMIC selection remains blocked in the live UI and that the batch continues with PARTIAL semantics

## Rollback

The code currently ships with the ATOMIC selector guard in place. Enabling ATOMIC in the live app should be a small but explicit product change: pass `batchConfiguration.errorHandling` into estimate/send, update E2E expectations, and keep `PARTIAL` as the default. Operational rollback would restore the selector guard while leaving the lower-level batch builder support intact.
