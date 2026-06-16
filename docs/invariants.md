# SendFIL Invariant Catalog

An invariant in this repo is a product-level rule that must remain true across refactors, UI changes, and agent-generated code.

These rules are durable safety constraints for the live app path. They are grounded in the DevSpec, current repo docs, and current implementation. Status values describe current repo reality, not the target state in isolation.

Use this catalog before changing validation, network gating, review/send flow, RPC guardrails, or transaction preparation.

## Status Legend

- `implemented`
- `partial`
- `not implemented`
- `blocked`
- `unknown`

## Invariant Index

| ID | Rule | Status | Boundary | Test files |
|---|---|---|---|---|
| `INV-ADDR-001` | Accept valid `f1/f2/f3/f4/0x` recipients | `implemented` | validation | `src/utils/__tests__/recipientValidation.test.ts` |
| `INV-ADDR-002` | Reject `f0` recipients | `implemented` | validation | `src/utils/__tests__/recipientValidation.test.ts`, `src/lib/transaction/__tests__/multicall.test.ts` |
| `INV-ADDR-003` | Treat `0x` and `f4` twins as the same recipient identity internally | `partial` | validation, duplicate detection, transaction builder | `src/utils/__tests__/recipientValidation.test.ts`, `src/lib/transaction/__tests__/multicall.test.ts` |
| `INV-AMT-001` | Reject blank, zero, and negative amounts | `implemented` | validation, amount parsing | `src/utils/__tests__/recipientValidation.test.ts` |
| `INV-AMT-002` | Reject over-precise values and preserve exact accepted values | `partial` | validation, amount parsing, execution value preservation | `src/utils/__tests__/recipientValidation.test.ts` |
| `INV-BATCH-001` | Enforce the 500-recipient cap | `implemented` | validation | `src/utils/__tests__/recipientValidation.test.ts` |
| `INV-DUP-001` | Duplicate recipients require explicit confirmation before Send | `implemented` | duplicate detection, review UI gating | `src/utils/__tests__/recipientValidation.test.ts`, `src/components/__tests__/ReviewTransactionModal.test.tsx`, `tests/e2e/review-flow.spec.ts` |
| `INV-NET-001` | Wrong network disables Send | `implemented` | network/wallet gating, review UI gating | `src/lib/senders/__tests__/connectedSender.test.ts`, `src/__tests__/app.invariants.test.tsx` |
| `INV-BAL-001` | Submit-time balance recheck blocks EVM sends when current balance is insufficient | `implemented` | submit guard, wallet RPC | `src/lib/transaction/__tests__/submitBalanceCheck.test.ts`, `src/lib/transaction/__tests__/useExecuteBatch.submitBalance.test.tsx` |
| `INV-RPC-001` | Contract recipients detected via `eth_getCode` are blocked | `implemented` | RPC contract-recipient check, review UI gating | `src/__tests__/contractRecipientGuard.test.tsx`, `src/utils/__tests__/contractRecipientGuard.test.ts` |
| `INV-EXEC-001` | Review estimate and submission use the same execution config | `implemented` | estimate/execute flow, transaction builder | `src/lib/transaction/__tests__/batchExecution.test.ts`, `src/lib/transaction/__tests__/thinBatch.test.ts`, `src/lib/transaction/__tests__/nativeBatchPreflight.test.ts`, `src/__tests__/app.invariants.test.tsx` |

## INV-ADDR-001 — Accept valid `f1/f2/f3/f4/0x` recipients

### Rule
The shared recipient validation path must accept valid recipient rows for `f1`, `f2`, `f3`, `f4`, and `0x` address types. Acceptance must happen through the same validator used by manual entry and CSV review.

### Why this matters
If support regresses for any accepted recipient type, valid payouts become impossible or diverge between input paths.

### Execution boundary
validation

### Acceptance criteria
- Valid `f1`, `f2`, `f3`, `f4`, and `0x` rows are accepted with positive amounts.
- Accepted rows are returned in `validRecipients`.
- Accepted rows do not also produce validation errors.
- `f2/t2` actor recipients produce a non-blocking value-transfer notice.
- Whitespace trimming stays invisible to the user.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-ADDR-001 recipient acceptance', ...)`
  - `it('accepts valid f1, f2, f3, f4, and 0x recipients through the shared validator')`
  - `it('trims surrounding whitespace before validating supported recipients')`
  - `it('emits a non-blocking value-transfer notice for actor recipients')`

### Status
`implemented`

## INV-ADDR-002 — Reject `f0` recipients

### Rule
`f0` recipients are rejected as unsupported ID addresses. The app must reject them rather than resolve them to another format.

