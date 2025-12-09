import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChainId } from 'wagmi';

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
  gasEstimationError?: string;

  // Wallet state
  walletBalance: number; // in FIL
  insufficientBalance: boolean;

  // Transaction state
  transactionState: TransactionState;
  transactionHash?: string;
  transactionError?: string;
}

// Format FIL amounts for display
function formatFil(amount: number): string {
  if (amount === 0) return '0 FIL';
  if (amount < 0.000001) return '< 0.000001 FIL';
  if (amount < 0.001) return amount.toFixed(6) + ' FIL';
  if (amount < 1) return amount.toFixed(4) + ' FIL';
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' FIL';
}

// Truncate addresses for display
function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

// Convert attoFIL string to nanoFIL for display
function attoFilToNanoFil(attoFil: string): number {
  return Number(BigInt(attoFil)) / 1e9;
}

export const ReviewTransactionModal: React.FC<ReviewTransactionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  recipients,
  validationErrors,
  validationWarnings,
  recipientTotal,
  feeTotal,
  gasEstimate,
  isEstimatingGas,
  gasEstimationError,
  walletBalance,
  insufficientBalance,
  transactionState,
  transactionHash,
  transactionError,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [showGasDetails, setShowGasDetails] = useState(false);
  const [showFeeTooltip, setShowFeeTooltip] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const chainId = useChainId();

  // Determine if we're on testnet
  const isTestnet = chainId === 314159; // Calibration testnet

  // Get Filfox URL based on network
  const getFilfoxUrl = useCallback(
    (hash: string) => {
      const baseUrl = isTestnet
        ? 'https://calibration.filfox.info/en/message/'
        : 'https://filfox.info/en/message/';
      return `${baseUrl}${hash}`;
    },
    [isTestnet],
  );

  // Calculate totals
  const estimatedNetworkFee = gasEstimate?.estimatedFeeInFil || 0;
  const grandTotal = recipientTotal + feeTotal + estimatedNetworkFee;

  // Send button should be disabled when:
  const isSendDisabled =
    validationErrors.length > 0 ||
    insufficientBalance ||
    isEstimatingGas ||
    transactionState !== 'review';

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && transactionState === 'review') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, transactionState, onClose]);

  // Focus trap
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Render different states
  const renderReviewState = () => (
    <>
      {/* Errors Section - Always prominent when present */}
      {validationErrors.length > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
          <h4 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
            <span>⚠</span>
            {validationErrors.length} {validationErrors.length === 1 ? 'row has' : 'rows have'}{' '}
            errors
          </h4>
          <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
            {validationErrors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings Section */}
      {validationWarnings.length > 0 && validationErrors.length === 0 && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <h4 className="font-semibold text-yellow-800 mb-2">Warnings:</h4>
          <ul className="text-sm text-yellow-700 space-y-1">
            {validationWarnings.map((warning, index) => (
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
            Your wallet balance ({formatFil(walletBalance)}) is less than the required amount (
            {formatFil(grandTotal)}).
          </p>
        </div>
      )}

      {/* Summary Section */}
      <div className="space-y-3 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Total to send:</span>
          <span className="font-semibold text-lg">{formatFil(recipientTotal)}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-600">Platform fee (1%):</span>
          <span className="font-medium">{formatFil(feeTotal)}</span>
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
                  Network fee is estimated and may vary slightly.
                  <br />
                  Actual fee is typically lower than this estimate.
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                </div>
              )}
            </span>
          </span>
          <span className="font-medium">
            {isEstimatingGas ? (
              <span className="text-gray-400">Estimating...</span>
            ) : gasEstimationError ? (
              <span className="text-yellow-600">~ {formatFil(0.01)}</span>
            ) : (
              formatFil(estimatedNetworkFee)
            )}
          </span>
        </div>

        <div className="border-t border-gray-200 pt-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Grand Total:</span>
            <span className="font-bold text-xl">{formatFil(grandTotal)}</span>
          </div>
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
                {recipients.length - validationErrors.length} of {recipients.length} recipients
                valid
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
                <span className="font-mono text-gray-600">
                  #{index + 1}: {truncateAddress(recipient.address)}
                </span>
                <span className="font-medium">{formatFil(recipient.amount)}</span>
              </div>
            ))}
          </div>
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
      <p className="text-gray-600 text-center">Please confirm the transaction in your wallet...</p>
    </div>
  );

  const renderPendingState = () => (
    <div className="flex flex-col items-center py-8">
      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mb-4" />
      <h3 className="text-lg font-semibold mb-2">Transaction Pending</h3>
      <p className="text-gray-600 text-center mb-4">Your batch is being processed...</p>
      {transactionHash && (
        <a
          href={getFilfoxUrl(transactionHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
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
      <h3 className="text-lg font-semibold text-green-800 mb-2">Transaction Confirmed</h3>
      <p className="text-gray-600 text-center mb-4">
        Successfully sent {formatFil(recipientTotal)} to {recipients.length} recipients
      </p>
      {transactionHash && (
        <a
          href={getFilfoxUrl(transactionHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-4"
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
      <h3 className="text-lg font-semibold text-red-800 mb-2">Transaction Failed</h3>
      <p className="text-gray-600 text-center mb-4">
        {transactionError || 'An error occurred while processing your transaction.'}
      </p>
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
              className={`px-6 py-2 rounded-md transition-colors ${
                isSendDisabled
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              Send
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
            <button
              type="button"
              onClick={onConfirm}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
            >
              Try Again
            </button>
          </>
        );
      default:
        return null;
    }
  };

  const getModalTitle = () => {
    switch (transactionState) {
      case 'review':
        return 'Review Transaction';
      case 'signing':
        return 'Sign Transaction';
      case 'pending':
        return 'Processing';
      case 'confirmed':
        return 'Success';
      case 'failed':
        return 'Error';
      default:
        return 'Review Transaction';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 id="modal-title" className="text-xl font-semibold">
            {getModalTitle()}
          </h2>
          {transactionState === 'review' && (
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              aria-label="Close modal"
            >
              ×
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{renderContent()}</div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
          {renderButtons()}
        </div>
      </div>
    </div>
  );
};

export default ReviewTransactionModal;
