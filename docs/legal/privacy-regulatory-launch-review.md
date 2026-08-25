# SendFIL Privacy and Regulatory Launch Review

Snapshot date: August 25, 2026

This is an engineering and product-risk review of the current repository. It records verified data
flows, launch decisions, and questions for qualified counsel. It is not a legal opinion and does not
determine whether SendFIL, LLC is licensed, exempt, or compliant in any jurisdiction.

> [!CAUTION]
> Terms language alone cannot resolve privacy, sanctions, money-transmission, consumer-protection,
> or international-market obligations. Complete the operational and counsel items below before a
> broad production launch.

## Decisions recorded on August 25, 2026

- Contact: `sendfil@proton.me` is the published Terms and privacy contact. Keep it monitored and
  adopt a response, escalation, and retention process.
- Effective date: August 25, 2026 is the requested initial Terms date. Change the version and date
  together if publication occurs later.
- Acceptance evidence: browser-wide acceptance is approved for the initial client-only release.
  Another person using the same browser profile may inherit that acceptance.
- Disputes: use SendFIL, LLC's formation state for governing law and forum, with a carveout for
  non-waivable consumer rights. The formation state is still needed before drafting the clause.
- Arbitration: omit mandatory arbitration and a class-action waiver from the initial release.
- Amount precision: do not accept the current decimal-rounding risk by disclaimer. Preserve exact
  attoFIL values before claiming support for amounts with up to 18 decimal places.

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
| Hosting and delivery logs | Public response headers checked August 25, 2026 identify Cloudflare as the current edge provider and enable Cloudflare network-error reporting. The repository does not identify the origin host or the account's exact DNS, WAF, logging, cookie, and security configuration. | Cloudflare and any origin host may process IP addresses, device/browser data, request paths, security identifiers, network-error reports, and logs. Account access, fields, retention, locations, and subprocessors still require production verification. |

No SendFIL application API, application database, advertising tag, third-party script tag, cookie
code, or first-party external analytics SDK was identified in the current repository. This is a
code-scoped finding, not a promise about the production host or third-party wallet infrastructure.

## Privacy launch work

Before a broad launch:

1. Publish a separate Privacy Notice linked beside the Terms and from the wallet flow. Identify the
   controller, entity address, `sendfil@proton.me`, effective date, data categories and sources,
   purposes and legal bases, recipients, international transfers, retention, rights, appeals,
   security, children, and blockchain-deletion limits.
2. Inventory the Cloudflare account and identify the origin host, DNS, WAF, network-error reporting,
   logs, cookies, security identifiers, retention periods, processing locations, subprocessors, and
   applicable contract or DPA.
3. Freeze and inventory the production WalletConnect/Reown, RPC, Lotus, wallet, explorer, and
   support-email providers. Record which party is acting as controller or processor and link the
   applicable notices.
4. Set retention periods for hosting/security logs, support messages, saved multisigs, Terms
   evidence, unresolved safety records, and WalletConnect sessions.
5. Explain how browser data can be cleared while warning users not to clear unresolved native
   submission records before reconciliation.
6. Add consent before introducing any future nonessential analytics, advertising, or browser
   storage that requires consent in a served jurisdiction.
7. Test the deployed site—not only the source—for cookies, network requests, security headers,
   content-security policy, referrer policy, permissions policy, and third-party scripts.

Applicability of state and international privacy laws depends on the entity, users, targeting,
data, and statutory thresholds. Do not claim that a privacy law does or does not apply without that
analysis.

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

## Primary research anchors

- [FinCEN FIN-2019-G001](https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)
- [31 C.F.R. § 1010.100(ff)(5)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100)
- [OFAC Sanctions Compliance Guidance for the Virtual Currency Industry](https://ofac.treasury.gov/system/files/126/virtual_currency_guidance_brochure.pdf)
- [OFAC FAQ 560](https://ofac.treasury.gov/faqs/560)
- [FTC privacy and security guidance](https://www.ftc.gov/business-guidance/privacy-security)
- [FTC Act enforcement authority](https://www.ftc.gov/about-ftc/mission/enforcement-authority)
- [California Privacy Protection Agency CCPA FAQ](https://cppa.ca.gov/faq)
- [California Business and Professions Code §§ 22575–22577](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?chapter=22.&division=8.&lawCode=BPC&part=&title=)
- [GDPR Articles 3 and 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679)
- [MiCA Regulation](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R1114)
- [Rome I Regulation, Article 6](https://eur-lex.europa.eu/eli/reg/2008/593/oj)
