# plan.md

## V1-First Delivery Roadmap Aligned To The DevSpec

## Purpose

This file is the development roadmap for SendFIL.

It exists to translate the product requirements in `DevSpecs/SendFIL-_Technical_Spec_Doc.md`
into delivery order, dependencies, implementation checkpoints, and acceptance criteria.

Use these rules when working from this plan:

- `DevSpecs/SendFIL-_Technical_Spec_Doc.md` is the authoritative product specification.
- `plan.md` translates that specification into execution order and concrete delivery phases.
- `AGENTS.md` remains the cross-agent guide for current code truth, repo caveats, and known
  implementation gaps.
- `plan.md` must never silently narrow or redefine DevSpec scope.
- If the repo lags the DevSpec, the plan must mark the gap explicitly.
- If a roadmap item is blocked by missing deployment, upstream wallet capability, or missing
  product input, the item must stay in scope and be labeled as blocked rather than dropped.

## How To Read This Plan

This roadmap separates three ideas that must not be blended together:

- DevSpec target: what the product requires.
- Current repo state: what the codebase actually does today.
- Planned delivery step: the smallest coherent unit of work to close the gap safely.

Status labels used throughout this file:

- `Implemented`: already shipped in the live app path.
- `Partial`: some supporting code exists, but the live flow is incomplete or diverges from spec.
- `Planned`: required by the DevSpec and not yet complete.
- `Blocked by external dependency`: required by the DevSpec, but completion depends on something
  not yet available, such as deployed contracts, wallet-provider support, or curated data.

## Milestone Layers

### V1 Core Parity

Goal:

- Reach a real, production-usable Standard FEVM send flow with spec-critical validation,
  review-stage safety checks, and correct mainnet/calibration behavior.

Exit criteria:

- The primary UI uses a real Standard batch transaction rather than a simulation.
- Review-time estimation and submission are aligned to the same Standard FEVM execution model.
- CSV and manual entry share a single validation/review pipeline.
- Wrong-network state blocks submission.
- The main safety requirements for recipient validation, balance validation, and contract blocking
  are enforced.

Phases included:

- Phase 0
- Phase 1
- Phase 2
- Phase 3

### V1 Spec Complete

Goal:

- Deliver the full v1 scope described in the DevSpec, including execution controls,
  filecoin-native sender support, and ThinBatch readiness.

Exit criteria:

- Standard and ThinBatch execution methods are represented correctly in product flow.
- `PARTIAL` and `ATOMIC` are real behavioral modes, not type-only or UI-only labels.
- Supported `f1` senders can complete the same review and send flow with one approval.
- ThinBatch is production-ready once deployment/configuration prerequisites exist.
- Remaining v1 UX items from the DevSpec are present.

Phases included:

- Phase 4
- Phase 5
- Phase 6

### V2 Deferred

Goal:

- Add multisig sender support only after v1 is complete.

In scope:

- `f2` sender flow
- proposal + approval + execution model

Out of scope until then:

- any redesign that weakens or delays v1 commitments in this file

## Phase Status Overview

- Phase 0: `Implemented in planning docs`
- Phase 1: `Partial`
- Phase 2: `Partial`
- Phase 3: `Partial`
- Phase 4: `Planned`
- Phase 5: `Planned`
- Phase 6: `Blocked by external dependency`

## Phase 0: Planning Baseline

**Status:** `Implemented in planning docs`

### Goal

Create a reliable roadmap baseline so implementers do not confuse current repo behavior with
DevSpec requirements.

### Current gap

The repo contains partial implementations and parallel transaction paths. Without an explicit
baseline, future work risks building against the wrong architecture or treating spec-only behavior
as already shipped.

### Deliverables

- Document the current repo state and the intended v1 direction.
- Define roadmap status labels and milestone layers.
- Record the main implementation gaps that must shape sequencing:
  - the primary send flow is simulated
  - the Standard FEVM path exists but is not wired into the main UX
  - review-time estimation currently uses a different path than intended submission
  - validation differs between CSV and manual entry
  - calibration support is only partial
  - true `ATOMIC` vs `PARTIAL` behavior is not complete
  - ThinBatch is not deployed or enabled
  - filecoin-native sender flows are not live

### Dependencies

- DevSpec review
- repo audit

### Acceptance criteria

