# ATOMIC Error Handling

This note documents the current ATOMIC batch execution behavior in `sendfil`.

## Scope

Current live scope:

- `Standard` FEVM batch execution only
- single-signer wallet path
- Filecoin Mainnet wagmi config
- `PARTIAL` and `ATOMIC` error handling in the live App flow

Out of scope:

- `ThinBatch`
- Filecoin-native signer execution in the main UI
- end-to-end Calibration rollout

## Semantic contract

- `PARTIAL`: internal calls set `allowFailure=true`. Successful transfers may finalize even if another call fails.
- `ATOMIC`: internal calls set `allowFailure=false`. Any failing internal call reverts the full `aggregate3Value(...)` transaction.

Both modes still encode through `aggregate3Value(...)`. There is no separate `aggregate3(...)` encoding path in this repo today. The all-or-revert guarantee comes from `allowFailure=false` on every call plus the live UI wiring that now propagates `errorMode` from configuration through preflight and send.

## Execution pipeline

The active path is:

1. `App.tsx` collects validated recipients plus fee rows.
2. `useExecuteBatch` prepares a `PreparedBatchExecution` from the selected `errorMode`.
3. Review-step preflight calls the same FEVM batch builder used at send time.
4. ATOMIC execution reruns FEVM preflight before submission to block obvious full-batch reverts.
5. The wallet submits the multicall transaction through wagmi.
6. Receipt tracking updates pending, confirmed, or failed state with a normalized execution error.

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

## Telemetry

The client emits structured telemetry from `src/lib/transaction/telemetry.ts`:

- `batch_preflight_succeeded`
- `batch_preflight_failed`
- `batch_submission_requested`
- `batch_submitted`
- `batch_confirmed`
- `batch_failed`

Each event includes `errorMode`, `recipientCount`, `totalValueAttoFil`, and any available gas estimate, transaction hash, or normalized error category.

## Test coverage

Implemented coverage:

- unit tests for `allowFailure` invariants in `buildMulticallBatch`
- unit tests for execution-error classification
- component tests for ATOMIC review and failure messaging
- Playwright review-flow coverage for ATOMIC selection, ATOMIC preflight blocking, and PARTIAL regression paths

## Rollback

The code does not currently ship a production feature flag for ATOMIC mode. Operational rollback would mean reverting the ATOMIC selection wiring in `App.tsx` and restoring the selector guard, while leaving the lower-level batch builder support intact.
