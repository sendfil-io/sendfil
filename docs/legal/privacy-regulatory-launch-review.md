# SendFIL Privacy and Regulatory Launch Review

Data-flow snapshot date: August 25, 2026. Drafting decisions revised August 27, 2026; infrastructure
facts have not been independently re-audited for this wording revision.

This is an engineering and product-risk review of the current repository. It records verified data
flows, launch decisions, and questions for qualified counsel. It is not a legal opinion and does not
determine whether SendFIL, LLC is licensed, exempt, or compliant in any jurisdiction.
These repository notes are not part of the user-facing Terms and are not confidential or privileged
merely because they are intended for counsel review.

> [!CAUTION]
> Terms language alone cannot resolve privacy, sanctions, money-transmission, consumer-protection,
> or international-market obligations. Complete the applicable operational and counsel items below
> before any external beta or production launch.

## Decisions recorded through August 27, 2026

- Contact: `sendfil@proton.me` is the draft Terms and privacy contact. Keep it monitored and
  adopt a response, escalation, and retention process.
- Effective date: the active draft is now `2026-08-27`, displayed as August 27, 2026. Preserve the
  prior source snapshot and require acceptance of the new version. Set the final version/date to
  actual publication; the draft date is not evidence that publication has occurred.
- Acceptance evidence: browser-wide acceptance is approved for the initial client-only release.
  The stored record contains only a Terms version and timestamp; it is not bound to a wallet,
  person, organization, state, or jurisdiction, and another person using the same browser profile
  may inherit it.
- Disputes: SendFIL, LLC was reported to be formed in Louisiana. At the user's request, the active
  public Terms and wallet copy no longer name that state. The entire governing-law/forum clause
  was removed; no substitute was selected. Counsel must approve a justified choice or deliberate
  omission before publication. Formation and applicable-law facts remain relevant to this review.
- Arbitration: omit mandatory arbitration and a class-action waiver from the initial release.
- Amount precision: do not accept the current decimal-rounding risk by disclaimer. Preserve exact
  attoFIL values before claiming support for amounts with up to 18 decimal places.
- Proposed market—not current behavior: preserve a closed, fee-free Calibration business beta
  while federal and applicable state classifications are obtained. The earlier draft's
  Louisiana-business boundary is not broadened by removing its name from public copy. No substitute
  market is approved by this revision. A separately approved launch geography and legal review must
  precede invitations, and any expansion beyond the prior proposed boundary requires an explicit
  market decision. The first real-value market remains unresolved and requires applicable written
  regulatory determinations or issued licenses, not only a new contract label.
- Eligibility evidence: the public draft now requires a current, non-transferable written
  invitation naming the participant, Terms version, permitted jurisdictions, and geographic
  eligibility restrictions, delivered before assent. Retain those restrictions and delivery/version
  records under the approved privacy plan. An invitation cannot override business-use, fee-free,
  Calibration-only, or other substantive Terms, nor authorize geographic expansion by itself.
  The current app does not verify invitation, identity, business status, beneficiary/recipient
  location, or user geography, and it still exposes Mainnet. The browser acceptance record contains
  no invitation identifier or scope. Do not describe the proposed controls as implemented or deploy
  the Terms until access, network, fee, and jurisdiction behavior match.

## Verified current data map