- This plan exists at repo root as `plan.md`.
- Each implementation phase uses the same structure:
  `Goal` / `Current gap` / `Deliverables` / `Dependencies` / `Acceptance criteria` / `Blocked by`.
- Milestone layers clearly separate `V1 core parity`, `V1 spec complete`, and `V2 deferred`.

### Blocked by

- None

## Phase 1: Ship The Real Standard FEVM Path

**Status:** `Partial`

### Goal

Replace the simulated primary send flow with the real Standard FEVM execution path and align review
estimation with the same execution model.

### Current gap

- The main review flow still simulates signing, pending, and confirmation.
- The repo already contains a Standard FEVM path based on Multicall3 + FilForwarder, but the live
  app path does not use it.
- Review-time estimation and submission do not currently use the same execution model.

### Deliverables

- Wire the primary review modal confirm action to the Standard FEVM execution path.
- Remove or fully quarantine simulation-only logic from the main user path.
- Use the same execution configuration for:
  - batch construction
  - gas estimation
  - submission
  - transaction hash / explorer linking
- Preserve the one-approval invariant for single-signer EVM senders.
- Preserve the current compact review UX and status progression:
  - `review`
  - `signing`
  - `pending`
  - `confirmed`
  - `failed`
- Ensure the review modal surfaces the real outer transaction hash and links to Filfox.

### Dependencies

- Existing Standard builder path
- Existing FEVM send hook
- Phase 0 baseline

### Acceptance criteria

- Clicking Send from the main review flow performs a real Standard batch transaction.
- Pending / confirmed / failed states reflect the real outer FEVM transaction.
- Review totals and estimated network fee are computed from the same execution model used for
  submission.
- No simulation-only path remains active in the primary user flow.

### Blocked by

- None

## Phase 2: Unify Validation And Guardrails To Match The DevSpec

**Status:** `Partial`

### Goal

Introduce a single shared review/validation pipeline for CSV upload and manual entry, then bring
that pipeline up to DevSpec parity for v1 safety requirements.

### Current gap

- CSV and manual entry do not share the same validation model.
- CSV currently rejects `0x` despite the DevSpec requiring support.
- CSV does not enforce the DevSpec `500`-row maximum.
- Manual entry validation is materially weaker than CSV validation.
- Submit-time balance recheck and EVM contract recipient blocking are not implemented.

### Deliverables

- Create one shared validation pipeline used by:
  - CSV ingestion
  - manual entry
  - review modal summary
  - submit gating
- Support recipient formats required by the DevSpec:
  - accept `f1`, `f2`, `f3`, `f4`, `0x`
  - reject `f0`
- Reject unsupported sender types in the active sender path.
- Enforce DevSpec validation behavior:
  - max `500` recipients
  - mainnet/testnet prefix compatibility
  - positive FIL values
  - up to 18 decimal places
  - duplicate-recipient warning with explicit review-time confirmation
  - insufficient-balance block at review
  - balance re-check at submit
  - EVM contract recipient blocking via `eth_getCode`
- Add a non-blocking EVM-address caution flow that satisfies the DevSpec safety intent for
  centralized-exchange `0x` recipients.

Implementation default for the CEX warning:

- Until a curated exchange-address data source exists, show a non-blocking best-practice warning
  whenever the batch includes EVM-recipient rows (`0x` or `f4`).
- Do not invent address-classification heuristics that silently label specific recipients as
  exchange-controlled without a trustworthy source.

### Dependencies

- Phase 1 real FEVM path
- shared review model and validation issue model
- wallet/public client access for `eth_getCode`

### Acceptance criteria

- CSV and manual entry produce the same validation results for the same recipient data.
- Invalid rows disable Send in review.
- Cross-network mistakes and contract recipients are blocked before submission.
- Duplicate handling is visible and intentional in review, not a hidden warning only.
- Review-time balance failures block progression and submit-time balance regression forces a
  re-review.

### Blocked by

- None for generic EVM-recipient caution copy
- A curated exchange-address source if product later requires address-specific CEX detection

## Phase 3: Finish Mainnet + Calibration Network Behavior

**Status:** `Partial`

### Goal

Make network behavior match the DevSpec end-to-end for both Filecoin Mainnet and Calibration.

### Current gap