### Why this matters
ID-address acceptance would silently change send targets and violate the client-only validation model.

### Execution boundary
validation

### Acceptance criteria
- `f0` rows are rejected.
- `t0` rows are rejected when testnet-form inputs are validated.
- Error copy identifies `f0/t0` ID addresses as unsupported.
- Rejected rows are absent from `validRecipients`.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-ADDR-002 f0 rejection', ...)`
  - `it('rejects f0 and t0 recipients as unsupported ID addresses')`
- `src/lib/transaction/__tests__/multicall.test.ts`
  - `it('INV-ADDR-002 rejects malformed recipient inputs before encoding')`

### Status
`implemented`

## INV-ADDR-003 — Treat `0x` and `f4` twins as the same recipient identity internally

### Rule
Equivalent `0x` and `f4` encodings must collapse to the same internal EVM identity for duplicate detection and execution routing.

### Why this matters
If twin encodings are treated as distinct identities, duplicate warnings break and the builder can send inconsistent payloads for the same destination.

### Execution boundary
validation, duplicate detection, transaction builder

### Acceptance criteria
- Duplicate detection is based on canonical identity, not raw string equality.
- A `0x` address and its `f4` twin emit duplicate warnings.
- Builder output canonicalizes both encodings to the same direct EVM target.
- `0x` and `f4` recipients stay on the direct EVM transfer path.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-ADDR-003 twin identity handling', ...)`
  - `it('treats a 0x address and its f4 twin as the same duplicate identity')`
  - `it('treats a 0x address and its t4 twin as the same duplicate identity on Calibration')`
- `src/lib/transaction/__tests__/multicall.test.ts`
  - `it('INV-ADDR-003 canonicalizes 0x and f4 twins to the same EVM transfer target')`

### Status
`partial`

Current repo note: duplicate detection already treats `0x` and `f4`/`t4` twins as the same identity.
The transaction builder routes both raw `0x` and delegated EVM forms to direct EVM value transfers.
Treat the broader DevSpec canonicalization requirement as partial until display, review, duplicate
identity, and execution target normalization are deliberately documented as one end-to-end contract.

## INV-AMT-001 — Reject blank, zero, and negative amounts

### Rule
Blank, zero, and negative FIL amounts are invalid and must be blocked by validation before review submission.

### Why this matters
Allowing empty or non-positive values produces incorrect totals, confusing review states, and unsafe sends.

### Execution boundary
validation, amount parsing

### Acceptance criteria
- Blank and whitespace-only amounts are rejected.
- Zero values are rejected.
- Negative values are rejected.
- Tiny positive values above zero remain valid.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-AMT-001 amount sign and presence rules', ...)`
  - `it('rejects blank, zero, and negative amount strings')`
  - `it('accepts a tiny positive value at 1 attoFIL')`

### Status
`implemented`

## INV-AMT-002 — Reject over-precise values and preserve exact accepted values

### Rule
FIL-denominated inputs may use at most 18 decimal places. Over-precise values must be rejected rather than rounded or truncated.

### Why this matters
If precision silently changes, users can send the wrong value and review totals stop matching execution inputs.

### Execution boundary
validation, amount parsing, execution value preservation

### Acceptance criteria
- Whole values pass.
- Exactly 18 decimal places pass.
- 19 decimal places fail.
- Over-precise rows are excluded from `validRecipients`.
- Error copy communicates the 18-decimal rule.
- Accepted 18-decimal values keep exact value semantics through fee calculation and execution.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-AMT-002 precision rules', ...)`
  - `it('accepts values with up to 18 decimal places')`
  - `it('rejects values with more than 18 decimal places')`

### Status
`partial`

Current repo note: the shared validator correctly accepts up to 18 decimal places and rejects more
than 18. The live App still converts normalized amount strings to JavaScript `Number` values before
fee calculation and execution, so exact end-to-end preservation for all valid 18-decimal FIL inputs
remains a gap.

## INV-BATCH-001 — Enforce the 500-recipient cap

### Rule
The shared validation pipeline must cap batches at 500 non-empty recipient rows.

### Why this matters
Losing the boundary increases execution risk, review noise, and wallet transaction size beyond the intended v1 operating envelope.

### Execution boundary
validation

### Acceptance criteria
- Exactly 500 non-empty valid rows are allowed.
- 501 non-empty valid rows are rejected.
- Intentionally blank rows do not count toward the cap.
- Error copy names the 500-recipient limit.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-BATCH-001 batch size cap', ...)`
  - `it('accepts exactly 500 non-empty recipients')`
  - `it('rejects 501 non-empty recipients')`
  - `it('ignores blank rows when enforcing the 500-recipient cap')`

