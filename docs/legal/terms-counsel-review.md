# SendFIL Terms: Counsel and Launch Checklist

The in-app Terms of Service are a product-specific first draft, not a substitute for advice from
qualified counsel. Complete this checklist before treating the draft as final production terms.

> [!CAUTION]
> **Do not merge or deploy this draft as production Terms** until SendFIL supplies a monitored legal
> contact, counsel selects governing law and forum, counsel completes the regulatory/privacy review,
> and `TERMS_VERSION` plus the displayed date are set to the actual publication date.

## Entity, notice, and dispute terms

- Confirm the exact legal name, formation jurisdiction, principal address, and notice address for
  SendFIL, LLC.
- Publish a monitored legal/support email. Section 20 intentionally does not invent one.
- Treat the missing legal contact as a publication blocker; replace Section 20 with the monitored
  email and any postal notice address counsel requires before the Terms become effective.
- Select governing law and an exclusive or non-exclusive forum based on the entity and target
  markets. The current draft intentionally omits an unsupported jurisdiction.
- Decide with counsel whether arbitration and a class-action waiver are appropriate. If used,
  supply the administrator, rules, venue, cost allocation, small-claims treatment, and a workable
  opt-out process. Do not paste a generic arbitration clause into the product.
- Confirm the limitation-of-liability cap and all required consumer-law riders for every launch
  market.

## Regulatory and market review

- Obtain a fact-specific money-transmission and other financial-services analysis for the hosted
  interface, fee design, contracts, and any operational control retained by SendFIL. Do not rely on
  a “non-custodial” label alone.
- Adopt a documented, risk-based sanctions and export-controls process. Decide whether launch
  scope requires geographic controls, wallet screening, or other measures. Contract language is
  not an operational compliance program.
- Confirm age, geographic, business-user, tax, employment-payment, and consumer-use restrictions
  against the actual intended market.
- Confirm who controls the two configured SendFIL fee destinations and that the fee presentation,
  accounting, tax, and refund treatment match operations.

## Product representations and risk disclosures

- Decide whether the Partial-mode economics are acceptable: each fee payment can succeed even if
  one or more user-recipient payments fail. Preserve the prominent point-of-transaction warning if
  this behavior ships.
- Resolve or explicitly constrain the known amount-pipeline precision gap: validated decimal text
  is currently converted to JavaScript `Number` before fee and execution preparation. A disclaimer
  is not a substitute for fixing or limiting this behavior before claiming exact 18-decimal
  support.
- Complete real-wallet and public-network smoke tests for the Mainnet and Calibration paths,
  including ThinBatch, FilSnap, Ledger Filecoin, and native multisig actions, before making broader
  verification claims.
- Recheck the Terms whenever custody, relaying, transaction replacement, account recovery,
  supported chains/assets, fee mechanics, or contract control changes.

## Privacy and records

- Complete a data map covering hosting logs, RPC/Lotus providers, WalletConnect, wallet adapters,
  analytics or telemetry, support communications, local storage, and public-chain data.
- Decide whether a separate Privacy Notice, cookie notice, consent mechanism, or data-processing
  contract is required. The current repo has no SendFIL application backend or external analytics
  transport, but third-party infrastructure can still receive IP addresses, wallet addresses, and
  transaction metadata.
- Set a retention and support process for local multisig records and unresolved native-submission
  safety records, including what users should do before clearing browser data.
- Archive every published Terms version. The app records the accepted version and timestamp only
  in browser local storage; assess whether that evidence is sufficient for SendFIL's risk profile
  or whether a privacy-preserving server-side acceptance record is warranted.
- Decide whether browser-wide acceptance is sufficient. The current record is not scoped to a
  wallet address, user, or browser session, so another person using the same browser profile could
  inherit acceptance, including through wallet auto-reconnection.

## Release process

- Have counsel review the exact rendered Terms and wallet/review copy, not only this Markdown
  checklist.
- Verify that `TERMS_VERSION`, the displayed effective date, and the archived legal text all match.
- Set the displayed effective date to the actual publication date immediately before release; do
  not treat a drafting or pull-request date as the effective date if publication occurs later.
- Require renewed affirmative acceptance for material revisions, while leaving read-only access
  to prior transaction recovery and status information available.
- Test keyboard access, focus handling, mobile layout, direct `?terms=1` links, new-tab links, and
  the first-time and previously accepted wallet flows.

## Primary research anchors for counsel

These sources are research starting points, not conclusions about SendFIL's obligations:

- [Berman v. Freedom Financial Network](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/05/20-16900.pdf)
  discusses conspicuous online notice and an unambiguous action manifesting assent. Review the
  rendered checkbox, link, wallet-selection action, and returning-wallet flow under the law that
  will govern the Terms.
- [15 U.S.C. § 7001](https://uscode.house.gov/view.xhtml?edition=prelim&path=%2Fprelim%40title15%2Fchapter96%2Fsubchapter1)
  addresses electronic records and signatures while preserving applicable disclosure, consent,
  retention, and non-waivable rights. Confirm whether any consumer disclosures trigger additional
  requirements.
- [FinCEN FIN-2019-G001](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models)
  applies a fact-specific framework to convertible-virtual-currency business models. Obtain advice
  based on the actual interface, fee routing, deployed contracts, and operational control rather
  than relying on the term “non-custodial.”
- [OFAC FAQ 560](https://ofac.treasury.gov/faqs/560) calls for a tailored, risk-based sanctions
  program for relevant virtual-currency activity. Contract language does not replace operational
  screening, controls, escalation, and recordkeeping where required.
