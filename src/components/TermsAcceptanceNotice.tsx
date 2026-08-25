import TermsOfServiceLink from './TermsOfServiceLink';
import { TERMS_LAST_UPDATED } from '../legal/termsAcceptance';

interface TermsAcceptanceNoticeProps {
  onAccept: () => void;
  onOpenTerms: () => void;
}

export default function TermsAcceptanceNotice({
  onAccept,
  onOpenTerms,
}: TermsAcceptanceNoticeProps) {
  return (
    <div
      className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-950"
      data-testid="terms-acceptance-notice"
    >
      <p className="font-semibold">Accept the Terms to continue</p>
      <p className="mt-1 leading-5 text-blue-900">
        Your wallet is connected. Review the{' '}
        <TermsOfServiceLink
          onOpen={onOpenTerms}
          className="font-semibold underline underline-offset-2"
        />{' '}
        effective {TERMS_LAST_UPDATED} before reviewing or submitting a batch.
      </p>
      <button
        type="button"
        onClick={onAccept}
        data-testid="accept-terms-button"
        className="mt-3 w-full rounded-full bg-[#1f69ff] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1857d4]"
      >
        I agree to the Terms of Service
      </button>
      <p className="mt-2 text-xs leading-5 text-blue-800">
        Connecting shares public wallet and network information. It does not authorize a FIL
        transfer; a separate wallet approval is required.
      </p>
    </div>
  );
}