- Mainnet support is primary; calibration behavior is only partially represented.
- Wrong-network handling is warning-oriented rather than fully blocking.
- Address-prefix, explorer-base, and network config behavior are not unified across the full flow.

### Deliverables

- Add explicit Mainnet and Calibration support through the full FEVM user path.
- Make wrong-chain handling match the DevSpec:
  - detect mismatch
  - present wallet-driven switch action
  - block send until network is aligned
  - never silently switch chain
- Unify network-sensitive behavior across:
  - wallet config
  - review flow
  - send flow
  - explorer links
  - address-prefix rules
  - network banners and gating
- Ensure all validation that depends on network alignment uses the active target network.

### Dependencies

- Phase 1 real FEVM path
- Phase 2 shared validation model

### Acceptance criteria

- Mainnet and Calibration both work in the primary FEVM send flow.
- Wrong-network state blocks send rather than only showing a banner.
- Explorer links and address formatting follow the active chain consistently.

### Blocked by

- None

## Phase 4: Add Spec-Required Execution Controls

**Status:** `Planned`

### Goal

Add the execution controls required by the DevSpec and implement true Standard-lane
`PARTIAL` / `ATOMIC` semantics.

### Current gap

- The repo does not yet present execution controls in the main flow.
- `PARTIAL` and `ATOMIC` exist conceptually but are not both fully implemented behaviors.
- ThinBatch is not available in the live flow.

### Deliverables

- Add execution configuration to the product flow:
  - `executionMethod: Standard | ThinBatch`
  - `errorMode: PARTIAL | ATOMIC`
- Keep default selections as:
  - `Standard`
  - `PARTIAL`
- Implement true Standard-lane atomic behavior rather than only modeling the option in types or UI.
- Ensure review, estimation, and submission all consume the same execution configuration.
- Keep ThinBatch hidden or disabled unless deployment configuration is present.

### Dependencies

- Phase 1 real FEVM path
- Phase 2 shared validation model
- Phase 3 complete network support

### Acceptance criteria

- `PARTIAL` and `ATOMIC` are real behavioral modes, not labels only.
- Standard remains the default execution method.
- ThinBatch does not appear as available unless deployment/configuration prerequisites are present.

### Blocked by

- ThinBatch deployment/configuration for the ThinBatch selection path

## Phase 5: Add Filecoin-Native Sender Support For V1

**Status:** `Planned`

### Goal

Implement the v1 filecoin-native sender path required by the DevSpec while preserving the one
approval/message invariant.

### Current gap

- The live wallet layer is EVM-centric.
- Filecoin-native sender support is described in the DevSpec but is not present in the primary app.
- Review, submission, and explorer behavior have not been unified across EVM and native senders.

### Deliverables

- Add a filecoin-native sender connection and signing path for supported `f1` senders.
- Build one native message that invokes the FEVM engine while preserving the one-approval invariant.
- Reuse the same validation, review, and transaction-status model as the EVM sender path.
- Keep explorer behavior and status handling consistent across EVM and native senders.

Implementation default for wallet integration:

- Treat native sender support as a first-class product flow, not a dev-only tool.
- Prefer sharing the same review and submission UI rather than building a second divergent screen.
- If current wallet libraries cannot host native signing cleanly inside the existing EVM connection
  stack, add a parallel native-wallet integration layer while keeping the downstream review and send
  flow identical.

### Dependencies

- Phase 2 shared validation model
- Phase 3 complete network support
- Phase 4 execution configuration model
- native wallet-provider integration strategy

### Acceptance criteria

- A supported `f1` sender can complete the same review and send flow through the main app.
- One approval/message is preserved for single-signer native senders.
- The same validation, guardrails, and status model apply across EVM and native sender flows.

### Blocked by

- Native wallet-provider support and integration feasibility

## Phase 6: ThinBatch Enablement And Remaining V1 UX

**Status:** `Blocked by external dependency`

### Goal

Enable ThinBatch once deployment/configuration exists and complete the remaining v1 UX requirements
from the DevSpec.

### Current gap

- ThinBatch is not deployed or configured.
- The remaining v1 UX requirements are not fully present:
  - past transactions sidebar
  - stuck-transaction guidance
  - richer review details for debugging and routing visibility

### Deliverables

