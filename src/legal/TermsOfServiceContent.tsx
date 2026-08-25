import type { ReactNode } from 'react';
import { TERMS_LAST_UPDATED } from './termsAcceptance';

function LegalSection({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={`terms-section-${number}`} className="scroll-mt-24">
      <h3 className="text-lg font-semibold text-slate-950">
        {number}. {title}
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-700">{children}</div>
    </section>
  );
}

function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-slate-400">{children}</ul>;
}

export function TermsOfServiceContent() {
  return (
    <article className="mx-auto max-w-3xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
          SendFIL, LLC
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Terms of Service
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Effective and last updated {TERMS_LAST_UPDATED}
        </p>
      </header>

      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
        <p className="font-semibold">Important notice</p>
        <p className="mt-1">
          SendFIL is a non-custodial interface. Blockchain transactions may be irreversible, and
          SendFIL cannot recover FIL sent to an incorrect recipient or network. Review every
          recipient, amount, fee, network, execution method, and wallet prompt before signing.
        </p>
      </div>

      <nav aria-label="Terms of Service sections" className="mt-6 rounded-2xl bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Contents</p>
        <ol className="mt-3 grid gap-x-6 gap-y-2 text-sm text-blue-700 sm:grid-cols-2">
          {[
            'Agreement and eligibility',
            'The Service',
            'Non-custodial wallet access',
            'Your transaction instructions',
            'Batch methods and multisig',
            'Fees',
            'Recipient and CSV information',
            'Blockchain risks and finality',
            'Third-party services',
            'Privacy and local data',
            'Prohibited use and sanctions',
            'Taxes and legal compliance',
            'No advice or fiduciary duty',
            'Intellectual property',
            'Changes, availability, and termination',
            'Disclaimers',
            'Limitation of liability',
            'Indemnification',
            'General terms',
            'Contact',
          ].map((title, index) => (
            <li key={title}>
              <a className="hover:underline" href={`#terms-section-${index + 1}`}>
                {index + 1}. {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-9">
        <LegalSection number={1} title="Agreement and eligibility">
          <p>
            These Terms of Service (the <strong>“Terms”</strong>) govern access to and use of the
            website at sendfil.io, the SendFIL interface, and related software and features that
            link to these Terms (collectively, the <strong>“Service”</strong>). The Service is
            provided by SendFIL, LLC (<strong>“SendFIL,” “we,” “us,”</strong> or
            <strong> “our”</strong>).
          </p>
          <p>
            By checking the Terms acceptance control and selecting a wallet, clicking an “I agree”
            control, or submitting an on-chain action through the Service, you acknowledge that you
            have read, understood, and agree to these Terms. If you do not agree, do not connect a
            wallet or submit an on-chain action through the Service.
          </p>
          <p>
            You may use the Service only if you have reached the age of legal majority where you
            live and can form a binding contract. If you use the Service for a company, DAO, fund,
            employer, client, or other person, you represent that you are authorized to accept these
            Terms and initiate the relevant transactions on that person&apos;s behalf.
          </p>
        </LegalSection>

        <LegalSection number={2} title="The Service">
          <p>
            SendFIL is a client-side interface that helps users prepare, review, sign, submit, and
            monitor user-directed FIL transfers on supported Filecoin networks. Depending on the
            connected wallet, network, and current configuration, the Service may support manual
            entry, CSV import, EVM/FEVM wallets, native Filecoin wallets, single-signer batches,
            native Filecoin multisig funding, gas estimation, transaction-status polling, and links
            to public block explorers.
          </p>
          <p>
            The Service may prepare calls involving Multicall3, FilForwarder, ThinBatchPayer, the
            Filecoin multisig actor, or other public blockchain components. Those networks,
            contracts, actors, and protocols operate independently of the hosted interface. A
            feature appearing in source code, documentation, a roadmap, or a test environment does
            not guarantee that it is enabled, available, verified, or appropriate for use on any
            particular network.
          </p>
          <p>
            SendFIL does not guarantee uninterrupted access, transaction inclusion, confirmation,
            finality, recipient credit, or continued support for any wallet, network, address type,
            contract, actor, execution method, or third-party provider.
          </p>
        </LegalSection>

        <LegalSection number={3} title="Non-custodial wallet access">
          <p>
            SendFIL is designed as a non-custodial interface. The hosted interface does not possess
            your private keys or have unilateral authority to initiate transfers from your wallet.
            Some transactions you authorize send FIL to contracts or actors that route, pay, or
            return value automatically according to their code. This does not give the hosted
            interface control over your wallet. We cannot recover wallet access or reverse a
            confirmed transaction.
          </p>
          <p>
            Connecting a wallet may disclose its public address, selected account, network,
            balances, capabilities, and related public blockchain information to the Service and
            relevant wallet or infrastructure providers.{' '}
            <strong>Connecting does not itself move FIL.</strong> An on-chain action occurs only
            after the required wallet signature or approval and network submission.
          </p>
          <p>
            You are solely responsible for securing your devices, wallet, private keys, recovery
            materials, browser extensions, and hardware. SendFIL will never need your private key or
            recovery phrase. Do not provide them through the Service or to anyone claiming to
            provide SendFIL support.
          </p>
        </LegalSection>

        <LegalSection number={4} title="Your transaction instructions">
          <p>
            You supply the instructions for batches you create. A pending multisig proposal may have
            been created by another signer. SendFIL permits approval only after a supported proposal
            has been decoded and validated. A proposer may be able to cancel an incompatible
            proposal after reviewing the proposal information the Service can display. By approving
            or canceling, you authorize that specific actor action. Before signing any action, you
            must independently verify the connected account, funding source, network, recipients,
            address formats, amounts, aggregate SendFIL fee, estimated network fee, execution
            method, error mode, and wallet prompt.
          </p>
          <p>
            Selecting <strong>Create multisig</strong>, <strong>Send</strong>,
            <strong> Propose batch</strong>, <strong>Approve</strong>, or
            <strong> Cancel</strong> asks the connected wallet to prepare an authorization. Signing
            authorizes the on-chain message shown by the wallet. A wallet may summarize or encode
            transaction details differently from the SendFIL review screen, so you must review both.
            If they do not match your intent, reject the wallet request.
          </p>
          <p>
            You are responsible for confirming that every recipient controls the intended address
            and can receive a simple FIL value transfer on the selected network. This is especially
            important for centralized exchanges, custodians, hosted wallets, actors, contracts, and
            first-time recipients. Consider a small test transfer before a material batch.
          </p>
          <p>
            Validation, simulation, balance checks, contract-code checks, warnings, and estimates
            are safety aids, not guarantees. They may be incomplete, stale, unavailable, or affected
            by RPC behavior, network changes, data formatting, address conversion, or software
            defects. You remain responsible for the transaction you sign.
          </p>
        </LegalSection>

        <LegalSection number={5} title="Batch methods and multisig">
          <p>
            Available batch methods have different execution consequences. The Service currently
            uses <strong>Standard</strong> for all-or-nothing Atomic batches. If an internal payment
            fails, the batch is intended to revert, although network fees may still be charged.
          </p>
          <p>
            Where configured, <strong>ThinBatch</strong> may support Atomic or Partial execution. In
            Partial mode, each payment is attempted independently. The contract then attempts to
            return the aggregate failed-payment value to the transaction&apos;s on-chain caller
            within the same transaction. If that return fails, the entire ThinBatch call reverts,
            although Network Fees may still be charged. If the transaction succeeds, successful
            recipient and SendFIL fee payments remain final even when one or more other payments
            fail.
          </p>
          <p>
            Limits shown by the Service apply to the selected method and configuration. For example,
            a fee-enabled ThinBatch may reserve payment rows for SendFIL Fees, reducing the number
            of user-entered recipients available in that batch.
          </p>
          <p>
            A native Filecoin multisig action has separate signer and funding roles. Creating a
            multisig may require the connected signer to fund an initial deposit and network fee.
            Proposing a batch adds the connected signer&apos;s approval and may execute the batch
            immediately if the actor&apos;s threshold is reached, or remain pending for other
            approvals. Approving or canceling a pending proposal is also an on-chain action and may
            incur network fees. Signers are responsible for reviewing the complete proposal and
            coordinating safely with the other multisig participants.
          </p>
          <p>
            Before creating a multisig, verify every signer address, threshold, initial deposit, and
            unlock or vesting duration. An incorrect configuration may lock or delay access to FIL.
            On-chain balance may differ from spendable balance because of vesting, pending
            proposals, or actor state. SendFIL cannot reconfigure or recover a multisig for you
            without the approvals required by that actor.
          </p>
        </LegalSection>

        <LegalSection number={6} title="Fees">
          <p>
            Transactions may require Filecoin network fees, gas fees, wallet or provider fees, and
            other protocol-level costs (<strong>“Network Fees”</strong>). Network Fees are
            determined by blockchain and third-party conditions, not by SendFIL. Estimates may
            differ from the actual fee, and a fee may be charged for a transaction that fails,
            reverts, is delayed, or does not achieve your intended result.
          </p>
          <p>
            SendFIL may include a service or platform fee (<strong>“SendFIL Fee”</strong>) where
            enabled. The review screen will attempt to show the aggregate SendFIL Fee before you
            sign. By signing, you authorize that displayed fee along with the recipient transfers
            and applicable Network Fees. We may change or waive the SendFIL Fee prospectively.
          </p>
          <p>
            Except where required by law or expressly agreed by SendFIL in writing, SendFIL Fees are
            non-refundable after they finalize on-chain. SendFIL cannot refund Network Fees or
            recover amounts transferred to recipients, incorrect addresses, or the wrong network.
          </p>
          <p>
            A SendFIL Fee may consist of more than one payment row. In Partial mode, one or more
            SendFIL Fee payments may succeed even if one or more user-recipient payments fail.
            Failed-payment value is handled as described in Section 5.
          </p>
        </LegalSection>

        <LegalSection number={7} title="Recipient and CSV information">
          <p>
            You are responsible for all recipient addresses, amounts, labels, CSV files, and other
            data you enter or import (<strong>“Recipient Data”</strong>). You represent that you are
            authorized to use Recipient Data for the intended payments and that doing so complies
            with applicable privacy, employment, contractual, sanctions, tax, and other laws.
          </p>
          <p>
            Duplicate rows are separate payment instructions even when they resolve to the same
            destination. An actor address may receive only a simple value transfer; SendFIL does not
            call arbitrary actor methods for a recipient payment. Address normalization or a
            displayed warning does not prove ownership, identity, exchange compatibility, or the
            ability of a recipient to credit the transfer.
          </p>
          <p>
            CSV files are currently parsed in your browser rather than uploaded to a SendFIL
            application server. Do not include unnecessary personal, confidential, regulated, or
            sensitive information in a CSV. Recipient addresses and amounts included in a submitted
            transaction may become permanently public.
          </p>
        </LegalSection>

        <LegalSection number={8} title="Blockchain risks and finality">
          <p>
            Public blockchains and cryptographic systems involve substantial risk. Transactions may
            be irreversible once submitted or confirmed. SendFIL generally cannot cancel, replace,
            accelerate, modify, recover, or reverse a transaction or message after your wallet has
            authorized it.
          </p>
          <p>You accept the risk of loss arising from, among other things:</p>
          <LegalList>
            <li>incorrect, duplicate, incompatible, malicious, or unsupported recipients;</li>
            <li>wrong-network, amount, decimal, formatting, or CSV-entry errors;</li>
            <li>failed, partial, reverted, delayed, dropped, replaced, or stuck transactions;</li>
            <li>insufficient funds, volatile Network Fees, inaccurate estimates, or stale data;</li>
            <li>
              smart-contract, actor, wallet, browser, hardware, RPC, dependency, or interface bugs
              and vulnerabilities;
            </li>
            <li>
              phishing, malicious extensions, compromised devices, exposed keys, fraud, or social
              engineering; and
            </li>
            <li>
              Filecoin or FEVM congestion, outages, forks, reorganizations, consensus failures,
              governance changes, or other protocol events.
            </li>
          </LegalList>
          <p>
            Test networks such as Calibration use test assets and may differ materially from
            Mainnet. Availability on a test network does not prove that a wallet, provider,
            contract, or flow has been fully verified for production use.
          </p>
          <p>
            An RPC provider may report an error or time out after accepting a signed message,
            leaving its submission status uncertain. Do not sign or submit the same payment again,
            clear browser safety records, or retry from another browser or device until you
            independently establish the original message&apos;s outcome. Doing so may cause
            duplicate payments.
          </p>
        </LegalSection>

        <LegalSection number={9} title="Third-party services">
          <p>
            The Service depends on or links to third-party wallets, wallet connectors, browser
            extensions, hardware devices, RPC and Lotus providers, hosting services, block
            explorers, public networks, and open-source libraries (
            <strong>“Third-Party Services”</strong>). It also interacts with public smart contracts
            and actors. SendFIL may develop, deploy, or configure some contracts, but their
            execution remains subject to their code, the public network, and related software and
            protocol risks. Your use of a Third-Party Service may be governed by separate terms and
            privacy notices.
          </p>
          <p>
            SendFIL does not control Third-Party Services and is not responsible for their custody
            practices, signing prompts, security, availability, accuracy, fees, policies, outages,
            acts, or omissions. An integration or link is provided for convenience and does not
            constitute an endorsement, audit, guarantee, or warranty.
          </p>
        </LegalSection>

        <LegalSection number={10} title="Privacy and local data">
          <p>
            SendFIL currently operates without a SendFIL application server or database, but
            delivery and use of the Service necessarily involve network requests. SendFIL and
            providers used to host or connect the Service may receive or process IP addresses,
            browser or device information, public wallet addresses, network state, transaction
            metadata, and related logs. Wallets, WalletConnect services, RPC and Lotus providers,
            block explorers, and public blockchains may process information under their own terms,
            privacy notices, and applicable law.
          </p>
          <p>
            The Service uses browser storage for limited local functionality, which may include the
            current Terms-acceptance version and timestamp, saved multisig labels and addresses, and
            safety records for unresolved native Filecoin submissions. Safety records may include a
            signer or multisig address, network, transaction CID, recipient count, and aggregate
            value. SendFIL does not store private keys or recovery phrases.
          </p>
          <p>
            Public blockchain data can be viewed, copied, indexed, analyzed, and retained by anyone
            and generally cannot be deleted by SendFIL. Do not use the Service if public disclosure
            of the transaction information is unacceptable to you.
          </p>
        </LegalSection>

        <LegalSection number={11} title="Prohibited use and sanctions">
          <p>You may not use or attempt to use the Service to:</p>
          <LegalList>
            <li>
              violate any applicable law, regulation, court order, sanctions, or export control;
            </li>
            <li>
              facilitate fraud, theft, ransomware, money laundering, terrorist financing, sanctions
              evasion, trafficking, illegal gambling, or other unlawful conduct;
            </li>
            <li>
              act for a person, entity, address, or property subject to blocking or transaction
              restrictions where the action would be prohibited;
            </li>
            <li>
              evade any geographic, wallet, security, rate, eligibility, or other access
              restriction;
            </li>
            <li>
              interfere with, overload, probe, exploit, disrupt, or compromise the Service or any
              related system;
            </li>
            <li>
              upload malicious files or code, impersonate another person, misrepresent authority, or
              infringe another person&apos;s rights; or
            </li>
            <li>encourage, assist, or enable anyone else to do any of the foregoing.</li>
          </LegalList>
          <p>
            You represent that you are not a person with whom SendFIL is prohibited from dealing
            under applicable sanctions law and that your use will not cause SendFIL or another
            person to violate such law. The absence of screening, blocking, or a warning in the
            interface does not mean a transaction is lawful.
          </p>
        </LegalSection>

        <LegalSection number={12} title="Taxes and legal compliance">
          <p>
            You are solely responsible for determining and satisfying any tax, reporting,
            withholding, recordkeeping, licensing, registration, consumer-protection, employment,
            payment, financial-services, or other legal obligations that apply to you, your
            recipients, or your transactions.
          </p>
          <p>
            Availability of the Service in a location does not represent that SendFIL has determined
            your use is lawful there. You must not use the Service where your use or the intended
            transaction would be unlawful.
          </p>
        </LegalSection>

        <LegalSection number={13} title="No advice or fiduciary duty">
          <p>
            The Service and its estimates, warnings, validation results, documentation, and other
            information are operational tools and general information only. They are not legal, tax,
            accounting, investment, financial, sanctions, cybersecurity, or other professional
            advice, and they are not a recommendation to acquire, hold, or transfer FIL.
          </p>
          <p>
            SendFIL is not your agent, broker, adviser, trustee, escrow provider, or custodian.
            These Terms do not create a fiduciary or special relationship. You must make your own
            decisions and consult qualified advisers when appropriate.
          </p>
        </LegalSection>

        <LegalSection number={14} title="Intellectual property">
          <p>
            The hosted Service, SendFIL name and marks, visual design, text, graphics, and other
            materials are owned by SendFIL or its licensors and protected by applicable laws.
            Subject to these Terms, SendFIL grants you a limited, revocable, non-exclusive,
            non-transferable right to use the hosted Service for its intended purpose.
          </p>
          <p>
            Portions of SendFIL software are available under the MIT License or Apache License 2.0,
            at your option. Those open-source licenses—not these Terms—govern your use,
            modification, and distribution of the code they cover. Nothing in these Terms limits
            rights granted by an applicable open-source license. Third-party names and marks belong
            to their respective owners.
          </p>
          <p>
            If you voluntarily provide non-confidential feedback, you grant SendFIL a worldwide,
            perpetual, irrevocable, royalty-free right to use and incorporate it without restriction
            or compensation, provided this does not transfer ownership of your pre-existing
            materials.
          </p>
        </LegalSection>

        <LegalSection number={15} title="Changes, availability, and termination">
          <p>
            We may add, modify, suspend, restrict, or discontinue any part of the Service, including
            supported wallets, networks, contracts, fees, limits, or transaction methods. We may
            restrict access when reasonably necessary for security, legal compliance, maintenance,
            third-party availability, or protection of users and the Service.
          </p>
          <p>
            We may revise these Terms prospectively. We will post the revised Terms, update the
            effective date, and provide any notice required by law. If a revision materially affects
            your rights or obligations, we will require affirmative acceptance before another wallet
            connection or on-chain action. Changes do not apply retroactively unless required by law
            or expressly agreed. If you do not agree to revised Terms, stop using the Service. You
            may retain read-only access to available recovery and transaction-status information.
          </p>
          <p>
            Suspension or termination of the hosted Service does not affect public blockchain
            transactions already submitted or contracts and actors that continue to operate
            independently.
          </p>
        </LegalSection>

        <LegalSection number={16} title="Disclaimers">
          <p className="font-semibold text-slate-900">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED “AS IS” AND “AS
            AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING
            WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE,
            NON-INFRINGEMENT, ACCURACY, SECURITY, AVAILABILITY, OR ERROR-FREE OPERATION.
          </p>
          <p>
            SendFIL does not warrant that the Service, any validation, estimate, warning,
            simulation, status, address conversion, wallet, RPC response, contract, actor, or
            transaction will be accurate, current, secure, available, accepted, confirmed,
            finalized, credited, refunded, or suitable for your purpose. No audit, test, simulation,
            or security measure eliminates blockchain or software risk.
          </p>
          <p>
            Some jurisdictions do not allow certain warranty exclusions. In those jurisdictions,
            these exclusions apply only to the maximum extent permitted, and non-waivable rights
            remain unaffected.
          </p>
        </LegalSection>

        <LegalSection number={17} title="Limitation of liability">
          <p className="font-semibold text-slate-900">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, SENDFIL AND ITS MEMBERS, MANAGERS, OFFICERS,
            EMPLOYEES, CONTRACTORS, AFFILIATES, LICENSORS, AND SERVICE PROVIDERS WILL NOT BE LIABLE
            FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR
            LOST PROFITS, REVENUE, BUSINESS, DATA, GOODWILL, DIGITAL ASSETS, OR OPPORTUNITY, ARISING
            FROM OR RELATED TO THE SERVICE OR THESE TERMS, EVEN IF ADVISED THAT SUCH LOSS WAS
            POSSIBLE.
          </p>
          <p>
            To the maximum extent permitted by law, SendFIL&apos;s aggregate liability for all
            claims arising from or relating to the Service or these Terms will not exceed the
            greater of (a) the SendFIL Fees you paid in the twelve months before the event giving
            rise to the claim, excluding Network Fees and recipient transfers, or (b) US$100.
          </p>
          <p>
            These limitations do not apply to fraud, fraudulent misrepresentation, willful
            misconduct, gross negligence where it cannot be limited, or any other liability that
            cannot lawfully be limited or excluded. Each limitation applies independently and is an
            essential basis of the agreement between you and SendFIL.
          </p>
        </LegalSection>

        <LegalSection number={18} title="Indemnification">
          <p>
            To the maximum extent permitted by law, you will defend, indemnify, and hold harmless
            SendFIL and its members, managers, officers, employees, contractors, affiliates,
            licensors, and service providers from third-party claims, damages, penalties,
            liabilities, and reasonable legal costs arising from your unlawful use of the Service,
            your breach of these Terms, your unlawful or unauthorized Recipient Data or transaction
            instructions, or your infringement of another person&apos;s rights.
          </p>
          <p>
            SendFIL will provide reasonable notice of an indemnified claim and may control its
            defense. You may not settle a claim in a way that admits fault by, imposes obligations
            on, or fails to release SendFIL without our written consent. This section does not
            require indemnification to the extent a claim was caused by SendFIL&apos;s conduct or
            indemnification is prohibited by applicable law.
          </p>
        </LegalSection>

        <LegalSection number={19} title="General terms">
          <p>
            These Terms are the entire agreement between you and SendFIL regarding the hosted
            Service, except for any additional terms expressly incorporated by reference. They do
            not alter the operation of a public blockchain or the terms of a Third-Party Service.
          </p>
          <p>
            If a provision is invalid or unenforceable, it will be enforced to the maximum extent
            permitted and the remaining provisions will continue in effect. A failure to enforce a
            provision is not a waiver. You may not assign these Terms without our consent; SendFIL
            may assign them in connection with a reorganization, merger, acquisition, or transfer of
            the Service. Headings are for convenience only, and “including” means “including without
            limitation.”
          </p>
          <p>
            To the extent permitted by law, you consent to receiving notices about the Service
            electronically through the Service or another contact method you provide. This does not
            waive any disclosure, consent, retention, paper-copy, remedy, or other right that cannot
            lawfully be waived.
          </p>
          <p>
            Provisions that by their nature should continue after access to the hosted Service ends,
            including provisions concerning completed or pending transactions, fees, taxes,
            intellectual property, disclaimers, liability, indemnification, and these general terms,
            will survive.
          </p>
        </LegalSection>

        <LegalSection number={20} title="Contact">
          <p>
            Questions about these Terms may be directed to SendFIL, LLC through the contact method
            published on the Service. Do not send private keys, recovery phrases, confidential CSV
            files, or other wallet credentials in any support or legal communication.
          </p>
        </LegalSection>
      </div>
    </article>
  );
}
