# AGENTS.md

This is the canonical cross-agent development guide for `sendfil`.

If you are Claude, Codex, Cursor, or another coding agent, read this file before making changes.

If this file conflicts with older notes, follow this file.

## Purpose

This repo contains both:

- real, shipping code paths
- planned/spec-only paths that are not fully implemented yet

The biggest risk in this codebase is treating the spec as if it were already the implementation.

This file exists to prevent that.

## Source Of Truth Model

Use these three buckets, not a single blended hierarchy:

1. User intent
   - direct user instructions for the task at hand

2. Current implementation truth
   - live code
   - tests
   - runtime behavior

3. Product target truth
   - `DevSpecs/SendFIL-_Technical_Spec_Doc.md`

This file is the translation layer between current implementation truth and product target truth.

Important nuance:

- This file should never contradict the DevSpec about intended product behavior.
- This file should also never pretend the current code already satisfies the full DevSpec when it does not.
- When code and spec differ, document both explicitly:
  - what the DevSpec requires
  - what the repo currently does
  - what remains to be implemented
- Do not silently "bring code up to spec" unless the user explicitly asks for that work.
- Do not describe spec-only behavior as already shipped.

## Project Snapshot

`SendFIL` is a client-only Vite SPA for batch sending FIL.

Current live stack:

- React 19
- TypeScript
- Vite
- Tailwind CSS
- wagmi + RainbowKit + viem
- Native Filecoin RPC wrappers in `src/lib/DataProvider`

There is no backend and no database.

## DevSpec Alignment Contract

`DevSpecs/SendFIL-_Technical_Spec_Doc.md` is the authoritative product specification for:

- supported sender/recipient types
- network support expectations
- execution modes
- guardrails
- review-step UX
- CSV rules
- gas-estimation behavior
- v1 vs v2 scope

This file exists to help agents implement and review against that spec safely.

Whenever you change this file, preserve these rules:

- Keep spec requirements labeled as targets when they are not yet implemented.
- Keep current repo behavior labeled as current behavior.
- Never flatten "target" and "current" into one ambiguous statement.
- If you discover a code/spec mismatch, add it here rather than hiding it.

## Current Reality vs Spec

The codebase currently mixes three transaction stories:

1. Intended v1 FEVM batch path
   - `src/lib/transaction/multicall.ts`
   - `src/lib/transaction/useExecuteBatch.ts`
   - Builds one `Multicall3.aggregate3Value(...)` transaction and sends it with `wagmi`

2. Native Filecoin message path
   - `src/lib/transaction/messageBuilder.ts`
   - `src/lib/transaction/executor.ts`
   - Builds one native Filecoin message per recipient
   - Used today for review-time estimation and developer testing, not for the real UI send path

3. Simulated send path
   - `src/App.tsx`
   - `handleConfirmTransaction()` still fakes signing, pending, and confirmation with `setTimeout`

If you change sending behavior, be explicit about which of these paths you are changing.

## DevSpec Targets That Should Guide New Work

These are the high-level product requirements from the DevSpec that should guide implementation work, even where the repo has not caught up yet.

### Supported senders and recipients

DevSpec target:

- v1 senders: `f1`, `f4`, `0x`
- v2 senders: add `f2`
- recipients: `f1`, `f2`, `f3`, `f4`, `0x`
- reject `f0` everywhere
- reject `f3` as sender
- block EVM contract recipients (`0x` / `f4` with deployed code)

### Network behavior

DevSpec target:

- support Filecoin Mainnet and Calibration
- block sends on network mismatch
- prompt the user to switch through wallet UX
- never silently change network on the user's behalf

### Execution methods

DevSpec target:

- `Standard` execution method
  - default
  - Multicall3 + FilForwarder
- `ThinBatch` execution method
  - optional
  - hidden or unavailable until deployed
- `errorMode`
  - `PARTIAL` default
  - `ATOMIC` optional

### UX and guardrails

DevSpec target:

- one approval per batch for single-signer flows
- compact review step by default
- optional detail expansion for debugging
- no gas editing or replacement controls in the SendFIL UI
- Filfox links for sent transactions
- duplicate recipient warning/confirmation during review
- balance check at review time and again at submit time
- centralized-exchange `0x` warning
- "stuck transaction" guidance that points users back to wallet-native speed-up/cancel tools
- past transaction history visible in the sidebar

### CSV behavior

DevSpec target:

- accept `f1`, `f2`, `f3`, `f4`, `0x`
- reject `f0`
- enforce max `500` recipients per batch
- validate during review flow
- block cross-network mistakes
- amounts are FIL-denominated human units
- support up to 18 decimal places

### Address canonicalization

DevSpec target:

- treat `0x` and `f4` as equivalent representations of the same EVM destination
- canonicalize invisibly to the execution path's required wire format
- do not expose conversion complexity unnecessarily in the UI
- never convert `f1/f2/f3` to `0x`

