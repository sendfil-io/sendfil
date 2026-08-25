# SendFIL Terms: Counsel and Launch Checklist

The in-app Terms of Service are a product-specific first draft, not a substitute for advice from
qualified counsel. Complete this checklist before treating the draft as final production terms.

> [!CAUTION]
> **Do not merge or deploy this draft as production Terms** until SendFIL verifies its formation
> documents and principal location, supplies a postal notice address, and counsel completes the
> regulatory, market, and privacy review. SendFIL, LLC has been identified as a Louisiana LLC, and
> the draft now selects Louisiana law and courts. The requested initial effective date is August
> 25, 2026; change it if publication occurs later.

## Entity, notice, and dispute terms

- SendFIL, LLC was reported on August 25, 2026 to have been formed in Louisiana. Verify its exact
  name and status against the formation documents and identify the principal and postal notice
  addresses before publication.
- `sendfil@proton.me` was supplied on August 25, 2026 and is now published for Terms questions,
  privacy inquiries, and non-litigation correspondence. Confirm that it is continuously monitored
  and adopt an internal response/escalation process. Add a postal notice address when one is
  available.
- Product decision recorded August 25, 2026: the draft selects Louisiana law and state or federal
  courts of competent jurisdiction located in Louisiana, with non-waivable-law and non-waivable-
  forum carveouts. Counsel should confirm the rendered clause. It does not invent a parish because
  the principal-office parish has not been supplied.
- Recommended initial arbitration position: do not add mandatory arbitration or a class-action
  waiver for the first release. Reconsider after counsel can design and operationally support the
  administrator, rules, venue, cost allocation, small-claims treatment, mass-arbitration handling,
  and a workable opt-out process.
- Confirm the limitation-of-liability cap and all required consumer-law riders for every launch
  market.

## Regulatory and market review

- Most conservative immediate-release recommendation: operate a closed, fee-free Calibration-only
  beta while obtaining a written federal money-transmission analysis and Louisiana Office of
  Financial Institutions classification. Test assets and a closed beta reduce risk but do not
  eliminate privacy, sanctions, consumer-protection, contract, or security obligations.
- First real-value market recommendation: business use in Louisiana only after a written OFI
  determination or an issued license, if required, informed by a documented opinion from qualified
  Louisiana regulatory counsel. Then expand through a U.S. state allowlist, adding states only after
  clearance. “U.S.-only” does not itself resolve fifty-state money-transmission law.
- This draft now limits its initial scope and assent representation to an invited, fee-free,
  Louisiana-business Calibration beta. That is proposed legal scope, not current product behavior:
  the app still exposes Mainnet and has no invitation, identity, business-status, recipient-location,
  or Louisiana-location gate. Do not deploy these Terms until separate product work enforces the
  access, network, fee, and jurisdiction limits and the rendered copy is updated to match. The
  access gate must enforce the Terms definition of a current, non-transferable written invitation
  issued directly by SendFIL to the named individual or organization and retain appropriate evidence
  under the approved privacy and retention plan.
- Do not treat Louisiana-only or business-only use as an automatic legal exemption. Louisiana's
  Virtual Currency Businesses Act expressly reaches covered activity with or on behalf of
  Louisiana residents. The current SendFIL fee weakens reliance on the no-compensation exemption.
  User control of keys and the absence of a SendFIL transaction-relay backend are favorable facts,
  but obtain written advice before claiming the connectivity or another exemption.
- Louisiana Act 923 of 2026 repealed the VCBA's prior sunset provisions effective August 1, 2026;
  do not plan around the older July 2027 sunset note still displayed on some codified pages. Have
  counsel present the actual architecture, fee, contract, and control facts to OFI and obtain a
  written position before compensated Louisiana Mainnet use. An applicant is not authorized to
  operate merely because a required license application is pending.
- If OFI concludes that a license is required, do not launch the covered Mainnet activity until the
  license is issued and all applicable licensee obligations are operational. If and when SendFIL is
  a licensee, implement every applicable requirement of R.S. 6:1393.1, as amended. Its resident
  disclosures must be separate, clear, conspicuous, and acknowledged, and its transaction
  disclosures and receipts cannot be replaced or buried by general Terms. Have counsel reconcile
  the current enacted text—including Louisiana Act 482 of 2026—with the codified page and determine
  the exact requirements and applicability.
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
  provider and advertise a Cloudflare network-error-reporting endpoint. Supported browsers may send
  sampled reports. Audit the Cloudflare account, origin host, DNS, WAF, logs, cookies, security
  identifiers, retention, locations, and subprocessors.
- Publish a separate Privacy Notice before any invited beta or production use, and promptly for any
  already-public page. Determine whether a cookie/storage notice, consent mechanism,
  data-processing contract, international-transfer mechanism, or local privacy representative is
  required for each intended market.
- Inventory and freeze the production WalletConnect/Reown, RPC/Lotus, wallet, explorer, hosting,
  and support-email vendors, then confirm their notices and controller/processor roles.
- Set retention periods for data SendFIL controls, document provider-controlled schedules and
  deletion limits, and disclose that public-chain records may remain available indefinitely. Cover
  local multisig records, unresolved native-submission safety records, hosting/security logs,
  support emails, wallet sessions, and Terms evidence, including what users should do before
  clearing browser data.
