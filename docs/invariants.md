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

| ID              | Rule                                                                                           | Status        | Boundary                                                   | Test files                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INV-ADDR-001`  | Accept valid `f1/f2/f3/f4/0x` recipients                                                       | `implemented` | validation                                                 | `src/utils/__tests__/recipientValidation.test.ts`                                                                                                                                                                               |
| `INV-ADDR-002`  | Reject `f0` recipients                                                                         | `implemented` | validation                                                 | `src/utils/__tests__/recipientValidation.test.ts`, `src/lib/transaction/__tests__/multicall.test.ts`                                                                                                                            |
| `INV-ADDR-003`  | Treat `0x` and `f4` twins as the same recipient identity internally                            | `partial`     | validation, duplicate detection, transaction builder       | `src/utils/__tests__/recipientValidation.test.ts`, `src/lib/transaction/__tests__/multicall.test.ts`                                                                                                                            |
| `INV-AMT-001`   | Reject blank, zero, and negative amounts                                                       | `implemented` | validation, amount parsing                                 | `src/utils/__tests__/recipientValidation.test.ts`                                                                                                                                                                               |
| `INV-AMT-002`   | Reject over-precise values and preserve exact accepted values                                  | `partial`     | validation, amount parsing, execution value preservation   | `src/utils/__tests__/recipientValidation.test.ts`                                                                                                                                                                               |
| `INV-BATCH-001` | Enforce the 500-recipient cap                                                                  | `partial`     | validation, execution capacity                             | `src/utils/__tests__/recipientValidation.test.ts`, `src/__tests__/App.test.tsx`                                                                                                                                                 |
| `INV-DUP-001`   | Duplicate recipients require explicit confirmation before Send                                 | `implemented` | duplicate detection, review UI gating                      | `src/utils/__tests__/recipientValidation.test.ts`, `src/components/__tests__/ReviewTransactionModal.test.tsx`, `tests/e2e/review-flow.spec.ts`                                                                                  |
| `INV-NET-001`   | Wrong network disables Send                                                                    | `implemented` | network/wallet gating, review UI gating                    | `src/lib/senders/__tests__/connectedSender.test.ts`, `src/__tests__/app.invariants.test.tsx`                                                                                                                                    |
| `INV-BAL-001`   | Submit-time balance recheck blocks EVM sends when current balance is insufficient              | `implemented` | submit guard, wallet RPC                                   | `src/lib/transaction/__tests__/submitBalanceCheck.test.ts`, `src/lib/transaction/__tests__/useExecuteBatch.submitBalance.test.tsx`                                                                                              |
| `INV-RPC-001`   | Contract recipients detected via `eth_getCode` are blocked                                     | `implemented` | RPC contract-recipient check, review UI gating             | `src/__tests__/contractRecipientGuard.test.tsx`, `src/utils/__tests__/contractRecipientGuard.test.ts`                                                                                                                           |
| `INV-RPC-002`   | Lotus failover preserves deterministic errors and endpoint diagnostics                          | `implemented` | native Filecoin RPC transport                              | `src/lib/DataProvider/__tests__/DataProvider.test.ts`                                                                                                                                                                            |
| `INV-NATIVE-001` | Signed native messages retain a deterministic CID through submission uncertainty               | `implemented` | native signing, submission, confirmation                   | `src/lib/senders/__tests__/nativeFilecoinSubmission.test.ts`, `src/lib/senders/__tests__/nativeSignerLock.test.ts`, `src/lib/transaction/__tests__/useExecuteNativeBatch.test.tsx`, `src/lib/multisig/__tests__/useExecuteMultisigProposal.test.tsx`, `src/lib/multisig/__tests__/useMultisigs.lifecycle.test.tsx` |
| `INV-EXEC-001`  | Review estimate and submission use the same execution config                                   | `implemented` | estimate/execute flow, transaction builder                 | `src/lib/transaction/__tests__/batchExecution.test.ts`, `src/lib/transaction/__tests__/thinBatch.test.ts`, `src/lib/transaction/__tests__/nativeBatchPreflight.test.ts`, `src/__tests__/app.invariants.test.tsx`                |
| `INV-MSIG-001`  | Native multisig proposals preserve the prepared batch and approvals verify its exact semantics | `implemented` | native multisig preparation, approval guard, actor outcome | `src/lib/multisig/__tests__/proposalVerifier.test.ts`, `src/lib/multisig/__tests__/rpc.test.ts`, `src/lib/multisig/__tests__/useExecuteMultisigProposal.test.tsx`, `src/lib/multisig/__tests__/useMultisigs.lifecycle.test.tsx` |
| `INV-MSIG-002`  | Native multisig creation uses the current actor manifest and remains safe across uncertainty    | `implemented` | native multisig creation, actor identity, submit outcome   | `src/lib/multisig/__tests__/actorManifest.test.ts`, `src/lib/multisig/__tests__/preflight.test.ts`, `src/lib/multisig/__tests__/rpc.test.ts`, `src/lib/multisig/__tests__/useMultisigs.lifecycle.test.tsx`, `src/components/multisig/__tests__/MultisigFundingPanel.render.test.tsx` |

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
- `src/__tests__/App.test.tsx`
  - `it('reserves two internal fee rows from the ThinBatch payment cap')`

### Status

`partial`

Current repo note: Standard allows 500 user-entered recipients and up to two appended fee rows. The deployed ThinBatch contract caps the complete payment array at 500, so the App conservatively limits fee-enabled ThinBatch input to 498 user recipients. Calibration or another fee-disabled ThinBatch network still allows 500. Treat the invariant as partial until product copy and the DevSpec explicitly distinguish user recipients from internal fee payments, or the deployed contract capacity changes.

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

## INV-RPC-002 — Lotus failover preserves deterministic errors and endpoint diagnostics

### Rule

The native Filecoin RPC lane may fail over only when another endpoint can plausibly recover the request. Deterministic JSON-RPC application errors must remain visible, and a failed fallback must not replace the primary provider's more useful diagnosis.

### Why this matters

Masking an actor, method, or validation error as a generic browser transport failure makes transaction preparation unsafe to diagnose and can encourage users to repeat an operation whose actual outcome is unknown.

### Execution boundary

native Filecoin RPC transport

### Acceptance criteria

- Transport failures, timeouts, retryable HTTP statuses, malformed responses, and JSON-RPC `-32601` method-unavailable errors may try one distinct fallback endpoint.
- Known load-balanced state-availability failures receive one same-endpoint retry before fallback,
  but only for an explicit read-method allowlist; native submission methods are never retried this
  way.
- Other JSON-RPC application errors and non-retryable HTTP client errors are returned without calling the fallback.
- A combined failure retains method, network, endpoint role, and both endpoint diagnoses, including the primary JSON-RPC code when present.
- HTTP status, JSON-RPC envelope, result presence, and response ID are validated before a result is accepted.
- Identical primary and fallback URLs, including trailing-slash variants, are called only once.

### Tests

- `src/lib/DataProvider/__tests__/DataProvider.test.ts`
  - failover eligibility and duplicate-endpoint coverage
  - deterministic actor-error preservation
  - primary method-unavailable plus fallback transport diagnostics
  - malformed response, HTTP status, and response-ID validation
  - stale state-backend same-endpoint retry without write-method retry

### Status

`implemented`

## INV-NATIVE-001 — Signed native messages retain a deterministic CID through submission uncertainty

### Rule

Every native Filecoin submission must derive the chain CID from the exact signed payload before
calling `Filecoin.MpoolPush`. If the push response is lost, malformed, or disagrees with the local
CID, the app must reconcile the local CID instead of signing or submitting the operation again.

### Why this matters

An RPC timeout after signing does not prove that the message was rejected. Blindly retrying can
duplicate a batch, multisig creation, proposal, approval, or cancellation.

### Execution boundary

native signing, submission, confirmation

### Acceptance criteria

- BLS messages use the unsigned message CID; secp256k1 and delegated signatures use the canonical
  signed-message CID.
- The locally derived CID is available before `MpoolPush` begins and a returned CID must match it.
- Safety records accept only the canonical Filecoin message-CID form: CIDv1, DAG-CBOR,
  Blake2b-256, a 32-byte digest, and canonical lowercase unpadded base32.
- The exact CID and operation snapshot are written to `sendfil.native-submissions.v1` before
  `MpoolPush`; Create, Approve, and Cancel uncertainty is written to
  `sendfil.multisig-uncertain-actions.v1` before submission.
- Every native signing path acquires one origin-wide Web Lock, re-verifies both safety stores while
  holding it through exact-CID persistence and submission, and fails closed when Web Locks are
  unavailable; any unresolved native record blocks every new native signature.
- Only protocol-level JSON-RPC method/parameter rejection proves that `MpoolPush` did not enter
  Lotus. Lotus application errors, transport/response loss, and CID mismatch remain uncertain
  because the exact message may already have been added before the error was returned.
- Native batch, multisig Create, Propose, Approve, and Cancel consumers poll the local CID after an
  ambiguous push response.
- Retryable confirmation-read failures remain pending within the bounded polling window instead of
  terminating the poll as an on-chain failure; exhaustion still preserves the exact-CID lock.
- A missing receipt or an inconsistent success response never becomes a confirmed operation.
- Confirmation searches set `allowReplaced=false`, require the returned message CID to equal the
  requested CID, and validate the receipt's exit code, return bytes, gas, and events-root shape
  before a durable lock can be released.
- Reloading, switching sender modes, or reconnecting another wallet cannot erase an unresolved
  native operation. Storage read/write failures block new native signing without blocking the
  independent EVM send path.
- Vite resolves the installed browser `buffer` polyfill rather than externalizing Node's builtin;
  the Ledger WebHID adapter installs that implementation before loading its transport modules.
- Single-flight/retry guards remain in force for nonterminal or unverifiable outcomes so the same
  identity cannot blindly resubmit.
- Status and explorer links use the network snapshot associated with the signed message.

### Tests

- `src/lib/senders/__tests__/nativeFilecoinSubmission.test.ts`
  - immutable BLS, secp256k1, and delegated signed-message CID vectors
  - matching, rejected, ambiguous, and mismatched `MpoolPush` outcomes
- `src/lib/DataProvider/__tests__/filecoinMessageCid.test.ts`
  - exact message-CID codec/hash framing and canonical base32 rejection
- `src/lib/DataProvider/__tests__/DataProvider.test.ts`
  - exact-CID `StateSearchMsg` behavior and strict live-shaped receipt validation
- `src/lib/senders/__tests__/nativeSubmissionStorage.test.ts`
  - global operation lock, strict stored identity/CID validation, and compare-clear behavior
- `src/lib/senders/__tests__/nativeSignerLock.test.ts`
  - origin-wide cross-tab serialization, both-store rechecks, fail-closed behavior, and lock release
- `src/lib/senders/__tests__/nativeFilecoinProvider.test.ts`
  - Ledger browser-buffer installation and provider-boundary behavior
- `src/lib/transaction/__tests__/useExecuteNativeBatch.test.tsx`
  - ambiguous-submit reconciliation, receipt requirements, and same-identity single-flight locking
- `src/lib/multisig/__tests__/useExecuteMultisigProposal.test.tsx`
  - ambiguous proposal-submit reconciliation and nested actor outcome checks
- `src/lib/multisig/__tests__/useMultisigs.lifecycle.test.tsx`
  - create, approval, and cancellation reconciliation plus identity-bound retry guards

### Status

`implemented`

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

## INV-MSIG-001 — Native multisig proposals preserve and verify the prepared FEVM batch

### Rule

When an `f2/t2` multisig is selected as the funding source, SendFIL must first prepare the same FEVM batch payload used by the native single-signer path, then wrap that payload in a Filecoin multisig `Propose` message. Before enabling approval for a pending proposal, SendFIL must decode and verify the complete nested batch rather than trusting only its outer target. The connected native signer pays proposal gas; the multisig pays the batch value.

### Why this matters

Multisig proposal encoding has two balances and two execution layers. If the inner payload, params encoding, target, value, or balance checks drift, a signer could approve something different from the reviewed batch or attempt to spend from the wrong account.

### Execution boundary

native multisig proposal preparation, pending-approval guard, actor outcome verification

### Acceptance criteria

- The inner batch is prepared through `prepareBatchExecution(...)` with the selected recipients, execution method, error mode, and active network.
- The outer Filecoin message is addressed to the selected `f2/t2` multisig with Method `Propose` and Value `0`.
- The proposal target is the prepared FEVM target in `f4/t4` form, proposal Value equals the prepared batch value, proposal Method is `InvokeEVM`, and proposal Params are the decoded `InvokeEVM` params bytes.
- Submit-time checks require multisig available balance to cover the prepared batch total and the connected signer balance to cover estimated proposal gas.
- Loaded actor and pending state is bound to the selected network, actor address, and connected signer; stale responses cannot authorize another actor.
- In-app approval is enabled only after canonical CBOR and ABI decoding proves every nested call is a supported SendFIL payment with matching totals, execution mode, batch limit, active fee rows, and contract-recipient policy.
- The approval screen displays every decoded recipient and exact amount before authorization.
- Pending proposals with duplicate payment destinations require a fresh explicit acknowledgment before approval, and the hook enforces that acknowledgment below the UI boundary.
- Confirmed Propose and Approve messages decode the actor return and distinguish queued proposals, successful threshold execution, and nonzero inner exit codes.
- Propose, Approve, and Cancel remain single-flight through confirmation. A timeout or undecodable confirmed return is treated as an uncertain, non-retryable outcome because the original CID may still execute.
- While a proposal is nonterminal, sender, multisig, network, and wallet disconnect controls remain locked; status and Filfox links use the submitted network snapshot rather than live wallet state.
- Review and submission are blocked while a native wallet connect, disconnect, or network transition is unresolved; late wallet completions cannot reset a proposal submitted after that transition began.
- Action CIDs and terminal results stay bound to the submitted actor identity, and refresh never targets a newly selected actor.

### Tests

- `src/lib/multisig/__tests__/actorParams.test.ts`
  - actor-compatible CBOR/hash golden vectors and strict actor-return decoding
- `src/lib/multisig/__tests__/proposalVerifier.test.ts`
  - canonical Standard and ThinBatch decoding
  - arbitrary-selector, nested-call, target, value, mode, recipient, batch-limit, and fee-policy rejection
- `src/lib/multisig/__tests__/rpc.test.ts`
  - actor CodeCID identity, malformed-proposal isolation, and fail-closed contract-recipient checks
- `src/lib/multisig/__tests__/useExecuteMultisigProposal.test.tsx`
  - queued, applied-success, applied-failure, malformed-return, gas-field, and through-confirmation concurrency coverage
  - `it('blocks signing when multisig spendable balance is insufficient')`
  - `it('blocks signing when the connected signer cannot cover proposal gas')`
  - `it('rechecks signer membership immediately before proposal submission')`
- `src/lib/multisig/__tests__/useMultisigs.lifecycle.test.tsx`
  - address/network/signer race coverage and guarded action refresh
  - create/ExecReturn/persistence coverage, including unverifiable confirmed creation warnings
  - approval and cancellation submission, terminal outcomes, single-flight locking, and positive refresh
  - submit-time proposal-policy and duplicate-acknowledgment enforcement
- `src/components/multisig/__tests__/MultisigFundingPanel.render.test.tsx`
  - decoded-payment review, approval/cancellation locking, CID links, and stale-identity hiding
- `src/__tests__/App.test.tsx`
  - `it('refreshes, reviews, submits, and reconciles a native multisig proposal')`
  - pending wallet/network locking and submitted-network status-link coverage

### Status

`implemented`

Current repo note: `src/lib/multisig/proposalBuilder.ts` builds the inner prepared batch and wraps it in actor-compatible multisig params. `src/lib/multisig/proposalVerifier.ts` independently decodes pending proposals and reconstructs their canonical Standard or ThinBatch calldata before approval is enabled. `src/lib/multisig/useExecuteMultisigProposal.ts` estimates the outer proposal gas, rechecks both funding balances before signing, submits through the connected native Filecoin provider, and verifies both the outer receipt and nested actor outcome. Higher-threshold multisigs still require later approvals. Real FilSnap/Ledger Mainnet plus Calibration smoke coverage remains a production-readiness requirement.

## INV-MSIG-002 — Native multisig creation uses the current actor manifest and preserves uncertain submissions

### Rule

Creating an `f2/t2` multisig must use the active network's current multisig actor CodeCID, require the connected creator to fund the initial deposit plus gas, and retain the submitted CID whenever confirmation becomes uncertain.

### Why this matters

InitActor `Exec` embeds an actor CodeCID in the signed message. A stale or guessed CID can create the wrong actor version, while losing a submitted CID can lead a user to create a duplicate multisig after a polling or RPC failure.

### Execution boundary

native multisig creation, actor identity, submit outcome

### Acceptance criteria

- The current multisig actor CodeCID is resolved from `StateReadState(f00/t00).State.BuiltinActors`, then `ChainReadObj`, rather than from a pinned value or the provider-specific `StateActorCodeCIDs` method.
- Manifest base64, DAG-CBOR list-pair framing, actor names, and CID links are decoded canonically and fail closed on malformed, duplicate, missing, or trailing data.
- A validated robust `f2/t2` address is resolved to a network-correct `f0/t0` ID before actor reads;
  state, available balance, vesting, and pending proposals use that ID while the robust address
  remains the display and transaction-target identity.
- Multisig identity is checked against the CodeCID returned by `StateReadState`, avoiding a
  provider-dependent `StateGetActor` lookup for newly created actors.
- The connected signer must be included in the signer list and its balance must exceed the initial deposit before remote preflight begins.
- The creator balance is re-read after gas estimation and immediately before signing; it must cover the initial deposit plus estimated creation gas.
- A confirmed InitActor return is decoded and its network-correct robust multisig address is saved locally.
- The exact signed message CID is derived before `MpoolPush`; ambiguous submission, polling failures,
  or unverifiable confirmed returns are shown as uncertain and retain a Filfox link.
- Uncertain creation records survive remounts and block another Create for the same signer/network
  identity until an explicit CID recheck proves a terminal failure or canonical success.
- Create, Approve, and Cancel recovery records are identity-bound, retain the canonical submitted
  CID across reloads, and fail closed on malformed or inaccessible browser storage.
- The create form labels approval threshold and initial deposit separately and states that the connected signer pays deposit plus gas.

### Tests

- `src/lib/multisig/__tests__/actorManifest.test.ts`
  - literal Mainnet and Calibration manifest vectors plus strict malformed-input rejection
- `src/lib/multisig/__tests__/rpc.test.ts`
  - System actor manifest resolution and actor CodeCID identity
- `src/lib/multisig/__tests__/preflight.test.ts`
  - manifest-resolved CodeCID embedding plus nonce, manifest, and gas network binding
- `src/lib/multisig/__tests__/useMultisigs.lifecycle.test.tsx`
  - early and submit-time balance guards, ExecReturn persistence, and uncertain submitted-CID handling
- `src/lib/multisig/__tests__/actionStorage.test.ts`
  - canonical CID/address validation, identity conflicts, remount persistence, and compare-clear behavior
- `src/components/multisig/__tests__/MultisigFundingPanel.render.test.tsx`
  - explicit labels, creator-funding copy, contextual RPC errors, and duplicate-create blocking

### Status

`implemented`
