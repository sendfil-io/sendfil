import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDuplicateRecipientWarnings,
  isDuplicateRecipientWarning,
} from '../utils/recipientValidation';
import {
  getErrorHandlingLabel,
  getExecutionMethodLabel,
  getSenderWalletTypeLabel,
  type BatchConfiguration,
} from '../lib/batchConfiguration';
import { ERROR_MODE_COPY, type BatchExecutionError } from '../lib/transaction/errorHandling';
import { isCanonicalFilecoinMessageCid } from '../lib/DataProvider/filecoinMessageCid';
import { getFilfoxMessageUrl } from '../lib/networks';

export type TransactionState = 'review' | 'signing' | 'pending' | 'confirmed' | 'failed';

export interface GasEstimate {
  gasLimit: number;
  gasFeeCap: string; // in attoFIL
  gasPremium: string; // in attoFIL
  estimatedFeeInFil: number;
}

export interface ReviewTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onRecheckTransaction?: () => Promise<void>;

  // Recipient data
  recipients: Array<{ address: string; amount: number }>;
  validationErrors: string[];
  validationWarnings: string[];

  // Fee data
  recipientTotal: number; // Sum of recipient amounts in FIL
  feeTotal: number; // Platform fee (1%) in FIL

  // Gas estimation
  gasEstimate?: GasEstimate;
  isEstimatingGas: boolean;
  isCheckingContractRecipients?: boolean;
  gasEstimationError?: BatchExecutionError;

  // Wallet state
  walletBalance: number; // in FIL
  insufficientBalance: boolean;
  fundingMode?: 'single-signer' | 'native-multisig';
  fundingSourceLabel?: string;
  fundingSourceAddress?: string;
  connectedSignerAddress?: string;
  multisigThreshold?: number;
  multisigSignerCount?: number;
  multisigProposalOutcome?: {
    kind: 'queued' | 'applied-success';
    transactionId: number;
  };
  signerGasBalance?: number;
  submissionSummary?: {
    recipientCount: number;
    totalValueAttoFil: string;
  };

  // Transaction state
  transactionState: TransactionState;
  transactionHash?: string;
  transactionError?: BatchExecutionError;
  batchConfiguration: BatchConfiguration;
  chainId?: number;
  networkLabel: string;
  feeLabel: string;
}

const ATTOFIL_PER_FIL = 10n ** 18n;

function filNumberToAttoFil(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('FIL amount must be a nonnegative finite number.');
  }

  const match = amount.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);

  if (!match) {
    throw new Error('FIL amount could not be represented for review.');
  }

  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0') - fraction.length;
  const digits = BigInt(`${match[1]}${fraction}`);
  const ratio =
    exponent >= 0
      ? { numerator: digits * 10n ** BigInt(exponent), denominator: 1n }
      : { numerator: digits, denominator: 10n ** BigInt(-exponent) };

  return (ratio.numerator * ATTOFIL_PER_FIL) / ratio.denominator;
}

// Format the decimal number representation used by the current transaction pipeline
// without summary rounding or binary floating-point addition artifacts.
function formatFil(amount: number): string {
  return formatExactAttoFil(filNumberToAttoFil(amount).toString());
}

function formatExactAttoFil(attoFil: string): string {
  const value = BigInt(attoFil);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n)
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '');

  return `${whole.toString()}${fraction ? `.${fraction}` : ''} FIL`;
}

// Convert attoFIL string to nanoFIL for display
function attoFilToNanoFil(attoFil: string): number {
  return Number(BigInt(attoFil)) / 1e9;
}

function TechnicalErrorDetails({
  details,
  testId,
}: {
  details?: string;
  testId: string;
}) {
  if (!details?.trim()) {
    return null;
  }

  return (
    <details
      className="mt-3 w-full rounded-lg border border-current/15 bg-white/60 px-3 py-2 text-left"
      data-testid={testId}
    >
      <summary className="cursor-pointer text-xs font-semibold">
        Technical details
      </summary>
      <code className="mt-2 block whitespace-pre-wrap break-all text-xs leading-5 opacity-80">
        {details}
      </code>
    </details>
  );
}