- Enable ThinBatch once deployment/configuration is available.
- Preserve the Standard-vs-ThinBatch distinction in review, send, and audit behavior.
- Add remaining v1 UX called for by the DevSpec:
  - past transactions sidebar
  - stuck-transaction guidance that points users back to wallet-native controls
  - review details showing routing/type/debug information without losing the compact default view

Implementation default for past transactions:

- Use client-side persistence keyed by sender address and network for transactions initiated through
  this app.
- Store transaction hash, network, execution method, timestamp, status snapshot, and explorer link.
- Refresh status on revisit when possible, but do not introduce a backend for this feature.

### Dependencies

- Phase 4 execution configuration
- Phase 5 native sender support if the sidebar is meant to cover both sender types
- ThinBatch deployment addresses and configuration

### Acceptance criteria

- ThinBatch can be selected when configured and behaves distinctly from Standard.
- Audit-oriented behavior is documented and test-covered.
- The remaining v1 UX requirements are present in the main app flow.

### Blocked by

- ThinBatch deployment and environment configuration

## Locked Interfaces And Types

These contracts should be stabilized early so later phases do not fragment.

### Shared review / validation model

Introduce one shared review model consumed by CSV upload, manual entry, and the review modal.

Minimum shape:

- recipient rows with original input, normalized form, detected address type, and parsed amount
- validation issues with severity, code, message, row association, and confirmation requirement
- aggregate totals for recipients, fees, estimated network fee, and grand total
- submit gating state

Suggested logical contracts:

- `RecipientRow`
- `ValidatedRecipient`
- `ValidationIssue`
- `ReviewModel`

### Transaction configuration model

Lock the transaction configuration model to:

- `executionMethod: 'STANDARD' | 'THINBATCH'`
- `errorMode: 'PARTIAL' | 'ATOMIC'`

This model must be consumed by:

- estimation
- review display
- submission
- status/audit behavior

### Unified submission status model

Use one submission-state model for both EVM and native sender flows:

- `review`
- `signing`
- `pending`
- `confirmed`
- `failed`

Status UI and explorer linking should be sender-type agnostic.

### Network configuration surface

Lock one network configuration surface that supports:

- Mainnet
- Calibration
- explorer bases
- address-prefix rules
- contract addresses
- optional ThinBatch deployment addresses

## Test Plan

## Unit tests

- address acceptance and rejection
- `0x` / `f4` equivalence
- `f0` rejection
- mainnet/testnet prefix compatibility
- row-cap enforcement at `500`
- decimal parsing up to 18 places
- duplicate detection and confirmation gating
- fee injection invariants
- transaction configuration defaults

## Integration and component tests

- main review-to-send flow with the real Standard FEVM path
- wrong-network block and wallet-driven switch flow
- review-time balance block and submit-time balance recheck
- contract-recipient rejection via `eth_getCode`
- `PARTIAL` vs `ATOMIC` behavior
- ThinBatch hidden vs enabled by configuration
- shared validation behavior across CSV and manual entry

## End-to-end or manual matrix

- Mainnet and Calibration
- CSV and manual entry
- EVM sender and native sender
- Standard and ThinBatch
- PARTIAL and ATOMIC
- duplicate recipients accepted only after explicit confirmation
- contract-recipient blocking
- explorer links for pending and confirmed transactions

## Assumptions And Defaults

- `plan.md` lives at repo root.
- It is a development roadmap, not a replacement for the DevSpec.
- Main delivery focus is v1; v2 multisig work is listed only in a deferred appendix.
- `V1 core parity` is an internal milestone and does not redefine v1 scope.
- `V1 spec complete` still includes filecoin-native sender support and ThinBatch readiness because
  the DevSpec places both in v1.
- If ThinBatch deployment is missing, the plan marks that as an external blocker rather than
  dropping the requirement.
- If address-specific centralized-exchange detection does not have a trustworthy source, ship
  generic EVM-recipient caution copy first rather than inventing unreliable heuristics.
- The past-transactions sidebar should remain client-only and must not introduce a backend.

## V2 Deferred Appendix

V2 begins only after `V1 spec complete`.

V2 scope:

- `f2` multisig sender support
- proposal + approval + execution model
- reconciliation improvements specific to multisig workflows

V2 non-goals until then:

- any redesign that weakens the one-approval invariant for single-signer v1 flows
- delaying v1 native sender or ThinBatch readiness in order to start multisig work early