| Data or activity | Current flow | Persistence and recipients |
| --- | --- | --- |
| Manual and CSV payment data | Files are read and parsed in browser memory. Extracted addresses, amounts, and encoded batches are later used for validation, estimation, signing, submission, and status checks. | The CSV file is not uploaded as a file to a SendFIL application API. Extracted data can reach wallets, WalletConnect/Reown, configured RPC or Lotus providers, contracts, actors, and the public blockchain. Submitted data may remain public indefinitely. |
| Terms acceptance | The app records the accepted version and timestamp. | Browser local storage under `sendfil.terms-acceptance.v1`, until replaced or cleared. It is browser-wide, not wallet-scoped, and is not independently verifiable by SendFIL. |
| Saved multisigs | Network, robust and ID addresses, a user label, and timestamps. | Browser local storage under `sendfil.multisigs.v1`, until removed or browser data is cleared. |
| Native submission safety records | Signer or multisig identity, provider, network, CID, method or mode, recipient count, total value, warnings or errors, and timestamps. | Browser local storage under `sendfil.native-submissions.v1` and `sendfil.multisig-uncertain-actions.v1` until terminal reconciliation or clearing. Clearing unresolved records can increase duplicate-submission risk. |
| EVM wallet connection | Public account, chain, connector, balance, code, estimate, submission, and status requests. | Wagmi can persist connection metadata in browser local storage. Wallets and RPC providers process requests under their own practices. |
| WalletConnect connection | Pairing, session, account, chain, relay, verification, and request information. | WalletConnect can use IndexedDB or local storage for pairing/session material and sends protocol traffic through WalletConnect/Reown infrastructure. |
| Native wallets | FilSnap receives account/network requests and messages for signing. Ledger receives signing data through browser WebHID and the hardware device. | Controlled by the wallet, browser, device, and their applicable storage and provider behavior. No SendFIL-coded Ledger cloud transport was identified. |
| RPC and Lotus traffic | Default configuration uses GLIF for Mainnet and Calibration; Ankr can act as a Mainnet read-only fallback. Deployment configuration may replace these endpoints. | Providers can receive IP and request metadata, public addresses, code/balance/state queries, full unsigned transaction data during estimation, signed native messages during submission, hashes or CIDs, and status requests. Provider retention is not established in this repository. |
| App telemetry | Batch status and error events are written to the browser console and emitted as a same-page custom event. | No first-party external analytics transport is configured in this repository. Browser extensions, injected scripts, wallets, infrastructure, or production hosting may independently process related activity. |
| Support and privacy email | Information voluntarily sent to `sendfil@proton.me`. | Processed through Proton and retained according to SendFIL's still-to-be-defined support/legal retention process and Proton's applicable practices. Users must not send wallet secrets or confidential CSV files. |
| Hosting and delivery logs | Public response headers checked August 25, 2026 identify Cloudflare as the current edge provider and advertise a Cloudflare Network Error Logging endpoint. A supported browser may send sampled reports; the header does not prove a report was sent. The repository does not identify the origin host or the account's exact DNS, WAF, logging, cookie, and security configuration. | Cloudflare and any origin host may process ordinary request and security data separately from NEL. NEL can include the affected URL and referrer, method, timing, failure phase, protocol, server IP, status or error, and sampling data; Cloudflare says it derives ASN, country, and metro and drops the client IP after NEL request processing. Account access, fields, retention, locations, and subprocessors still require production verification. |

No SendFIL application API, application database, advertising tag, third-party script tag, cookie
code, or first-party external analytics SDK was identified in the current repository. This is a
code-scoped finding, not a promise about the production host or third-party wallet infrastructure.

## Privacy launch work

Before any invited beta or production use, and promptly for any already-public page:

1. Publish a separate Privacy Notice linked conspicuously beside the Terms and from the wallet flow.
   It must cover every visitor whose data is processed, including an ineligible, out-of-state,
   foreign, personal-use, or underage visitor whose hosting data is received before assent. Identify
   the controller, entity address, `sendfil@proton.me`, effective date, data categories and sources,
   purposes and legal bases, recipients, international transfers, retention, rights, appeals,
   security, children, and blockchain-deletion limits. The wallet flow should say the user
   “acknowledges” the notice, not that general Terms assent supplies privacy consent.
2. Inventory the Cloudflare account and identify the origin host, DNS, WAF, network-error reporting,
   logs, cookies, security identifiers, retention periods, processing locations, subprocessors, and
   applicable contract or DPA.
3. Freeze and inventory the production WalletConnect/Reown, RPC, Lotus, wallet, explorer, and
   support-email providers. Record which party is acting as controller or processor and link the
   applicable notices.
4. Set category-specific retention periods for data SendFIL controls, including CSV/manual draft
   memory, local diagnostics, support messages, privacy-request and verification records, saved
   multisigs, Terms evidence, and unresolved safety records. Document provider retention schedules
   and deletion limits for hosting/security and NEL records, Wagmi and WalletConnect records, RPC
   records, and other provider copies. Disclose that public-chain data may remain available
   indefinitely. If the CCPA applies, retain required request and response records for at least its
   prescribed period.
5. Explain how browser data can be cleared while warning users not to clear unresolved native
   submission records before reconciliation.
6. Add consent before introducing any future nonessential analytics, advertising, or browser
   storage that requires consent in a served jurisdiction.
7. Test the deployed site—not only the source—for cookies, network requests, security headers,
   content-security policy, referrer policy, permissions policy, and third-party scripts.
8. Complete a CalOPPA disclosure review, including the review/correction process, material-change
   notice, Do Not Track response, effective date, and whether other parties may collect personally
   identifiable information over time and across services. CalOPPA has no CCPA-style revenue or
   volume threshold.