export const ReviewTransactionModal: React.FC<ReviewTransactionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onRecheckTransaction,
  recipients,
  validationErrors,
  validationWarnings,
  feeTotal,
  gasEstimate,
  isEstimatingGas,
  isCheckingContractRecipients = false,
  gasEstimationError,
  walletBalance,
  insufficientBalance,
  fundingMode = 'single-signer',
  fundingSourceLabel = 'wallet',
  fundingSourceAddress,
  connectedSignerAddress,
  multisigThreshold,
  multisigSignerCount,
  multisigProposalOutcome,
  signerGasBalance,
  submissionSummary,
  transactionState,
  transactionHash,
  transactionError,
  batchConfiguration,
  chainId,
  networkLabel,
  feeLabel,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [showGasDetails, setShowGasDetails] = useState(false);
  const [showFeeTooltip, setShowFeeTooltip] = useState(false);
  const [hasAcknowledgedDuplicateRecipients, setHasAcknowledgedDuplicateRecipients] =
    useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const getFilfoxUrl = useCallback((hash: string) => getFilfoxMessageUrl(hash, chainId), [chainId]);

  // Calculate totals
  const estimatedNetworkFee = gasEstimate?.estimatedFeeInFil || 0;
  const recipientTotalAttoFil = recipients.reduce(
    (total, recipient) => total + filNumberToAttoFil(recipient.amount),
    0n,
  );
  const feeTotalAttoFil = filNumberToAttoFil(feeTotal);
  const estimatedNetworkFeeAttoFil = filNumberToAttoFil(estimatedNetworkFee);
  const fundingRequiredTotalAttoFil =
    fundingMode === 'native-multisig'
      ? recipientTotalAttoFil + feeTotalAttoFil
      : recipientTotalAttoFil + feeTotalAttoFil + estimatedNetworkFeeAttoFil;
  const grandTotalAttoFil =
    recipientTotalAttoFil + feeTotalAttoFil + estimatedNetworkFeeAttoFil;
  const duplicateRecipientWarnings = getDuplicateRecipientWarnings(validationWarnings);
  const otherValidationWarnings = validationWarnings.filter(
    (warning) => !isDuplicateRecipientWarning(warning),
  );
  const duplicateWarningsSignature = duplicateRecipientWarnings.join('|');
  const requiresDuplicateConfirmation = duplicateRecipientWarnings.length > 0;
  const isAtomicMode = batchConfiguration.errorHandling === 'ATOMIC';
  const isPartialMode = batchConfiguration.errorHandling === 'PARTIAL';
  const errorModeCopy = ERROR_MODE_COPY[batchConfiguration.errorHandling];
  const hasBlockingAtomicPreflightError = isAtomicMode && Boolean(gasEstimationError);

  // Send button should be disabled when:
  const isSendDisabled =
    validationErrors.length > 0 ||
    (requiresDuplicateConfirmation && !hasAcknowledgedDuplicateRecipients) ||
    insufficientBalance ||
    hasBlockingAtomicPreflightError ||
    isCheckingContractRecipients ||
    isEstimatingGas ||
    transactionState !== 'review';

  // Keep focus and page scroll inside the modal for its full open lifecycle.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previouslyFocusedElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;

      if (previouslyFocusedElement.current?.isConnected) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [isOpen]);

  // Handle Escape and cycle Tab focus without allowing it behind the dialog.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && transactionState === 'review') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || activeElement === modalRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, transactionState]);

  useEffect(() => {
    setHasAcknowledgedDuplicateRecipients(false);
  }, [duplicateWarningsSignature, isOpen]);

  if (!isOpen) return null;

  // Render different states
  const renderReviewState = () => (
    <>
      {/* Errors Section - Always prominent when present */}
      {validationErrors.length > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4" role="alert">
          <h4 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
            <span>⚠</span>
            {validationErrors.length} blocking {validationErrors.length === 1 ? 'issue' : 'issues'}
          </h4>
          <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
            {validationErrors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings Section */}
      {duplicateRecipientWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-md p-4">
          <h4 className="font-semibold text-amber-900 mb-2">
            Duplicate recipients need confirmation
          </h4>
          <p className="text-sm text-amber-800 mb-3">
            This batch includes duplicate recipients. SendFIL will treat each duplicate entry as a
            separate transfer.
          </p>
          <ul className="text-sm text-amber-800 space-y-1">
            {duplicateRecipientWarnings.map((warning, index) => (
              <li key={index}>• {warning}</li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-3 text-sm text-amber-900">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-amber-300 text-blue-600 focus:ring-blue-500"
              checked={hasAcknowledgedDuplicateRecipients}
              onChange={(event) => setHasAcknowledgedDuplicateRecipients(event.target.checked)}
              aria-label="Acknowledge duplicate recipients"
              data-testid="duplicate-acknowledgment"
            />
            <span>
              I understand the duplicate recipients above will each receive a separate transfer.
              <span className="block text-xs text-amber-700 mt-1">
                Required before you can send this batch.
              </span>
            </span>
          </label>
        </div>
      )}

      {otherValidationWarnings.length > 0 && validationErrors.length === 0 && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <h4 className="font-semibold text-yellow-800 mb-2">Warnings:</h4>
          <ul className="text-sm text-yellow-700 space-y-1">
            {otherValidationWarnings.map((warning, index) => (
              <li key={index}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Insufficient Balance Warning */}
      {insufficientBalance && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
          <h4 className="font-semibold text-red-800 flex items-center gap-2">
            <span>⚠</span>
            Insufficient Balance
          </h4>
          <p className="text-sm text-red-700 mt-1">
            {fundingMode === 'native-multisig'
              ? `${fundingSourceLabel} spendable balance (${formatFil(
                  walletBalance,
                )}) must cover ${formatExactAttoFil(
                  fundingRequiredTotalAttoFil.toString(),
                )}, and the connected signer must cover the estimated gas${
                  signerGasBalance !== undefined
                    ? ` (${formatFil(signerGasBalance)} available)`
                    : ''
                }.`
              : `Your wallet balance (${formatFil(
                  walletBalance,
                )}) is less than the required amount (${formatExactAttoFil(
                  grandTotalAttoFil.toString(),
                )}).`}
          </p>
        </div>
      )}

      {isCheckingContractRecipients && (
        <div
          className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4"
          data-testid="contract-recipient-checking"
        >
          <h4 className="font-semibold text-blue-900">Checking 0x and f4 recipients</h4>
          <p className="mt-1 text-sm text-blue-800">
            SendFIL is checking that those recipients are wallet addresses, not contracts.
          </p>
        </div>
      )}

      {gasEstimationError && (
        <div
          className={`mb-4 rounded-md border p-4 ${
            hasBlockingAtomicPreflightError
              ? 'border-red-200 bg-red-50'
              : 'border-amber-200 bg-amber-50'
          }`}
          data-testid={
            hasBlockingAtomicPreflightError ? 'atomic-preflight-error' : 'gas-estimation-error'
          }
        >
          <h4
            className={`font-semibold ${
              hasBlockingAtomicPreflightError ? 'text-red-800' : 'text-amber-900'
            }`}
          >
            {gasEstimationError.title}
          </h4>
          <p
            className={`mt-1 text-sm ${
              hasBlockingAtomicPreflightError ? 'text-red-700' : 'text-amber-800'
            }`}
          >
            {gasEstimationError.message}
          </p>
          {gasEstimationError.hint && (
            <p
              className={`mt-2 text-sm ${
                hasBlockingAtomicPreflightError ? 'text-red-700' : 'text-amber-800'
              }`}
            >
              {gasEstimationError.hint}
            </p>
          )}
          <TechnicalErrorDetails
            details={gasEstimationError.details}
            testId="gas-estimation-technical-details"
          />
        </div>
      )}

      {/* Summary Section */}
      <div className="space-y-3 mb-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Batch configuration
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Sender type
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {getSenderWalletTypeLabel(batchConfiguration.senderWalletType)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Method
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {getExecutionMethodLabel(batchConfiguration.executionMethod)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Error handling
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {getErrorHandlingLabel(batchConfiguration.errorHandling)}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500" data-testid="error-mode-summary">
                {errorModeCopy.reviewSummary}
              </p>
            </div>
          </div>
          {fundingMode === 'native-multisig' && (
            <div
              className="mt-4 border-t border-slate-200 pt-4"
              data-testid="multisig-review-identity"
            >
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Funding multisig
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{fundingSourceLabel}</p>
              <code className="mt-1 block break-all text-xs text-slate-600">
                {fundingSourceAddress ?? fundingSourceLabel}
              </code>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                    Connected signer
                  </p>
                  <code className="mt-1 block break-all text-xs text-slate-700">
                    {connectedSignerAddress ?? 'Unavailable'}
                  </code>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                    Approval threshold
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {multisigThreshold !== undefined && multisigSignerCount !== undefined
                      ? `${multisigThreshold} of ${multisigSignerCount} signers`
                      : 'Unavailable'}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Proposing adds the connected signer&apos;s approval. The batch executes only when
                the actor&apos;s approval threshold is reached.
              </p>
            </div>
          )}
        </div>

        {isPartialMode && (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            data-testid="partial-fee-disclosure"
          >
            <p className="font-semibold">Partial execution affects payments independently</p>
            <p className="mt-1 leading-6">
              ThinBatch attempts each payment, then returns aggregate failed-payment value to the
              on-chain caller within the same transaction. If that return fails, the whole call
              reverts, although network fees may still be charged. If the transaction succeeds,
              successful payments{feeTotal > 0 ? '—including SendFIL fee payments—' : ' '}remain
              final even when another payment fails.
            </p>
          </div>
        )}

        <div className="flex justify-between items-center">
          <span className="text-gray-600">Total to send:</span>
          <span className="font-semibold text-lg">
            {formatExactAttoFil(recipientTotalAttoFil.toString())}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-600">{feeLabel}:</span>
          <span className="font-medium">{formatExactAttoFil(feeTotalAttoFil.toString())}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-600 flex items-center gap-1">
            Estimated network fee
            <span className="relative">
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600"
                onMouseEnter={() => setShowFeeTooltip(true)}
                onMouseLeave={() => setShowFeeTooltip(false)}
                onClick={() => setShowFeeTooltip(!showFeeTooltip)}
                aria-label="Fee information"
              >
                [?]
              </button>
              {showFeeTooltip && (
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-md whitespace-nowrap z-10">
                  Network fee is estimated and may be higher or lower when submitted.
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                </div>
              )}
            </span>
          </span>
          <span className="font-medium">
            {isEstimatingGas ? (
              <span className="text-gray-400">Estimating...</span>
            ) : gasEstimationError ? (
              <span className="text-yellow-600">Unavailable</span>
            ) : (
              formatFil(estimatedNetworkFee)
            )}
          </span>
        </div>

        <div className="border-t border-gray-200 pt-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold">
              {fundingMode === 'native-multisig'
                ? 'Multisig required:'
                : gasEstimationError
                  ? 'Transfer value (network fee unavailable):'
                  : 'Grand Total:'}
            </span>
            <span className="font-bold text-xl">
              {formatExactAttoFil(fundingRequiredTotalAttoFil.toString())}
            </span>
          </div>
          {fundingMode === 'native-multisig' && (
            <div className="mt-2 flex justify-between text-sm text-gray-600">
              <span>Signer gas required:</span>
              <span>{gasEstimationError ? 'Unavailable' : formatFil(estimatedNetworkFee)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Gas Details Expandable */}
      {gasEstimate && !isEstimatingGas && (
        <div className="mb-4">
          <button
            type="button"
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            onClick={() => setShowGasDetails(!showGasDetails)}
          >
            {showGasDetails ? 'Hide' : 'View'} gas details {showGasDetails ? '▲' : '▼'}
          </button>
          {showGasDetails && (
            <div className="mt-2 bg-gray-50 rounded-md p-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-600">
                <span>Estimated gas:</span>
                <span>{gasEstimate.gasLimit.toLocaleString()} units</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Gas fee cap:</span>
                <span>~{attoFilToNanoFil(gasEstimate.gasFeeCap).toFixed(2)} nanoFIL/unit</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Gas premium:</span>
                <span>~{attoFilToNanoFil(gasEstimate.gasPremium).toFixed(2)} nanoFIL/unit</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recipients Section */}
      <div className="border-t border-gray-200 pt-4">
        <button
          type="button"
          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 w-full justify-between"
          onClick={() => setShowDetails(!showDetails)}
        >
          <span className="flex items-center gap-2">
            {validationErrors.length > 0 ? (
              <span className="text-yellow-600">
                {recipients.length} recipients currently valid
              </span>
            ) : (
              <span className="text-green-600">✓ {recipients.length} recipients validated</span>
            )}
          </span>
          <span>{showDetails ? 'Hide ▲' : 'View details ▼'}</span>
        </button>

        {showDetails && (
          <div className="mt-3 max-h-60 overflow-y-auto border border-gray-200 rounded-md">
            {recipients.map((recipient, index) => (
              <div
                key={index}
                className={`flex justify-between items-center px-3 py-2 text-sm ${
                  index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                }`}
              >
                <span className="min-w-0 break-all font-mono text-gray-600">
                  #{index + 1}: {recipient.address}
                </span>
                <span className="font-medium">{formatFil(recipient.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
        {fundingMode === 'native-multisig' ? (
          <p>
            By selecting <strong>Propose batch</strong> and approving the wallet request, you
            authorize this proposal and the connected signer&apos;s approval. The underlying batch
            may execute immediately if the multisig threshold is reached.
          </p>
        ) : (
          <p>
            By selecting <strong>Send</strong> and approving the wallet request, you instruct your
            wallet to submit the transaction shown in this review. Expand <strong>View details</strong>{' '}
            and verify each full recipient address and amount first. Blockchain transfers may be
            irreversible.
          </p>
        )}
      </div>
    </>
  );

  const renderSigningState = () => (
    <div className="flex flex-col items-center py-8">
      <div className="animate-pulse mb-4">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
          <span className="text-3xl">✍️</span>
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">Awaiting Signature</h3>
      <p className="text-gray-600 text-center">
        Please confirm the {fundingMode === 'native-multisig' ? 'proposal' : 'transaction'} in your
        wallet...
      </p>
    </div>
  );

  const renderStoredSubmissionDetails = () =>
    submissionSummary ? (
      <div
        className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-700"
        data-testid="stored-submission-details"
      >
        <p className="font-semibold text-slate-900">
          {getExecutionMethodLabel(batchConfiguration.executionMethod)} ·{' '}
          {getErrorHandlingLabel(batchConfiguration.errorHandling)}
        </p>
        <p className="mt-1">
          {submissionSummary.recipientCount}{' '}
          {submissionSummary.recipientCount === 1 ? 'payment' : 'payments'} ·{' '}
          {formatExactAttoFil(submissionSummary.totalValueAttoFil)} total
        </p>
      </div>
    ) : null;

  const renderPendingState = () => (
    <div className="flex flex-col items-center py-8">
      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mb-4" />
      <h3 className="text-lg font-semibold mb-2">
        {fundingMode === 'native-multisig' ? 'Proposal Pending' : 'Transaction Pending'}
      </h3>
      <p className="text-gray-600 text-center mb-4">
        {fundingMode === 'native-multisig'
          ? 'Your multisig proposal is being processed...'
          : 'Your batch is being processed...'}
      </p>
      {renderStoredSubmissionDetails()}
      {transactionHash && (
        <a
          href={getFilfoxUrl(transactionHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          View on Filfox ↗
        </a>
      )}
    </div>
  );

  const renderConfirmedState = () => (
    <div className="flex flex-col items-center py-8">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
        <span className="text-3xl">✅</span>
      </div>
      <h3 className="text-lg font-semibold text-green-800 mb-2">
        {fundingMode === 'native-multisig' ? 'Proposal Confirmed' : 'Transaction Confirmed'}
      </h3>
      <p className="text-gray-600 text-center mb-4">
        {fundingMode === 'native-multisig'
          ? multisigProposalOutcome?.kind === 'queued'
            ? `Proposal #${multisigProposalOutcome.transactionId} is confirmed and awaiting additional approvals.`
            : multisigProposalOutcome?.kind === 'applied-success'
              ? `Proposal #${multisigProposalOutcome.transactionId} reached threshold and its batch call completed on-chain.`
              : 'The multisig proposal message was confirmed. Check its approval state before taking another action.'
          : isAtomicMode
            ? submissionSummary
              ? `The stored atomic batch for ${submissionSummary.recipientCount} recipients was confirmed on-chain.`
              : `Successfully finalized ${formatExactAttoFil(
                  recipientTotalAttoFil.toString(),
                )} to ${recipients.length} recipients in one atomic batch.`
            : submissionSummary
              ? `The stored Partial batch for ${submissionSummary.recipientCount} recipients was confirmed on-chain. Inspect its per-payment results before assuming every recipient was paid.`
              : 'The ThinBatch transaction was confirmed on-chain. Inspect its per-payment results and events before assuming every recipient was paid.'}
      </p>
      {renderStoredSubmissionDetails()}
      {transactionHash && (
        <a
          href={getFilfoxUrl(transactionHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          View on Filfox ↗
        </a>
      )}
    </div>
  );

  const renderFailedState = () => (
    <div className="flex flex-col items-center py-8">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <span className="text-3xl">❌</span>
      </div>
      <h3 className="text-lg font-semibold text-red-800 mb-2">
        {transactionError?.title ??
          (fundingMode === 'native-multisig' ? 'Proposal Failed' : 'Transaction Failed')}
      </h3>
      <p className="text-gray-600 text-center mb-4">
        {transactionError?.message || 'An error occurred while processing your transaction.'}
      </p>
      <p className="text-sm text-gray-500 text-center mb-2">
        {fundingMode === 'native-multisig'
          ? transactionHash
            ? 'Do not assume the batch executed successfully. Inspect the proposal message CID before taking another action.'
            : 'No multisig proposal was submitted, so the batch did not execute.'
          : isCanonicalFilecoinMessageCid(transactionHash) &&
              transactionError?.recoverable === false
            ? 'The original transaction may still execute. Do not submit another transaction while its status is unresolved.'
            : errorModeCopy.failureSummary}
      </p>
      {renderStoredSubmissionDetails()}
      {transactionError?.hint && (
        <p className="text-sm text-gray-500 text-center">{transactionError.hint}</p>
      )}
      <TechnicalErrorDetails
        details={transactionError?.details}
        testId="transaction-error-technical-details"
      />
      {transactionHash && (
        <a
          href={getFilfoxUrl(transactionHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Inspect on Filfox ↗
        </a>
      )}
    </div>
  );

  const renderContent = () => {
    switch (transactionState) {
      case 'review':
        return renderReviewState();
      case 'signing':
        return renderSigningState();
      case 'pending':
        return renderPendingState();
      case 'confirmed':
        return renderConfirmedState();
      case 'failed':
        return renderFailedState();
      default:
        return renderReviewState();
    }
  };

  const renderButtons = () => {
    switch (transactionState) {
      case 'review':
        return (
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSendDisabled}
              data-testid="send-batch-button"
              className={`px-6 py-2 rounded-md transition-colors ${
                isSendDisabled
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {fundingMode === 'native-multisig' ? 'Propose batch' : 'Send'}
            </button>
          </>
        );
      case 'signing':
        return (
          <button
            type="button"
            disabled
            className="px-6 py-2 bg-gray-300 text-gray-500 rounded-md cursor-not-allowed"
          >
            Signing...
          </button>
        );
      case 'pending':
        return (
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            Close
          </button>
        );
      case 'confirmed':
        return (
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors"
          >
            Done
          </button>
        );
      case 'failed':
        return (
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Close
            </button>
            {transactionError?.recoverable !== false && (
              <button
                type="button"
                onClick={onConfirm}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
              >
                Try Again
              </button>
            )}
            {transactionError?.recoverable === false &&
              transactionHash &&
              onRecheckTransaction && (
                <button
                  type="button"
                  onClick={() => void onRecheckTransaction()}
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                >
                  Check status again
                </button>
              )}
          </>
        );
      default:
        return null;
    }
  };

  const getModalTitle = () => {
    switch (transactionState) {
      case 'review':
        return 'Review Batch';
      case 'signing':
        return 'Sign Transaction';
      case 'pending':
        return 'Processing';
      case 'confirmed':
        return 'Success';
      case 'failed':
        return 'Error';
      default:
        return 'Review Batch';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-[28px] bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="modal-title" className="text-xl font-semibold">
            {getModalTitle()}
          </h2>
          {transactionState === 'review' && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-2xl leading-none text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
              aria-label="Close modal"
            >
              ×
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Network
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{networkLabel}</p>
          </div>
          <div
            role={transactionState === 'review' ? undefined : 'status'}
            aria-live={transactionState === 'review' ? undefined : 'polite'}
            aria-atomic={transactionState === 'review' ? undefined : true}
          >
            {renderContent()}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {renderButtons()}
        </div>
      </div>
    </div>
  );
};

export default ReviewTransactionModal;