## Critical Truths Agents Must Not Miss

### 1. Real send is not wired yet

`src/App.tsx` does not call `useExecuteBatch()` or `executeBatchTransaction()` when the user clicks Send.

The review modal can show fees and status UI, but the actual confirm action is still simulated.

### 2. The mainnet FEVM path exists, but the review flow still estimates the wrong thing

`src/App.tsx` review logic currently calls:

- `calculateFeeRows(...)`
- `getNonce(address)`
- `buildBatchTransaction(...)`

That uses the native message builder path, not the FEVM multicall path that the repo appears to be moving toward.

This means review-time gas estimation and real future FEVM execution are currently divergent concepts.

### 3. Calibration support is partial, not end-to-end

The spec and some UI helpers mention Calibration, but the live wagmi config only registers `filecoin` mainnet in `src/lib/wagmi.ts`.

What exists today:

- mainnet wallet config
- Calibration-aware Filfox link selection in `ReviewTransactionModal`
- some testnet address formatting helpers

What does not exist end-to-end:

- a calibration chain in wagmi config
- per-network env structure described in the spec
- robust network switching flow
- a fully verified calibration execution path

Do not claim "Mainnet + Calibration are supported" without qualifying that this is only partially implemented in code.

### 4. Network mismatch is warned about, but not fully blocked in the send flow

`src/components/NetworkBanner.tsx` shows a warning when `chainId !== 314`.

However:

- the banner itself does not disable the UI
- `App.tsx` does not gate the review/send flow on chain id
- `ReviewTransactionModal` disable logic does not include network mismatch

Do not describe this as a fully enforced guardrail.

This is consistent with the DevSpec only as a known gap, not as completed behavior.

### 5. CSV validation and manual input validation are inconsistent

Current CSV behavior in `src/components/CSVUpload.tsx`:

- accepts `f*` / `t*` addresses via regex
- does not accept `0x` addresses
- warns on duplicate addresses
- warns only at `1000+` recipients
- does not enforce connected-network address prefix
- does not enforce the spec's `500` row cap

Current manual-entry behavior in `src/App.tsx`:

- effectively accepts any non-empty address string
- has no equivalent validation pipeline
- reuses `csvErrors` / `csvWarnings`, which means manual input has much weaker safety checks

This mismatch is one of the most important repo realities to remember.

This is a divergence from the DevSpec, which expects a unified review-stage validation model.

### 6. EVM contract recipient blocking is specified but not implemented

The spec requires blocking `0x` / `f4` recipients with deployed code via `eth_getCode`.

That check does not currently exist in the app.

Treat this as a missing spec-required guardrail.

### 7. Fee env vars are operationally required

`src/utils/fee.ts` always appends fee rows.

That means these env vars are effectively required for normal operation:

- `VITE_FEE_ADDR_A`
- `VITE_FEE_ADDR_B`

The code does not gracefully disable fee injection when they are missing.

### 8. There are stale and unused modules in the tree

These files exist but are not the active user path:

- `src/components/ConnectWalletButton.tsx`
- `src/components/WalletModal.tsx`
- `src/context/WalletContext.tsx`
- `src/layout/Header.tsx`
- `src/layout/Footer.tsx`
- `src/components/F4TestComponent.tsx`
- `src/utils/chains.ts`

Do not build new features on these without first deciding whether they should be revived or removed.

## Verified Architecture

### App tree

Live tree:

`main.tsx -> Web3Provider -> App`

Important correction:

- there is only one `QueryClientProvider`, inside `src/providers/Web3Provider.tsx`
- the older "nested QueryClientProvider" description is incorrect for the current repo

### Wallet layer

Current wagmi config in `src/lib/wagmi.ts`:

- chains: only `filecoin`
- connectors: `metaMaskWallet`, `walletConnectWallet`
- transport: `VITE_RPC_URL`

Do not claim the app currently ships first-class Ledger, Brave, Glif, or MetaMask Snap support.

### RPC layers

There are two practical RPC lanes today:

1. FEVM / wallet lane
   - used by `useExecuteBatch`
   - writes through wallet provider with `sendTransactionAsync`
   - gas estimation through `publicClient.estimateGas()`

2. Native Filecoin Lotus-style lane
   - used by `src/lib/DataProvider`
   - primary/fallback URLs:
     - `VITE_GLIF_RPC_URL_PRIMARY`
     - `VITE_GLIF_RPC_URL_FALLBACK`
   - timeout:
     - `VITE_GLIF_RPC_TIMEOUT_MS`
   - one failover retry via `p-retry`

Important correction:

- the more elaborate per-network FEVM/Lotus env scheme described in the DevSpecs is not implemented in this repo yet
- the DevSpec also describes Filecoin-native signer support in v1, which is not present in the live wallet layer today