### Status
`implemented`

## INV-DUP-001 — Duplicate recipients require explicit confirmation before Send

### Rule
Duplicates are warnings, not hard row errors, but Send must remain disabled until the sender explicitly acknowledges them in Review.

### Why this matters
Duplicate rows can be intentional, but silent submission without acknowledgment makes accidental double-pays easy.

### Execution boundary
duplicate detection, review UI gating

### Acceptance criteria
- Duplicate rows emit warnings.
- Duplicate warnings do not become hard validation errors by themselves.
- Review shows a duplicate warning panel.
- Send is disabled until the duplicate acknowledgment control is checked.
- The same rule applies to manual entry and CSV review.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-DUP-001 duplicate warning behavior', ...)`
  - `it('emits duplicate warnings for repeated 0x rows without turning them into errors')`
- `src/components/__tests__/ReviewTransactionModal.test.tsx`
  - `it('INV-DUP-001 requires duplicate acknowledgment before enabling send')`
  - `it('INV-DUP-001 resets duplicate acknowledgment when the modal reopens')`
- `tests/e2e/review-flow.spec.ts`
  - `manual review requires duplicate acknowledgment before send is enabled`
  - `csv review preserves duplicate warnings and requires acknowledgment`

### Status
`implemented`

## INV-NET-001 — Wrong network disables Send

### Rule
The live app flow must not allow a batch to be submitted while the wallet is on an unsupported network.

### Why this matters
Chain mismatch can send the batch through the wrong execution environment or make estimates and explorer links meaningless.

### Execution boundary
network/wallet gating, review UI gating

### Acceptance criteria
- Unsupported chain state shows wrong-network copy.
- Review progression is blocked while wrong-network state is active.
- No estimate or execute call fires while the block is active.

### Tests
- `src/__tests__/app.invariants.test.tsx`
  - `describe('INV-NET-001 wrong network gating', ...)`
  - `it('blocks review and send while the wallet is connected to an unsupported chain')`
- `src/lib/senders/__tests__/connectedSender.test.ts`
  - `describe('connected sender state', ...)`
  - `it('keeps unsupported EVM networks connected but disables network-scoped reads')`
  - `it('models native f1/t1 senders as live send-capable when their provider can sign and submit')`

### Status
`implemented`

Current repo note: the live block happens at the App review boundary, not by a wallet-driven switch action inside the review modal. `src/lib/senders/useConnectedSender.ts` now centralizes the live connected-sender state for the App. It exposes the EVM/wagmi sender path and the native Filecoin sender path when the connected native provider can sign, submit, read balance, and preserve one-approval batch behavior.

## INV-BAL-001 — Submit-Time Balance Recheck

### Rule
The existing EVM/wagmi and native Filecoin submit paths must re-read the connected sender balance immediately before wallet submission. The batch must not be submitted unless current balance covers the prepared batch transfer value plus the latest estimated network fee.

### Why this matters
The review-time balance can become stale if the sender spends or receives FIL while the review modal is open. Sending without a fresh check can push an avoidable insufficient-funds request into the wallet.

### Execution boundary
submit guard, wallet RPC

### Acceptance criteria
- The recheck runs after submit-time gas estimation and before wallet submission.
- Required balance includes prepared transfer value, which contains recipient rows and appended fee rows, plus estimated network fee.
- If current balance is insufficient, wallet submission is not called.
- Unsupported network state cannot bypass the submit guard.
- Native Filecoin senders use the Lotus balance reader before native message signing and `MpoolPush`.

### Tests
- `src/lib/transaction/__tests__/submitBalanceCheck.test.ts`
  - `describe('submit-time balance recheck helper', ...)`
- `src/lib/transaction/__tests__/useExecuteBatch.submitBalance.test.tsx`
  - `describe('useExecuteBatch submit-time balance recheck', ...)`

### Status
`implemented`

Current repo note: this is implemented for the live EVM/wagmi sender path and the native Filecoin sender path wired through `useExecuteNativeBatch`.

## INV-RPC-001 — Contract recipients detected via `eth_getCode` are blocked

### Rule
EVM recipients (`0x` or `f4`) with deployed bytecode must be blocked before Send can proceed, using the public-client `getCode` / `eth_getCode` path or an equivalent check. The check applies to the final prepared payment destinations, including app-appended fee rows.

### Why this matters
The v1 product scope only supports EVM EOAs as `0x`/`f4` recipients. Contract recipients can absorb value in ways that do not match the batch sender’s intent.

