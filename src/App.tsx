import * as React from 'react';
import './App.css';
import { CustomConnectButton } from './components/CustomConnectButton';
import CSVUpload, { CSVRecipient, CSVUploadResult } from './components/CSVUpload';
import ReviewTransactionModal, {
  TransactionState,
  GasEstimate,
} from './components/ReviewTransactionModal';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { calculateFeeRows } from './utils/fee';
import { buildBatchTransaction, attoFilToFil } from './lib/transaction/messageBuilder';
import { getNonce } from './lib/DataProvider';
import { validateRecipientRows } from './utils/recipientValidation';

interface Recipient {
  address: string;
  amount: string;
}

type InputMode = 'manual' | 'csv';

const FILECOIN_MAINNET_ID = 314;
const MAINNET_ADDRESS_PREFIX = 'f' as const;
const E2E_MOCK_WALLET_ENABLED = import.meta.env.VITE_E2E_MOCK_WALLET === 'true';
const E2E_SKIP_GAS_ESTIMATION = import.meta.env.VITE_E2E_SKIP_GAS_ESTIMATION === 'true';
const E2E_MOCK_SEND_DELAY_MS = Number(import.meta.env.VITE_E2E_SEND_DELAY_MS ?? '3000');
const E2E_MOCK_ACCOUNT = '0x1234567890AbcdEF1234567890aBcdef12345678' as const;
const E2E_MOCK_BALANCE_FIL = 1000;

function createEmptyRecipients(count = 3): Recipient[] {
  return Array.from({ length: count }, () => ({ address: '', amount: '' }));
}

function formatSummaryFil(amount: number): string {
  if (amount === 0) return '0 FIL';

  return `${amount.toLocaleString(undefined, {
    maximumFractionDigits: amount >= 1 ? 4 : 6,
  })} FIL`;
}

function collectManualRowIssues(messages: string[]): Record<number, string[]> {
  return messages.reduce<Record<number, string[]>>((accumulator, message) => {
    const match = message.match(/^Recipient (\d+):\s*(.*)$/);

    if (!match) {
      return accumulator;
    }

    const rowNumber = Number(match[1]);
    const details = match[2];

    if (!accumulator[rowNumber]) {
      accumulator[rowNumber] = [];
    }

    accumulator[rowNumber].push(details);
    return accumulator;
  }, {});
}

