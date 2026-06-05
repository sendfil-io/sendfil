# ATOMIC Error Handling

This note documents the current ATOMIC batch execution boundary in `sendfil`.

## Scope

Current transaction-layer scope:

- `Standard` FEVM batch execution
- `ThinBatch` FEVM batch execution when the active network has a configured deployed address
- single-signer wallet path
- Filecoin Mainnet and Calibration network config
- `PARTIAL` and `ATOMIC` behavior in the batch builders, execution hooks, error mapper, telemetry, and review modal copy

Current live UI scope:

- `ATOMIC` is the default mode for the Standard execution method in `App.tsx`.
- `PARTIAL` is selectable only with configured ThinBatch.
- `App.tsx` passes the selected error mode into review estimation and send submission.

Out of scope:

- real wallet/public-testnet smoke verification
- ThinBatch deployment automation

## Semantic Contract

- `PARTIAL`: successful transfers may finalize even if another row fails.
- `ATOMIC`: any failing row reverts the full batch transaction.

For Standard, SendFIL encodes through `aggregate3Value(...)` only in `ATOMIC` mode. Standard `PARTIAL` is deliberately disabled because Multicall3 value calls with `allowFailure=true` do not refund failed call value; a failed allowed subcall would leave FIL at the Multicall3 contract. The all-or-revert guarantee comes from `allowFailure=false` on every call plus the live UI wiring that propagates `errorMode` from configuration through preflight and send.

For ThinBatch, the app encodes `ThinBatchPayer.payBatch(payments, errorMode)`. The contract validates the batch before any transfer. In `PARTIAL`, failed payment value is refunded to the caller; if the refund fails, the transaction reverts rather than leaving FIL in the contract. In `ATOMIC`, any failed payment reverts the whole transaction.

## Execution Pipeline

The active path is:

1. `App.tsx` collects validated recipients plus fee rows.
2. `useExecuteBatch` or `useExecuteNativeBatch` prepares a `PreparedBatchExecution` from the selected `executionMethod` and `errorMode`.
3. Review-step preflight calls the same FEVM batch builder used at send time.
4. ATOMIC execution reruns preflight before submission to block obvious full-batch reverts.
5. The wallet submits the prepared FEVM transaction, or a native `InvokeEVM` message carrying the prepared calldata.
6. Receipt tracking updates pending, confirmed, or failed state with a normalized execution error.

## Error Taxonomy

The domain error model is `BatchExecutionError` with these categories:

- `USER_REJECTED`
- `INSUFFICIENT_FUNDS`
- `INVALID_RECIPIENT`
- `SIMULATION_REVERT`
- `ONCHAIN_REVERT_ATOMIC`
- `RPC_FAILURE`
- `UNKNOWN`

The mapper lives in `src/lib/transaction/errorHandling.ts`.

## UX Copy Rules

- Review mode always shows an execution-semantics summary for the selected mode.
- ATOMIC preflight failures block send and explain that the whole batch would revert.
- ATOMIC failed-state copy explicitly says that no transfers were finalized.
- PARTIAL failed-state copy is ThinBatch-specific and describes best-effort finalized transfers plus failed-payment refund behavior.

## Telemetry

The client emits structured telemetry from `src/lib/transaction/telemetry.ts`:

- `batch_preflight_succeeded`
- `batch_preflight_failed`
- `batch_submission_requested`
- `batch_submitted`
- `batch_confirmed`
- `batch_failed`

Each event includes `executionMethod`, `errorMode`, `recipientCount`, `totalValueAttoFil`, network identity, and any available gas estimate, transaction hash, or normalized error category.

## Test Coverage

Implemented coverage:

- unit tests for `allowFailure` invariants in `buildMulticallBatch`
- unit tests that block Standard `PARTIAL` preparation
- unit tests for ThinBatch `errorMode` calldata
- unit tests for execution-error classification
- component tests for ATOMIC review and failure messaging
- Playwright review-flow coverage for ATOMIC selection, ATOMIC preflight blocking, and PARTIAL regression paths

## Rollback

The code does not currently ship a production feature flag for ATOMIC mode. Do not roll Standard back to Partial: Multicall3 value-call partial execution is not refund-safe. Operational rollback would need to disable Standard sends or route best-effort batches through configured ThinBatch while leaving the lower-level Atomic builder support intact.