### Execution boundary
RPC contract-recipient check, review UI gating

### Acceptance criteria
- `getCode` is used for `0x` and `f4` recipients.
- Empty code (`0x`) is treated as EOA-like and allowed.
- Non-empty code blocks review/send.
- Native `f1/f2/f3` recipients do not invoke this check.
- Appended EVM fee rows are checked before estimate/send.
- Send is disabled and execution is not triggered when any EVM contract recipient is present.

### Tests
- `src/__tests__/contractRecipientGuard.test.tsx`
  - `describe('INV-RPC-001 contract recipient guard', ...)`
  - `it('does not require getCode for native Filecoin recipients')`
  - `it('blocks send when an EVM recipient resolves to deployed bytecode')`
  - `it('blocks send when an f4 twin resolves to deployed bytecode')`
  - `it('fails closed when EVM recipient code cannot be verified')`
  - `it('checks appended EVM fee rows before estimating or sending')`

### Status
`implemented`

Current repo note: the FEVM review/send flow checks final payment destinations with `getCode` before review estimation and repeats the check before submit. That includes user-entered `0x` and `f4` recipients plus appended EVM fee rows. Native `f1/f2/f3` recipients do not invoke this check. ThinBatch does not duplicate this product policy on-chain; the local guard applies consistently to Standard and ThinBatch.

## INV-EXEC-001 — Review estimate and submission use the same execution config

### Rule
Review-time estimation and send-time submission must prepare the same execution configuration for the same recipients, execution method, and error mode.

### Why this matters
If estimate and execute diverge, the review screen stops being a trustworthy preview of what the wallet will actually submit.

### Execution boundary
estimate/execute flow, transaction builder

### Acceptance criteria
- The same recipients, execution method, and error mode produce the same prepared batch config.
- `executionMethod`, `to`, `data`, `value`, `recipientCount`, `totalValueAttoFil`, and `errorMode` stay aligned.
- The live app passes the same prepared recipient set to both estimate and execute.
- Fee rows included in the sendable batch are consistent between review and submission.
- ThinBatch cannot be selected unless the active network has a configured ThinBatch contract address.
- Standard cannot be prepared with `PARTIAL`; value-bearing Multicall3 partial calls are not refund-safe.

### Tests
- `src/lib/transaction/__tests__/batchExecution.test.ts`
  - `describe('INV-EXEC-001 prepared batch determinism', ...)`
  - `it('produces the same prepared execution config for estimate and submit inputs')`
  - `it('blocks Standard PARTIAL preparation because Multicall3 cannot refund failed value calls')`
  - `it('prepares ThinBatch calldata when the active network has a deployed ThinBatch address')`
  - `it('blocks ThinBatch preparation when the active network has no ThinBatch address')`
- `src/lib/transaction/__tests__/thinBatch.test.ts`
  - `describe('buildThinBatch', ...)`
  - `it('canonicalizes 0x and f4 twins to identical EVM payment targets')`
  - `it('encodes f1/f2/f3-style recipients as Filecoin raw address bytes')`
  - `it('caps batches at the ThinBatch contract payment limit')`
- `src/lib/transaction/__tests__/nativeBatchPreflight.test.ts`
  - `describe('native Filecoin batch preflight', ...)`
  - `it('preserves the existing Multicall3 payload and ATOMIC call semantics')`
  - `it('preflights ThinBatch as one native InvokeEVM message to the configured ThinBatch contract')`
- `src/__tests__/app.invariants.test.tsx`
  - `describe('INV-EXEC-001 review and submit alignment', ...)`
  - `it('passes the same execution config to estimate and execute in the live app flow')`
  - `it('passes configured ThinBatch execution through estimate and execute on Calibration')`

### Status
`implemented`

Current repo note: the live App path estimates and submits through the EVM/wagmi `useExecuteBatch` flow for EVM senders and through `useExecuteNativeBatch` for native Filecoin senders. Standard remains the default execution method, but Standard is Atomic-only because Multicall3 `aggregate3Value(...)` does not refund value for failed allowed subcalls. ThinBatch is selectable only when the active network exposes `thinBatchAddress`; the shared network config records deployed Mainnet and Calibration ThinBatch defaults. `PARTIAL` is available only on ThinBatch where failed payment value is refunded. Both EVM and native sender paths pass the selected execution method and error mode into the same preparation layer. The native path prepares one Filecoin `InvokeEVM` message from the selected FEVM batch payload, fetches nonce and Lotus gas, signs through the connected native wallet provider, submits with `Filecoin.MpoolPush`, and polls status by CID.