9. Complete a current CCPA applicability worksheet covering revenue; the annual number of consumers
   or households whose personal information the business buys, sells, or shares (including whether
   that number reaches 100,000); whether at least 50% of annual revenue comes from selling or sharing
   personal information; affiliates and common branding; and any voluntary certification. If it
   applies, publish the required preceding-twelve-month categories, sources, purposes, business
   disclosures, and request methods.
10. Verify vendor contracts and live configuration before claiming no sale, sharing, targeted
    advertising, or financial incentive; document how a legally valid Global Privacy Control or
    other required opt-out signal will be treated.
11. Design state-specific request verification, authorized-agent, correction, deletion, portability,
    opt-out, and appeal handling before promising those rights.
12. Treat public wallet addresses and transaction data as pseudonymous rather than necessarily
    anonymous when they can be linked to a person, household, or device. Do not overstate the
    credential finding: SendFIL application code does not store wallet private keys or recovery
    phrases, while WalletConnect may store protocol cryptographic session material locally.

Applicability of state and international privacy laws depends on the entity, users, targeting,
data, and statutory thresholds. Do not claim that a privacy law does or does not apply without that
analysis.

Louisiana Act 502 of 2026, the Louisiana Data Privacy Act, takes effect January 1, 2027. It applies
to a person or entity doing business in Louisiana only after specified revenue, data-volume, or
sale-revenue thresholds are met. Its Louisiana-specific consumer definition excludes an individual
acting in a commercial or employment context; do not generalize that exclusion to another state's
law. Business-only positioning may narrow its consumer-rights scope but does not replace a separate
notice, a threshold analysis, security and retention work, or other applicable law. Hosting data can
also be processed before a visitor makes the business-use representation. If the Act applies,
implement its request and appeal mechanisms, data minimization, security, processor contracts, and
other duties. More generally, do not treat acceptance of the Terms as privacy consent under any law
that requires separate, specific, or purpose-limited consent.

Separately, assess Louisiana R.S. 51:3074, which addresses reasonable security, destruction, and
Louisiana-resident breach notice for covered computerized personal information. The repository may
not currently handle every element of its covered-data definition, but support messages, hosting
records, and future operations must be mapped before making that conclusion.

## Sanctions and export-controls work

The Terms prohibit unlawful and sanctions-evasive use and include a blocked-person representation.
That is not an operational sanctions program. Before launch, document a risk-based decision about:

- screening the connected sender, selected funding multisig, recipients, and SendFIL fee
  destinations against current sanctions data;
- IP/geolocation signals, comprehensively sanctioned jurisdictions, VPN/proxy escalation, and the
  limits of location data;
- the OFAC 50 Percent Rule and ownership information that an address-only screen cannot establish;
- false positives, blocked attempts, escalation to counsel, licensing questions, recordkeeping,
  list-update cadence, and historical lookbacks; and
- non-U.S. sanctions regimes for every market SendFIL intentionally serves.

## Money-transmission and financial-services work

Facts relevant to the analysis include that users retain their keys and authorize their own
transactions, the app has no SendFIL transaction-relay backend, and transactions interact with
public contracts and actors, including SendFIL-configured or deployed components. Those facts do
not support a categorical legal conclusion.

Counsel should document:

- who deployed Multicall3, FilForwarder, and each ThinBatch contract;
- every admin, upgrade, pause, sweep, redirect, freeze, recovery, or ownership capability;
- who controls the SendFIL fee destinations and whether fees can be changed or redirected;
- whether SendFIL ever accepts, controls, relays, sponsors, recovers, or independently transmits
  value; and
- a federal BSA/MSB analysis plus the state-by-state money-transmitter analysis for intended U.S.
  markets.

Do not state that SendFIL “is not a money transmitter.” Preserve the current user-controlled-key and
no-SendFIL-relay architecture, and re-review before adding relaying, recovery discretion, gas
sponsorship, admin keys, or other operational control.

For Louisiana specifically, R.S. 6:1382 defines control in transaction terms as unilateral power to
execute or indefinitely prevent a virtual-currency transaction, which makes user-controlled keys a
relevant favorable fact. R.S. 6:1383 nevertheless applies the Act to covered activity with or for a
Louisiana resident and contains fact-specific exemptions. Because SendFIL's Mainnet configuration
charges a fee, do not rely on the no-compensation exemption. Have counsel and OFI assess whether the
actual transaction-building, validation, contract, and fee facts satisfy or fall outside the
connectivity or another exemption. Business-only use is not itself an exemption from the VCBA,
FinCEN, OFAC, LUTPA, or every state privacy law. Louisiana Act 923 of 2026 repealed the VCBA's sunset
provisions effective August 1, 2026, so do not rely on an older July 2027 sunset note.