function SummaryPanel({
  title,
  messages,
  tone,
}: {
  title: string;
  messages: string[];
  tone: 'error' | 'warning' | 'info';
}) {
  const toneClasses = {
    error: 'border-red-200 bg-red-50 text-red-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
  };

  return (
    <div className={`rounded-2xl border px-5 py-4 ${toneClasses[tone]}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-1.5 text-sm">
        {messages.map((message, index) => (
          <li key={`${title}-${index}`}>• {message}</li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const account = useAccount();
  const walletChainId = useChainId();
  const { data: balanceData } = useBalance({ address: account.address });

  const isConnected = E2E_MOCK_WALLET_ENABLED ? true : account.isConnected;
  const address = E2E_MOCK_WALLET_ENABLED ? E2E_MOCK_ACCOUNT : account.address;
  const chainId = E2E_MOCK_WALLET_ENABLED ? FILECOIN_MAINNET_ID : walletChainId;

  const [inputMode, setInputMode] = React.useState<InputMode>('manual');
  const [manualRecipients, setManualRecipients] = React.useState<Recipient[]>(() =>
    createEmptyRecipients(),
  );
  const [csvData, setCsvData] = React.useState<CSVRecipient[]>([]);
  const [csvErrors, setCsvErrors] = React.useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = React.useState<string[]>([]);

  const [isReviewModalOpen, setIsReviewModalOpen] = React.useState(false);
  const [transactionState, setTransactionState] = React.useState<TransactionState>('review');
  const [gasEstimate, setGasEstimate] = React.useState<GasEstimate | undefined>(undefined);
  const [isEstimatingGas, setIsEstimatingGas] = React.useState(false);
  const [gasEstimationError, setGasEstimationError] = React.useState<string | undefined>(undefined);
  const [transactionHash, setTransactionHash] = React.useState<string | undefined>(undefined);
  const [transactionError, setTransactionError] = React.useState<string | undefined>(undefined);

  const handleCSVUpload = (result: CSVUploadResult) => {
    setCsvData(result.recipients);
    setCsvErrors(result.errors);
    setCsvWarnings(result.warnings);
    setInputMode('csv');
  };

  const handleCSVReset = () => {
    setCsvData([]);
    setCsvErrors([]);
    setCsvWarnings([]);
  };

  const addRecipient = () => {
    setManualRecipients((current) => [...current, { address: '', amount: '' }]);
  };

  const removeRecipient = (index: number) => {
    setManualRecipients((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    setManualRecipients((current) => {
      const nextRecipients = [...current];
      nextRecipients[index] = { ...nextRecipients[index], [field]: value };
      return nextRecipients;
    });
  };

  const manualValidation = React.useMemo(
    () =>
      validateRecipientRows(manualRecipients, {
        source: 'manual',
        expectedNetworkPrefix: MAINNET_ADDRESS_PREFIX,
        requireAtLeastOneRecipient: false,
      }),
    [manualRecipients],
  );

  const csvRecipients = React.useMemo(
    () =>
      csvData.map((recipient) => ({
        address: recipient.receiverAddress,
        amount: recipient.value,
        lineNumber: recipient.lineNumber,
      })),
    [csvData],
  );

  const hasEnteredData =
    inputMode === 'manual'
      ? manualValidation.nonEmptyRowCount > 0
      : csvData.length > 0 || csvErrors.length > 0 || csvWarnings.length > 0;

  const isNetworkMismatch = isConnected && chainId !== FILECOIN_MAINNET_ID;
  const networkValidationErrors =
    isNetworkMismatch && hasEnteredData
      ? ['Switch to Filecoin Mainnet (chain 314) to review and send this batch.']
      : [];

  const activeValidationErrors =
    inputMode === 'manual'
      ? [...manualValidation.errors, ...networkValidationErrors]
      : [...csvErrors, ...networkValidationErrors];
  const activeValidationWarnings =
    inputMode === 'manual' ? manualValidation.warnings : csvWarnings;

  const validRecipients = React.useMemo(
    () =>
      (inputMode === 'manual' ? manualValidation.validRecipients : csvRecipients).map(
        (recipient) => ({
          address: recipient.address,
          amount: Number(recipient.amount),
        }),
      ),
    [csvRecipients, inputMode, manualValidation.validRecipients],
  );

  const draftRecipientCount =
    inputMode === 'manual' ? manualValidation.nonEmptyRowCount : csvData.length;
  const hasReviewableRows = draftRecipientCount > 0;

  const recipientTotal = validRecipients.reduce((sum, recipient) => sum + recipient.amount, 0);

  const feeTotal = React.useMemo(() => {
    if (validRecipients.length === 0) return 0;

    try {
      const rows = calculateFeeRows(validRecipients);
      return rows.slice(validRecipients.length).reduce((sum, row) => sum + row.amount, 0);
    } catch {
      return 0;
    }
  }, [validRecipients]);

  const walletBalance = E2E_MOCK_WALLET_ENABLED
    ? E2E_MOCK_BALANCE_FIL
    : balanceData
      ? Number(balanceData.formatted)
      : 0;
  const estimatedNetworkFee = gasEstimate?.estimatedFeeInFil || 0;
  const insufficientBalance = walletBalance < recipientTotal + feeTotal + estimatedNetworkFee;

  const manualRowErrors = React.useMemo(
    () => collectManualRowIssues(manualValidation.errors),
    [manualValidation.errors],
  );
  const manualRowWarnings = React.useMemo(
    () => collectManualRowIssues(manualValidation.warnings),
    [manualValidation.warnings],
  );

  const reviewDisabled = !isConnected || isNetworkMismatch || !hasReviewableRows;

  const reviewHint = React.useMemo(() => {
    if (!isConnected) {
      return 'Connect a wallet in the sidebar to review and send.';
    }

    if (isNetworkMismatch) {
      return 'Switch to Filecoin Mainnet before continuing.';
    }

    if (!hasReviewableRows) {
      return inputMode === 'manual'
        ? 'Add at least one recipient to continue.'
        : 'Upload a CSV file to continue.';
    }

    if (activeValidationErrors.length > 0) {
      return 'Review is available, but send stays disabled until errors are resolved.';
    }

    if (activeValidationWarnings.length > 0) {
      return 'Review warnings before you send the batch.';
    }

    return 'Ready for review.';
  }, [
    activeValidationErrors.length,
    activeValidationWarnings.length,
    hasReviewableRows,
    inputMode,
    isConnected,
    isNetworkMismatch,
  ]);

  const handleReview = async () => {
    if (!isConnected || !address || isNetworkMismatch || !hasReviewableRows) {
      return;
    }

    setTransactionState('review');
    setGasEstimate(undefined);
    setGasEstimationError(undefined);
    setTransactionHash(undefined);
    setTransactionError(undefined);
    setIsReviewModalOpen(true);

    if (E2E_MOCK_WALLET_ENABLED || E2E_SKIP_GAS_ESTIMATION) {
      return;
    }

    if (validRecipients.length > 0 && activeValidationErrors.length === 0) {
      setIsEstimatingGas(true);

      try {
        const allRecipients = calculateFeeRows(validRecipients);

        const batchResult = await buildBatchTransaction({
          recipients: allRecipients,
          senderAddress: address,
          startingNonce: await getNonce(address),
        });

        setGasEstimate({
          gasLimit: batchResult.estimatedGas.GasLimit,
          gasFeeCap: batchResult.estimatedGas.GasFeeCap,
          gasPremium: batchResult.estimatedGas.GasPremium,
          estimatedFeeInFil: attoFilToFil(batchResult.feeEstimate),
        });
      } catch (error) {
        console.error('Gas estimation failed:', error);
        setGasEstimationError(
          error instanceof Error ? error.message : 'Failed to estimate gas',
        );
      } finally {
        setIsEstimatingGas(false);
      }
    }
  };

  const handleCloseReviewModal = () => {
    if (transactionState === 'signing') {
      return;
    }

    setIsReviewModalOpen(false);
  };

  const handleConfirmTransaction = async () => {
    setTransactionState('signing');
    setTransactionError(undefined);

    try {
      setTransactionState('pending');
      await new Promise((resolve) => setTimeout(resolve, E2E_MOCK_SEND_DELAY_MS));
      setTransactionHash('bafy2bzaced...example');
      setTransactionState('confirmed');
    } catch (error) {
      console.error('Transaction failed:', error);
      setTransactionError(error instanceof Error ? error.message : 'Transaction failed');
      setTransactionState('failed');
    }
  };

  const handleDownloadTemplate = () => {
    try {
      fetch('/sendfil-template.csv')
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          return response.blob();
        })
        .then((blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');

          link.href = url;
          link.download = 'sendfil-template.csv';
          link.style.display = 'none';

          document.body.appendChild(link);
          link.click();

          setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
          }, 1000);
        })
        .catch(() => {
          const csvContent = `receiverAddress,value
f1cj...,3.3`;

          const blob = new Blob([csvContent], {
            type: 'text/csv;charset=utf-8;',
          });

          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');

          link.href = url;
          link.download = 'sendfil-template.csv';
          link.style.display = 'none';

          document.body.appendChild(link);
          link.click();

          setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
          }, 1000);
        });
    } catch (error) {
      console.error('Error in download template:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-900">
      <div className="min-h-screen lg:flex">
        <aside className="border-b border-slate-200/80 bg-white/90 px-5 py-6 backdrop-blur lg:w-72 lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
          <div className="flex items-start justify-between gap-4 lg:block">
            <div className="flex items-center gap-3 lg:mb-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1f69ff] text-3xl text-white shadow-[0_20px_35px_-25px_rgba(31,105,255,0.95)]">
                ƒ
              </div>
              <div className="lg:hidden">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  SendFIL
                </p>
                <p className="text-sm text-slate-500">Batch FIL transfers</p>
              </div>
            </div>
          </div>

          <CustomConnectButton />

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Draft the batch first. Review and send are unlocked only after a wallet is connected on
            Filecoin Mainnet.
          </div>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto max-w-6xl">
            <header className="mb-6">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                SendFIL
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
                Transfer FIL to one or many recipients.
              </p>
            </header>

            {!isConnected && (
              <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
                You can compose a batch before connecting a wallet. Connect when you are ready to
                review gas estimates and send.
              </div>
            )}

            <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setInputMode('manual')}
                  data-testid="manual-mode-toggle"
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                    inputMode === 'manual'
                      ? 'bg-[#1f69ff] text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Manual Entry
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('csv')}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                    inputMode === 'csv'
                      ? 'bg-[#1f69ff] text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  CSV Upload
                </button>
              </div>

              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                Download Template
              </button>
            </div>

            {(activeValidationErrors.length > 0 || activeValidationWarnings.length > 0) && (
              <div className="mb-6 space-y-3">
                {activeValidationErrors.length > 0 && (
                  <SummaryPanel
                    title="Validation errors"
                    messages={activeValidationErrors}
                    tone="error"
                  />
                )}
                {activeValidationWarnings.length > 0 && (
                  <SummaryPanel
                    title="Warnings"
                    messages={activeValidationWarnings}
                    tone="warning"
                  />
                )}
              </div>
            )}

            {inputMode === 'manual' ? (
              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
                  <h2 className="text-lg font-semibold text-slate-950">Manual Recipients</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Enter recipient addresses and FIL amounts directly. Use the review step to
                    verify totals and fees before sending.
                  </p>
                </div>

                <div className="px-6 pb-6 pt-5 sm:px-8">
                  <div className="mb-4 hidden grid-cols-[minmax(0,1fr)_180px_48px] gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 md:grid">
                    <div>Receiver</div>
                    <div>FIL Amount</div>
                    <div />
                  </div>

                  <div className="space-y-4">
                    {manualRecipients.map((recipient, index) => {
                      const rowNumber = index + 1;
                      const rowErrors = manualRowErrors[rowNumber] || [];
                      const rowWarnings = manualRowWarnings[rowNumber] || [];
                      const hasRowIssues = rowErrors.length > 0;

                      return (
                        <div key={rowNumber}>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_48px]">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 md:hidden">
                                Receiver
                              </label>
                              <input
                                placeholder="f1..., f4..., or 0x..."
                                value={recipient.address}
                                onChange={(event) =>
                                  updateRecipient(index, 'address', event.target.value)
                                }
                                data-testid={`recipient-address-${index}`}
                                className={`w-full rounded-2xl border px-4 py-3 text-sm font-mono transition-colors placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 ${
                                  hasRowIssues
                                    ? 'border-red-300 bg-red-50 text-red-900'
                                    : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-[#1f69ff]'
                                }`}
                              />
                            </div>

                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 md:hidden">
                                FIL Amount
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={recipient.amount}
                                onChange={(event) =>
                                  updateRecipient(index, 'amount', event.target.value)
                                }
                                data-testid={`recipient-amount-${index}`}
                                className={`w-full rounded-2xl border px-4 py-3 text-sm transition-colors placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 ${
                                  hasRowIssues
                                    ? 'border-red-300 bg-red-50 text-red-900'
                                    : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-[#1f69ff]'
                                }`}
                              />
                            </div>

                            <div className="flex items-center justify-end md:justify-center">
                              {manualRecipients.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeRecipient(index)}
                                  className="flex h-[50px] w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-lg text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900"
                                  aria-label={`Remove recipient ${rowNumber}`}
                                >
                                  ×
                                </button>
                              ) : (
                                <div className="hidden h-[50px] w-12 md:block" />
                              )}
                            </div>
                          </div>

                          {(rowErrors.length > 0 || rowWarnings.length > 0) && (
                            <div className="mt-2 space-y-1">
                              {rowErrors.map((message) => (
                                <p
                                  key={`error-${rowNumber}-${message}`}
                                  className="text-sm text-red-700"
                                >
                                  {message}
                                </p>
                              ))}
                              {rowWarnings.map((message) => (
                                <p
                                  key={`warning-${rowNumber}-${message}`}
                                  className="text-sm text-amber-700"
                                >
                                  {message}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={addRecipient}
                    className="mt-6 inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-[#1f69ff] transition-colors hover:border-slate-300 hover:bg-slate-100"
                  >
                    + Add recipient
                  </button>
                </div>
              </section>
            ) : (
              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
                  <h2 className="text-lg font-semibold text-slate-950">CSV Upload</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Import a prepared batch using the template format, then review the parsed
                    recipients before sending.
                  </p>
                </div>

                <div className="px-6 pb-6 pt-5 sm:px-8">
                  {csvData.length === 0 ? (
                    <CSVUpload
                      onUpload={handleCSVUpload}
                      disabled={false}
                      expectedNetworkPrefix={MAINNET_ADDRESS_PREFIX}
                    />
                  ) : (
                    <div>
                      <SummaryPanel
                        title="CSV loaded successfully"
                        messages={[
                          `${csvData.length} recipients imported from the uploaded file.`,
                          `Current valid total: ${formatSummaryFil(
                            csvData.reduce((sum, recipient) => sum + Number(recipient.value), 0),
                          )}.`,
                        ]}
                        tone="info"
                      />

                      <div className="mt-5 hidden grid-cols-[minmax(0,1fr)_180px] gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 md:grid">
                        <div>Receiver</div>
                        <div>FIL Amount</div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {csvData.map((recipient) => (
                          <div
                            key={`csv-row-${recipient.lineNumber}`}
                            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]"
                          >
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 md:hidden">
                                Receiver
                              </label>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-700">
                                {recipient.receiverAddress}
                              </div>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 md:hidden">
                                FIL Amount
                              </label>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                {recipient.value}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={handleCSVReset}
                        className="mt-6 inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                      >
                        Upload another file
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            <div className="sticky bottom-4 z-10 mt-8">
              <div className="rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {activeValidationErrors.length > 0
                        ? `${validRecipients.length} valid recipients • ${formatSummaryFil(
                            recipientTotal,
                          )}`
                        : `${draftRecipientCount} recipients • ${formatSummaryFil(recipientTotal)}`}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{reviewHint}</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleReview}
                    disabled={reviewDisabled}
                    data-testid="review-batch-button"
                    className={`min-w-[220px] rounded-xl px-5 py-3 text-sm font-medium transition-colors ${
                      reviewDisabled
                        ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                        : 'bg-[#1f69ff] text-white hover:bg-[#1857d4]'
                    }`}
                  >
                    {!isConnected
                      ? 'Connect Wallet to Review'
                      : isNetworkMismatch
                        ? 'Switch Network to Review'
                        : `Review Batch${draftRecipientCount > 0 ? ` (${draftRecipientCount})` : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <ReviewTransactionModal
        isOpen={isReviewModalOpen}
        onClose={handleCloseReviewModal}
        onConfirm={handleConfirmTransaction}
        recipients={validRecipients}
        validationErrors={activeValidationErrors}
        validationWarnings={activeValidationWarnings}
        recipientTotal={recipientTotal}
        feeTotal={feeTotal}
        gasEstimate={gasEstimate}
        isEstimatingGas={isEstimatingGas}
        gasEstimationError={gasEstimationError}
        walletBalance={walletBalance}
        insufficientBalance={insufficientBalance}
        transactionState={transactionState}
        transactionHash={transactionHash}
        transactionError={transactionError}
      />
    </div>
  );
}