## Transaction Engine Notes

### Intended FEVM batch engine

`src/lib/transaction/multicall.ts` is the most important future-facing transaction file.

It currently:

- routes `0x` and `f4/t4` to direct EVM value transfers
- routes `f1/f2/f3` through `FilForwarder.forward(...)`
- rejects `f0/t0`
- always encodes `aggregate3Value`

Important correction:

- the code does not currently switch to a separate `aggregate3` or strict atomic encoding path
- `ErrorMode = 'ATOMIC' | 'PARTIAL'` exists, but both paths still flow through `aggregate3Value`

If you are asked to implement true atomic behavior, treat that as new work, not as already done.

DevSpec alignment note:

- the spec expects true selectable `PARTIAL` vs `ATOMIC` semantics
- the current code only partially models that intent

### Native builder path

`src/lib/transaction/messageBuilder.ts`:

- converts FIL numbers to attoFIL
- builds one Filecoin message per recipient
- estimates gas using `Filecoin.GasEstimateMessageGas`
- is currently used by review and test tooling

Important caution:

- `filToAttoFil()` uses `Math.floor(fil * 1e18)` and is precision-sensitive
- `multicall.ts` already has a safer string-splitting bigint conversion helper
- if precision becomes important, unify these approaches deliberately

DevSpec alignment note:

- the spec still wants one-approval support for Filecoin-native signers in v1
- this repo does not currently expose that as a live wallet path

### Sender-address mismatch risk

`TransactionTest.tsx` converts the wagmi `0x` account to an `f4` address before native RPC operations.

`App.tsx` review logic does not do that conversion before native nonce/gas calls.

Treat this as a real architectural inconsistency.

## Address Rules

### What the spec wants

V1 target:

- senders: `f1`, `f4`, `0x`
- recipients: `f1`, `f2`, `f3`, `f4`, `0x`
- reject: `f0`
- block EVM contracts

### What the code actually enforces today

`src/utils/addressEncoder.ts`:

- `0x` -> EVM
- `f4/t4` -> EVM
- `f1/f2/f3/t1/t2/t3` -> native
- `f0/t0` -> invalid

But the UI-level validation is inconsistent:

- CSV upload does not currently accept `0x`
- manual input does not currently validate thoroughly

Do not confuse utility-level capability with UI-level enforcement.

DevSpec alignment note:

- the spec says the app accepts `0x` in UI input
- the current CSV implementation does not yet satisfy that
- the spec says 0x↔f4 conversion should be engine-internal and visually quiet
- the current repo contains visible f4 display helpers, so be careful not to extend that pattern without checking the intended UX

## Fee System

`src/utils/fee.ts` is the active fee policy:

- default fee percent: `1`
- default split: `0.5`
- fee rows are appended to recipients
- fee amounts are truncated to 6 decimals
- fee addresses may not already appear in the recipient list

If you touch fee logic:

- update `src/utils/__tests__/fee.test.ts`
- verify env behavior
- keep fee rows out of user-entered recipients

DevSpec alignment note:

- the spec treats fee presentation as simple, estimate-oriented UX
- avoid adding user-facing fee controls or advanced fee editing

## CSV Rules

Current implementation in `src/components/CSVUpload.tsx`:

- accepted address headers:
  - `receiveraddress`
  - `receiver_address`
  - `address`
  - `to`
- accepted amount headers:
  - `value`
  - `amount`
  - `fil`
  - `tokens`
- empty rows are skipped
- duplicate addresses are warnings, not errors
- large batch warning starts at `1000+`

Important corrections against the old draft/spec:

- code does not require strict column order
- code does not enforce the spec's `500` row maximum
- code does not accept `0x` addresses in CSV today
- code does not validate that address prefix matches the connected network

If asked to make CSV behavior "spec-compliant", the minimum expected fixes are:

- accept `0x`
- enforce `500` max rows
- align manual entry and CSV validation behavior
- enforce mainnet/testnet prefix compatibility
- preserve duplicate warnings and elevate to explicit review-time confirmation if requested

## Spec Status Matrix

Use this quick classification when reasoning about changes:

- Implemented or close:
  - client-only architecture
  - Standard FEVM builder direction
  - FilForwarder routing model
  - Filfox links in review/status UI
  - compact review modal with expandable details
  - fee summary UX

- Partially implemented:
  - Mainnet + Calibration support
  - network mismatch protection
  - one-approval FEVM batch path
  - address canonicalization behavior
  - review-step validation UX
  - pending/confirmed/failed transaction states