If OFI concludes that a license is required, do not launch the covered Mainnet activity until the
license is issued and all applicable licensee obligations are operational. If and when SendFIL is a
licensee, implement every applicable R.S. 6:1393.1 duty, as amended. Required resident disclosures
are separate from other information, clear, conspicuous, acknowledged, and accompanied by
applicable transaction disclosures and receipts; general Terms are not a substitute. Louisiana Act
482 of 2026 amended statutory disclosure and receipt language effective August 1, 2026, including
contact, transaction, fee, and refund provisions. Counsel must reconcile the enacted amendments
with the codified page and the facts of any proposed activity.

## Consumer-protection work

The draft now places fees, full recipient addresses, execution method, Partial-mode consequences,
network, and wallet authorization consequences near the transaction decision. Remaining work:

- fix the exact-amount pipeline. For example, `1.000000000000000001 FIL` is valid input but is
  currently converted to JavaScript `Number` and can become `1 FIL` before transaction preparation;
- complete real-wallet and public-network smoke testing for every wallet and execution method
  described as production-ready;
- confirm the US$100 liability cap, indemnity, unilateral-change language, and eventual forum
  clause for each consumer market; and
- keep product claims, fee presentation, support responses, and privacy promises consistent with
  actual behavior. A disclaimer does not cure a misleading interface or transaction amount.

## International launch posture

Until market-specific review is complete, the conservative launch posture is to avoid intentionally
marketing or providing localized support into unreviewed jurisdictions. Public internet access and
a Terms restriction do not by themselves establish that a jurisdiction's laws are inapplicable.

Before intentionally serving the EEA, UK, or another non-U.S. market, assess privacy territorial
scope, consumer-contract rules, sanctions, licensing, required local contacts or representatives,
international transfers, and crypto-asset regulation. For the EEA, counsel should specifically
review whether the product activity could be characterized as a transfer service under MiCA and
whether GDPR Article 3 applies based on offering or monitoring activity.

The geographic restrictions in a written invitation are contractual eligibility rules, not proof of
geographic exclusion. Removing a state name from the generic Terms does not authorize another
market. Before any later U.S.-only or state-allowlist expansion, align marketing and support with
the approved scope and implement a counsel-approved allowlist and proportionate controls. Do not
describe the current site as geoblocked, location-verified, or available throughout the United States.

## Primary research anchors

- [FinCEN FIN-2019-G001](https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)
- [31 C.F.R. § 1010.100(ff)(5)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100)
- [OFAC Sanctions Compliance Guidance for the Virtual Currency Industry](https://ofac.treasury.gov/system/files/126/virtual_currency_guidance_brochure.pdf)
- [OFAC FAQ 560](https://ofac.treasury.gov/faqs/560)
- [FTC privacy and security guidance](https://www.ftc.gov/business-guidance/privacy-security)
- [FTC Act enforcement authority](https://www.ftc.gov/about-ftc/mission/enforcement-authority)
- [California Privacy Protection Agency CCPA FAQ](https://cppa.ca.gov/faq)
- [California Business and Professions Code §§ 22575–22577](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?chapter=22.&division=8.&lawCode=BPC&part=&title=)
- [Cloudflare Network Error Logging](https://developers.cloudflare.com/network-error-logging/)
- [GDPR Articles 3 and 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679)
- [MiCA Regulation](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R1114)
- [Rome I Regulation, Article 6](https://eur-lex.europa.eu/eli/reg/2008/593/oj)
- [Louisiana Virtual Currency Businesses Act definitions](https://www.legis.la.gov/legis/Law.aspx?d=1187463)
- [Louisiana Virtual Currency Businesses Act applicability](https://www.legis.la.gov/legis/Law.aspx?d=1187464)
- [Louisiana OFI Virtual Currency Business Activity](https://ofi.la.gov/non-depository/virtual-currency-business-activity/)
- [Louisiana R.S. 6:1393.1 required disclosures](https://www.legis.la.gov/legis/law.aspx?d=1336388)
- [Louisiana Act 482 of 2026](https://legis.la.gov/Legis/ViewDocument.aspx?d=1480178)
- [Louisiana Act 923 of 2026](https://legis.la.gov/Legis/ViewDocument.aspx?d=1481806)
- [Louisiana Act 502 of 2026](https://www.legis.la.gov/Legis/ViewDocument.aspx?d=1480202)
- [Louisiana R.S. 51:3074](https://legis.la.gov/Legis/Law.aspx?d=322030&p=y)
