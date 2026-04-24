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
| `INV-AMT-002` | Reject values with more than 18 decimal places | `implemented` | validation, amount parsing | `src/utils/__tests__/recipientValidation.test.ts` |
| `INV-BATCH-001` | Enforce the 500-recipient cap | `implemented` | validation | `src/utils/__tests__/recipientValidation.test.ts` |
| `INV-DUP-001` | Duplicate recipients require explicit confirmation before Send | `implemented` | duplicate detection, review UI gating | `src/utils/__tests__/recipientValidation.test.ts`, `src/components/__tests__/ReviewTransactionModal.test.tsx`, `tests/e2e/review-flow.spec.ts` |
| `INV-NET-001` | Wrong network disables Send | `implemented` | network/wallet gating, review UI gating | `src/__tests__/app.invariants.test.tsx` |
| `INV-RPC-001` | Contract recipients detected via `eth_getCode` are blocked | `not implemented` | RPC contract-recipient check, review UI gating | `src/__tests__/contractRecipientGuard.test.tsx` |
| `INV-EXEC-001` | Review estimate and submission use the same execution config | `implemented` | estimate/execute flow, transaction builder | `src/lib/transaction/__tests__/batchExecution.test.ts`, `src/__tests__/app.invariants.test.tsx` |

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
- Whitespace trimming stays invisible to the user.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-ADDR-001 recipient acceptance', ...)`
  - `it('accepts valid f1, f2, f3, f4, and 0x recipients through the shared validator')`
  - `it('trims surrounding whitespace before validating supported recipients')`

### Status
`partial`

Current repo note: duplicate detection already treats `0x` and `f4` twins as the same identity, but the FEVM batch builder does not yet normalize raw `0x` inputs and `f4` twins to the same exact target string form.

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
`implemented`

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

## INV-AMT-002 — Reject values with more than 18 decimal places

### Rule
FIL-denominated inputs may use at most 18 decimal places. Over-precise values must be rejected rather than rounded or truncated.

### Why this matters
If precision silently changes, users can send the wrong value and review totals stop matching execution inputs.

### Execution boundary
validation, amount parsing

### Acceptance criteria
- Whole values pass.
- Exactly 18 decimal places pass.
- 19 decimal places fail.
- Over-precise rows are excluded from `validRecipients`.
- Error copy communicates the 18-decimal rule.

### Tests
- `src/utils/__tests__/recipientValidation.test.ts`
  - `describe('INV-AMT-002 precision rules', ...)`
  - `it('accepts values with up to 18 decimal places')`
  - `it('rejects values with more than 18 decimal places')`

### Status
`implemented`

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

### Status
`implemented`

Current repo note: the live block happens at the App review boundary, not by a wallet-driven switch action inside the review modal.

## INV-RPC-001 — Contract recipients detected via `eth_getCode` are blocked

### Rule
EVM recipients (`0x` or `f4`) with deployed bytecode must be blocked before Send can proceed, using the public-client `getCode` / `eth_getCode` path or an equivalent check.

### Why this matters
The v1 product scope only supports EVM EOAs as `0x`/`f4` recipients. Contract recipients can absorb value in ways that do not match the batch sender’s intent.

### Execution boundary
RPC contract-recipient check, review UI gating

### Acceptance criteria
- `getCode` is used for `0x` and `f4` recipients.
- Empty code (`0x`) is treated as EOA-like and allowed.
- Non-empty code blocks review/send.
- Native `f1/f2/f3` recipients do not invoke this check.
- Send is disabled and execution is not triggered when any EVM contract recipient is present.

### Tests
- `src/__tests__/contractRecipientGuard.test.tsx`
  - `describe('INV-RPC-001 contract recipient guard', ...)`
  - `it('does not require getCode for native f1 recipients')`
  - `it('blocks send when an EVM recipient resolves to deployed bytecode')`

### Status
`not implemented`

Current repo note: the FEVM review/send flow does not currently perform a `getCode` check before enabling Send.

## INV-EXEC-001 — Review estimate and submission use the same execution config

### Rule
Review-time estimation and send-time submission must prepare the same execution configuration for the same recipients and error mode.

### Why this matters
If estimate and execute diverge, the review screen stops being a trustworthy preview of what the wallet will actually submit.

### Execution boundary
estimate/execute flow, transaction builder

### Acceptance criteria
- The same recipients and error mode produce the same prepared batch config.
- `to`, `data`, `value`, `recipientCount`, `totalValueAttoFil`, and `errorMode` stay aligned.
- The live app passes the same prepared recipient set to both estimate and execute.
- Fee rows included in the sendable batch are consistent between review and submission.

### Tests
- `src/lib/transaction/__tests__/batchExecution.test.ts`
  - `describe('INV-EXEC-001 prepared batch determinism', ...)`
  - `it('produces the same prepared execution config for estimate and submit inputs')`
- `src/__tests__/app.invariants.test.tsx`
  - `describe('INV-EXEC-001 review and submit alignment', ...)`
  - `it('passes the same execution config to estimate and execute in the live app flow')`

### Status
`implemented`
