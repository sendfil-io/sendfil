# SendFIL Terms: Counsel and Launch Checklist

The in-app Terms of Service are a product-specific first draft, not a substitute for advice from
qualified counsel. Complete this checklist before treating the draft as final production terms.

> [!CAUTION]
> **Do not merge or deploy this draft as production Terms** until SendFIL confirms its formation
> jurisdiction and principal location, counsel selects governing law and forum, and counsel
> completes the regulatory/privacy review. The requested initial effective date is August 25,
> 2026; change it if publication occurs later.

## Entity, notice, and dispute terms

- Confirm the exact legal name, formation jurisdiction, principal address, and notice address for
  SendFIL, LLC.
- `sendfil@proton.me` was supplied on August 25, 2026 and is now published for Terms questions,
  privacy inquiries, and non-litigation correspondence. Confirm that it is continuously monitored
  and adopt an internal response/escalation process. Add a postal notice address when one is
  available.
- Recommended initial dispute position: choose the law of SendFIL, LLC's formation state and the
  state and federal courts in that same state, subject to non-waivable consumer rights. Supply the
  exact formation state before adding the clause; the current draft does not invent it.
- Recommended initial arbitration position: do not add mandatory arbitration or a class-action
  waiver for the first release. Reconsider after counsel can design and operationally support the
  administrator, rules, venue, cost allocation, small-claims treatment, mass-arbitration handling,
  and a workable opt-out process.
- Confirm the limitation-of-liability cap and all required consumer-law riders for every launch
  market.

## Regulatory and market review

- Use the verified code-level data map and issue list in
  [`privacy-regulatory-launch-review.md`](./privacy-regulatory-launch-review.md) as the factual
  starting point. Complete the unknown production-host and operating-practice fields before counsel
  signs off.
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
- Fix the known amount-pipeline precision gap before claiming exact 18-decimal support. Validated
  decimal text is currently converted to JavaScript `Number` before fee and execution preparation,
  so very small decimal differences can be rounded away. The August 25 product decision is not to
  accept that risk by disclaimer; transaction amounts should remain decimal strings or attoFIL
  `bigint` values through preparation.
- Complete real-wallet and public-network smoke tests for the Mainnet and Calibration paths,
  including ThinBatch, FilSnap, Ledger Filecoin, and native multisig actions, before making broader
  verification claims.
- Recheck the Terms whenever custody, relaying, transaction replacement, account recovery,
  supported chains/assets, fee mechanics, or contract control changes.

## Privacy and records

- A code-scoped repository data-flow inventory was completed as of August 25, 2026; it is not a
  complete production data map. Public response headers identify Cloudflare as the current edge
  provider and enable Cloudflare network-error reporting. Audit the Cloudflare account, origin host,
  DNS, WAF, logs, cookies, security identifiers, retention, locations, and subprocessors.
- Publish a separate Privacy Notice before broad launch. Determine whether a cookie/storage notice,
  consent mechanism, data-processing contract, international-transfer mechanism, or local privacy
  representative is required for each intended market.
- Inventory and freeze the production WalletConnect/Reown, RPC/Lotus, wallet, explorer, hosting,
  and support-email vendors, then confirm their notices and controller/processor roles.
- Set a retention and support process for local multisig records and unresolved native-submission
  safety records, hosting/security logs, support emails, wallet sessions, and Terms evidence,
  including what users should do before clearing browser data.
- Archive every published Terms version. The app records the accepted version and timestamp only
  in browser local storage; assess whether that evidence is sufficient for SendFIL's risk profile
  or whether a privacy-preserving server-side acceptance record is warranted.
- Product decision recorded August 25, 2026: browser-wide acceptance is approved for the initial
  client-only release. The record is not scoped to a wallet address, user, or browser session, so
  another person using the same browser profile could inherit acceptance, including through wallet
  auto-reconnection. Keep the linked accepted-Terms notice visible and revisit this decision if
  SendFIL adds accounts, a backend, or higher-risk user-specific features.

## Release process

- Have counsel review the exact rendered Terms and wallet/review copy, not only this Markdown
  checklist.
- Verify that `TERMS_VERSION`, the displayed effective date, and the archived legal text all match.
- August 25, 2026 is the requested initial effective date. Verify that publication actually occurs
  on that date; otherwise update `TERMS_VERSION`, the displayed date, and the archived legal text
  together immediately before release.
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