- Spec-defined but not complete:
  - real FEVM send wired into primary UI
  - true `ATOMIC` vs `PARTIAL` behavior
  - ThinBatch toggle and execution path
  - Filecoin-native signer path in v1 UI
  - EVM contract recipient blocking
  - submit-time balance recheck
  - `500`-row cap
  - duplicate confirmation UX
  - past transaction history
  - centralized-exchange warning
  - stuck-transaction guidance

## Testing And Tooling

Verified on this repo:

- `yarn test` passes
- `yarn lint` passes
- `yarn typecheck` passes

Important corrections:

- Vitest environment is `node`, not `jsdom`
- there are both `.eslintrc.json` and `eslint.config.js`
- the `lint` script uses `eslint . --max-warnings=0`; the flat config is active in practice, but the legacy config still exists and can mislead people

## Files That Matter Most

If you need the current main flow, start here:

- `src/App.tsx`
- `src/components/ReviewTransactionModal.tsx`
- `src/components/CSVUpload.tsx`
- `src/components/CustomConnectButton.tsx`
- `src/providers/Web3Provider.tsx`
- `src/lib/wagmi.ts`
- `src/lib/transaction/multicall.ts`
- `src/lib/transaction/useExecuteBatch.ts`
- `src/lib/transaction/messageBuilder.ts`
- `src/lib/DataProvider/index.ts`
- `src/utils/fee.ts`
- `src/utils/addressEncoder.ts`

If you need the product target/roadmap, read:

- `DevSpecs/SendFIL-_Technical_Spec_Doc.md`

If you need examples of the current intended behavior, read tests:

- `src/utils/__tests__/fee.test.ts`
- `src/utils/__tests__/toF4.test.ts`
- `src/lib/DataProvider/__tests__/DataProvider.test.ts`

## Rules For Future Agents

### General

- Do not state that a feature exists unless it is wired into the live app path.
- Distinguish clearly between:
  - implemented
  - partially implemented
  - planned per spec
- Do not contradict the DevSpec on intended product behavior; instead, label current divergence explicitly.
- Prefer removing stale claims over adding more optimistic prose.

### If you touch transaction execution

- Decide whether you are changing:
  - FEVM multicall execution
  - native message building
  - UI simulation / modal state only
- If you wire real execution into `App.tsx`, remove the simulated path rather than leaving both active.
- Keep the "one user approval per batch" invariant for single-signer FEVM execution.
- If you add true atomic support, do not pretend the current `aggregate3Value` path already covers it.
- Preserve the DevSpec distinction between `Standard` and `ThinBatch`.
- Keep `PARTIAL` as the default mode unless the user explicitly asks for a product change.

### If you touch validation or guardrails

- Keep CSV and manual-entry validation aligned.
- Add tests for any change to:
  - accepted address formats
  - fee injection
  - batch limits
  - contract-recipient blocking
  - duplicate handling
- Do not add new address support in one path only.
- Match the DevSpec's review-step safety intent:
  - invalid rows block send
  - duplicates warn and may require confirmation
  - cross-network mistakes are blocked

### If you touch network support

- Treat "add Calibration support" as a cross-cutting change.
- Update all of the following together:
  - wagmi chain config
  - network banner / gating
  - explorer links
  - address display helpers
  - env vars
  - tests
- Keep wallet-driven chain switching explicit; do not silently switch networks.

### If you touch docs

- Keep this file focused on current engineering truth.
- Keep the DevSpecs file focused on product target.
- If the code intentionally diverges from the DevSpecs, document the divergence here.
- If you add a new section here that mirrors the DevSpec, label it as:
  - `DevSpec target`
  - `Current repo behavior`
  - `Gap / next implementation step`

## Known Gaps Worth Calling Out In Reviews

These are not all bugs, but they are important mismatches:

- real send in `App.tsx` is still simulated
- review-time estimation uses the native path, not the FEVM multicall path
- CSV validation rejects `0x` even though the product goal includes it
- manual input validation is much weaker than CSV validation
- network mismatch is warned about but not truly blocked in the send flow
- Calibration is only partially represented in code
- EVM contract recipient blocking is not implemented
- spec-level 500 row cap is not enforced
- duplicate confirmation UX is not implemented
- balance is not rechecked at submit time
- `CustomConnectButton` always formats displayed delegated addresses with `CoinType.MAIN`
- README still contains substantial leftover Vite-template content

Additional DevSpec gaps:

- no Standard-vs-ThinBatch toggle in the live UI
- no explicit `PARTIAL` vs `ATOMIC` control in the live UI
- no Filecoin-native wallet connection flow
- no centralized-exchange warning flow
- no past-transactions sidebar feature
- no stuck-transaction guidance copy in the main user flow

## Bottom Line

The safest way to work in this repo is:

- treat the FEVM multicall path as the intended v1 direction
- treat the native message path as existing support code and review/test infrastructure
- treat the DevSpecs as roadmap, not implementation proof
- verify UI wiring before assuming any helper or hook is actually in production use