- Archive every published Terms version. The app records the accepted version and timestamp only
  in browser local storage; assess whether that evidence is sufficient for SendFIL's risk profile
  or whether a privacy-preserving server-side acceptance record is warranted.
- Product decision recorded August 25, 2026: browser-wide acceptance is approved for the initial
  client-only release. The record is not scoped to a wallet address, user, or browser session, so
  another person using the same browser profile could inherit acceptance, including through wallet
  auto-reconnection. Keep the linked accepted-Terms notice visible and revisit this decision if
  SendFIL adds accounts, a backend, or higher-risk user-specific features.
- Louisiana Act 502 of 2026, the Louisiana Data Privacy Act, takes effect January 1, 2027 and uses
  revenue, volume, and sale-revenue thresholds. Determine applicability before that date and, if
  applicable, implement its notice, request, appeal, minimization, security, processor-contract,
  and opt-out requirements. Do not bundle statutory privacy consent into general Terms assent.
- Independently assess Louisiana R.S. 51:3074 security, destruction, and breach-notification duties
  for information SendFIL handles through hosting, support, or future operations. Map the statute's
  covered-data definition rather than making a categorical non-applicability claim.

## Release process

- Have counsel review the exact rendered Terms and wallet/review copy, not only this Markdown
  checklist.
- Verify that `TERMS_VERSION`, the displayed effective date, and the archived legal text all match.
- August 25, 2026 is the requested initial effective date. Verify that publication actually occurs
  on that date; otherwise update `TERMS_VERSION`, the displayed date, and the archived legal text
  together immediately before release.
- As of this draft, `origin/main` does not contain the Terms feature, so the Louisiana, eligibility,
  liability, and forum edits remain part of the same unpublished `2026-08-25` version. If any prior
  draft was made available for real assent outside an internal preview, issue a new version/date and
  reject the earlier acceptance record instead of reusing this version.
- The in-app Terms include a print/save control and a copy-request method, and the source now keeps
  each version as a date-labeled component under `src/legal/versions`. Preserve that immutable
  source version, the release commit, and a copy of the exact rendered text actually published;
  Git history alone should not be the only public-facing archive process.
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
- [Louisiana Civil Code article 3540](https://www.legis.la.gov/legis/Law.aspx?d=110561)
  recognizes an express choice of law subject to the public policy of the otherwise-applicable
  state. Counsel should confirm the Louisiana clause and its savings language for the launch market.
- [Louisiana Civil Code article 2004](https://www.legis.la.gov/legis/Law.aspx?d=109260) bars advance
  limitations for intentional or gross fault and for causing physical injury; confirm the Section 17
  savings language against the final protected-party list.
- [Shelter Mutual Insurance Co. v. Rimkus Consulting Group, Inc. of Louisiana](https://www.lasc.org/opinions/2014/13CC1977.opn.pdf)
  addresses enforcement of forum-selection clauses under Louisiana law.
- [Louisiana R.S. 9:2607](https://legis.la.gov/legis/Law.aspx?d=107133),
  [R.S. 9:2608](https://www.legis.la.gov/legis/law.aspx?d=107134), and
  [R.S. 9:2612](https://www.legis.la.gov/legis/Law.aspx?d=107138) address electronic contracts,
  retainable presentation, and record retention. Verify the full print/save output and acceptance
  records under the laws that apply.
- [Louisiana R.S. 6:1382](https://www.legis.la.gov/legis/Law.aspx?d=1187463) and
  [R.S. 6:1383](https://www.legis.la.gov/legis/Law.aspx?d=1187464) define virtual-currency business
  activity, control, transfer, residents, scope, and exemptions. Obtain a fact-specific Louisiana
  classification before a compensated Mainnet launch.
- [Louisiana OFI's VCBA page](https://ofi.la.gov/non-depository/virtual-currency-business-activity/)
  states that entities engaging in covered activity need a license and identifies current filing
  and enforcement materials.
- [Louisiana R.S. 6:1393.1](https://www.legis.la.gov/legis/law.aspx?d=1336388) imposes separate
  disclosure, acknowledgment, transaction-disclosure, and receipt duties on covered licensees.
- [Louisiana Act 482 of 2026](https://legis.la.gov/Legis/ViewDocument.aspx?d=1480178), effective
  August 1, 2026, amended R.S. 6:1393.1 disclosure and receipt language. Counsel should reconcile
  the enacted amendments with the codified page before relying on it.
- [Louisiana Act 923 of 2026](https://legis.la.gov/Legis/ViewDocument.aspx?d=1481806) repeals the
  VCBA sunset provisions effective August 1, 2026.
- [Louisiana Act 502 of 2026](https://www.legis.la.gov/Legis/ViewDocument.aspx?d=1480202) creates
  privacy duties effective January 1, 2027 for businesses meeting its thresholds.
- [Louisiana R.S. 51:3074](https://legis.la.gov/Legis/Law.aspx?d=322030&p=y) addresses reasonable
  security, destruction, and breach notification for covered computerized personal information.
