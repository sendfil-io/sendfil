import * as React from 'react';
import './App.css';
import { CustomConnectButton } from './components/CustomConnectButton';
import CSVUpload, { CSVRecipient, CSVUploadResult } from './components/CSVUpload';
import ReviewTransactionModal, {
  TransactionState,
  GasEstimate,
} from './components/ReviewTransactionModal';
import UnavailableCapabilityModal from './components/UnavailableCapabilityModal';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { calculateFeeRows } from './utils/fee';
import { buildBatchTransaction, attoFilToFil } from './lib/transaction/messageBuilder';
import { getNonce } from './lib/DataProvider';
import { validateRecipientRows } from './utils/recipientValidation';
import {
  DEFAULT_BATCH_CONFIGURATION,
  getErrorHandlingLabel,
  getExecutionMethodLabel,
  type BatchConfiguration,
  type ErrorHandlingPreference,
  type ExecutionMethod,
  type SenderWalletType,
} from './lib/batchConfiguration';

interface Recipient {
  address: string;
  amount: string;
}

interface ManualRecipientInteraction {
  addressTouched: boolean;
  amountTouched: boolean;
}

interface ConfigurationChoice {
  value: string;
  label: string;
  helper?: React.ReactNode;
  badge?: string;
  testId?: string;
}

interface UnavailableCapabilityNotice {
  title: string;
  description: string;
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

function createEmptyManualInteractions(count = 3): ManualRecipientInteraction[] {
  return Array.from({ length: count }, () => ({
    addressTouched: false,
    amountTouched: false,
  }));
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

function shouldShowManualError(
  recipient: Recipient | undefined,
  interaction: ManualRecipientInteraction | undefined,
  message: string,
): boolean {
  if (!recipient) {
    return true;
  }

  const hasAddress = recipient.address.trim().length > 0;
  const hasAmount = recipient.amount.trim().length > 0;
  const isAmountError = message === 'Amount is required' || message.startsWith('Amount ');
  const isAddressError = !isAmountError;

  if (isAddressError) {
    return Boolean(interaction?.addressTouched) && hasAmount;
  }

  return Boolean(interaction?.amountTouched) && hasAddress;
}

function getManualDraftHint(
  recipient: Recipient,
  hasVisibleErrors: boolean,
  hasVisibleWarnings: boolean,
): string | null {
  if (hasVisibleErrors || hasVisibleWarnings) {
    return null;
  }

  const hasAddress = recipient.address.trim().length > 0;
  const hasAmount = recipient.amount.trim().length > 0;

  if (hasAddress && !hasAmount) {
    return 'Add an amount to include this row.';
  }

  if (!hasAddress && hasAmount) {
    return 'Add a recipient address to include this row.';
  }

  return null;
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

function ConfigurationChoiceGroup({
  title,
  description,
  selectedValue,
  options,
  onSelect,
}: {
  title: string;
  description?: string;
  selectedValue: string;
  options: ConfigurationChoice[];
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      </div>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const isSelected = option.value === selectedValue;

          return (
            <button
              key={`${title}-${option.value}`}
              type="button"
              onClick={() => onSelect(option.value)}
              data-testid={option.testId}
              aria-pressed={isSelected}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                isSelected
                  ? 'border-[#1f69ff] bg-[#eef4ff] shadow-[0_18px_32px_-28px_rgba(31,105,255,0.95)]'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-sm font-semibold ${
                    isSelected ? 'text-[#124ac4]' : 'text-slate-900'
                  }`}
                >
                  <span className="whitespace-nowrap">{option.label}</span>
                </span>
                {option.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      isSelected
                        ? 'bg-white text-[#124ac4]'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {option.badge}
                  </span>
                )}
              </div>
              {option.helper && (
                <p className="mt-2 text-xs leading-5 text-slate-500">{option.helper}</p>
              )}
            </button>
          );
        })}
      </div>
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
  const [manualInteractions, setManualInteractions] = React.useState<ManualRecipientInteraction[]>(
    () => createEmptyManualInteractions(),
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
  const [batchConfiguration, setBatchConfiguration] = React.useState<BatchConfiguration>(
    DEFAULT_BATCH_CONFIGURATION,
  );
  const [isConfigureTransactionOpen, setIsConfigureTransactionOpen] = React.useState(false);
  const [unavailableCapabilityNotice, setUnavailableCapabilityNotice] =
    React.useState<UnavailableCapabilityNotice | null>(null);

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

  const openUnavailableCapabilityNotice = (title: string, description: string) => {
    setUnavailableCapabilityNotice({ title, description });
  };

  const handleSenderWalletTypeSelect = (value: SenderWalletType) => {
    if (value === 'MULTI_SIG') {
      openUnavailableCapabilityNotice(
        'Multi-sig is not available in v1 yet',
        'The selector is now in place, but the v1 live flow still supports only the single-signer path. Single-signer remains selected for this batch.',
      );
      return;
    }

    setBatchConfiguration((current) => ({ ...current, senderWalletType: value }));
  };

  const handleExecutionMethodSelect = (value: ExecutionMethod) => {
    if (value === 'THINBATCH') {
      openUnavailableCapabilityNotice(
        'ThinBatch is not available yet',
        'ThinBatch is part of the planned execution surface, but the deployed builder and send path are not wired into the live app yet. Standard remains selected for now.',
      );
      return;
    }

    setBatchConfiguration((current) => ({ ...current, executionMethod: value }));
  };

  const handleErrorHandlingSelect = (value: ErrorHandlingPreference) => {
    if (value === 'ATOMIC') {
      openUnavailableCapabilityNotice(
        'Atomic error handling is not wired yet',
        'The control is now visible, but the live execution path still defaults to Partial while atomic batch handling is implemented end to end. Partial remains selected for this batch.',
      );
      return;
    }

    setBatchConfiguration((current) => ({ ...current, errorHandling: value }));
  };

  const addRecipient = () => {
    setManualRecipients((current) => [...current, { address: '', amount: '' }]);
    setManualInteractions((current) => [
      ...current,
      { addressTouched: false, amountTouched: false },
    ]);
  };

  const removeRecipient = (index: number) => {
    setManualRecipients((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setManualInteractions((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    setManualRecipients((current) => {
      const nextRecipients = [...current];
      nextRecipients[index] = { ...nextRecipients[index], [field]: value };
      return nextRecipients;
    });
  };

  const markRecipientTouched = (
    index: number,
    field: keyof ManualRecipientInteraction,
  ) => {
    setManualInteractions((current) => {
      const nextInteractions = [...current];
      const existingInteraction = nextInteractions[index] ?? {
        addressTouched: false,
        amountTouched: false,
      };

      nextInteractions[index] = {
        ...existingInteraction,
        [field]: true,
      };

      return nextInteractions;
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

  const manualDisplayErrors = React.useMemo(
    () =>
      manualValidation.errors.filter((message) => {
        const match = message.match(/^Recipient (\d+):\s*(.*)$/);

        if (!match) {
          return true;
        }

        const rowNumber = Number(match[1]);
        const details = match[2];

        return shouldShowManualError(
          manualRecipients[rowNumber - 1],
          manualInteractions[rowNumber - 1],
          details,
        );
      }),
    [manualInteractions, manualRecipients, manualValidation.errors],
  );

  const activeValidationErrors =
    inputMode === 'manual'
      ? [...manualDisplayErrors, ...networkValidationErrors]
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
      ? Number(formatUnits(balanceData.value, balanceData.decimals))
      : 0;
  const estimatedNetworkFee = gasEstimate?.estimatedFeeInFil || 0;
  const insufficientBalance = walletBalance < recipientTotal + feeTotal + estimatedNetworkFee;

  const manualRowErrors = React.useMemo(
    () => collectManualRowIssues(manualDisplayErrors),
    [manualDisplayErrors],
  );
  const manualRowWarnings = React.useMemo(
    () => collectManualRowIssues(manualValidation.warnings),
    [manualValidation.warnings],
  );
  const manualIncompleteRowCount = React.useMemo(
    () =>
      manualRecipients.filter((recipient) => {
        const hasAddress = recipient.address.trim().length > 0;
        const hasAmount = recipient.amount.trim().length > 0;
        return hasAddress !== hasAmount;
      }).length,
    [manualRecipients],
  );

  const reviewDisabled = !isConnected || isNetworkMismatch || !hasReviewableRows;

  const reviewHint = React.useMemo(() => {
    if (!isConnected) {
      return 'Connect a wallet to review and send.';
    }

    if (isNetworkMismatch) {
      return 'Switch to Filecoin Mainnet before continuing.';
    }

    if (!hasReviewableRows) {
      return inputMode === 'manual'
        ? 'Add at least one recipient to continue.'
        : 'Upload a CSV file to continue.';
    }

    if (inputMode === 'manual' && manualIncompleteRowCount > 0 && activeValidationErrors.length === 0) {
      return 'Complete each draft row with both an address and amount before review.';
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
    manualIncompleteRowCount,
  ]);

  const handleReview = async () => {
    if (!isConnected || !address || isNetworkMismatch || !hasReviewableRows) {
      return;
    }

    if (inputMode === 'manual') {
      setManualInteractions((current) =>
        manualRecipients.map((recipient, index) => {
          const existingInteraction = current[index] ?? {
            addressTouched: false,
            amountTouched: false,
          };
          const hasAddress = recipient.address.trim().length > 0;
          const hasAmount = recipient.amount.trim().length > 0;

          if (!hasAddress && !hasAmount) {
            return existingInteraction;
          }

          return {
            addressTouched: existingInteraction.addressTouched || hasAmount,
            amountTouched: existingInteraction.amountTouched || hasAddress,
          };
        }),
      );
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

          <div className="mt-6 rounded-[28px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.45)]">
            <ConfigurationChoiceGroup
              title="Wallet Type"
              selectedValue={batchConfiguration.senderWalletType}
              onSelect={(value) => handleSenderWalletTypeSelect(value as SenderWalletType)}
              options={[
                {
                  value: 'SINGLE_SIG',
                  label: 'Single-sig',
                  testId: 'sender-wallet-single-sig',
                },
                {
                  value: 'MULTI_SIG',
                  label: 'Multi-sig',
                  testId: 'sender-wallet-multi-sig',
                },
              ]}
            />
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

            <section className="mb-6 rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)] sm:px-8">
              <button
                type="button"
                onClick={() => setIsConfigureTransactionOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 text-left"
                aria-expanded={isConfigureTransactionOpen}
              >
                <h2 className="text-lg font-semibold text-slate-950">Configure transaction</h2>
                <div className="flex items-center gap-3">
                  {!isConfigureTransactionOpen && (
                    <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <span className="rounded-full bg-slate-100 px-3 py-1">
                        {getExecutionMethodLabel(batchConfiguration.executionMethod)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1">
                        {getErrorHandlingLabel(batchConfiguration.errorHandling)}
                      </span>
                    </div>
                  )}
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-transform ${
                      isConfigureTransactionOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path
                        d="M5 7.5L10 12.5L15 7.5"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
              </button>

              {isConfigureTransactionOpen && (
                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  <ConfigurationChoiceGroup
                    title="Transaction method"
                    description="Choose how SendFIL executes the batch transaction."
                    selectedValue={batchConfiguration.executionMethod}
                    onSelect={(value) => handleExecutionMethodSelect(value as ExecutionMethod)}
                    options={[
                      {
                        value: 'STANDARD',
                        label: 'Standard',
                        helper: (
                          <>
                            <a
                              href="https://docs.filecoin.io/smart-contracts/advanced/multicall"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
                            >
                              Multicall3
                            </a>{' '}
                            +{' '}
                            <a
                              href="https://docs.filecoin.io/smart-contracts/filecoin-evm-runtime/filforwarder"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
                            >
                              FilForwarder
                            </a>{' '}
                            to batch all payments in a single transaction.
                          </>
                        ),
                        badge: 'Default',
                        testId: 'execution-method-standard',
                      },
                      {
                        value: 'THINBATCH',
                        label: 'ThinBatch',
                        helper:
                          'Uses a cusom contract to batch in one call for easy per-recipient auditing.',
                        testId: 'execution-method-thinbatch',
                      },
                    ]}
                  />

                  <div className="xl:border-l xl:border-slate-200 xl:pl-5">
                    <ConfigurationChoiceGroup
                      title="Error handling"
                      description="Choose what happens when a payment within a batch transaction fails."
                      selectedValue={batchConfiguration.errorHandling}
                      onSelect={(value) => handleErrorHandlingSelect(value as ErrorHandlingPreference)}
                      options={[
                        {
                          value: 'PARTIAL',
                          label: 'Partial',
                          helper:
                            'Sends what it can: failed payments are skipped and the rest is completed.',
                          badge: 'Default',
                          testId: 'error-handling-partial',
                        },
                        {
                          value: 'ATOMIC',
                          label: 'Atomic',
                          helper:
                            'All-or-nothing: no FIL is sent if a single payment in the batch fails.',
                          testId: 'error-handling-atomic',
                        },
                      ]}
                    />
                  </div>
                </div>
              )}
            </section>

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
                      const draftHint = getManualDraftHint(
                        recipient,
                        rowErrors.length > 0,
                        rowWarnings.length > 0,
                      );

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
                                onBlur={() => markRecipientTouched(index, 'addressTouched')}
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
                                onBlur={() => markRecipientTouched(index, 'amountTouched')}
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

                          {(rowErrors.length > 0 || rowWarnings.length > 0 || Boolean(draftHint)) && (
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
                              {draftHint && (
                                <p className="text-sm text-slate-500">{draftHint}</p>
                              )}
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
                      {activeValidationErrors.length > 0 ||
                      (inputMode === 'manual' && manualIncompleteRowCount > 0)
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
        batchConfiguration={batchConfiguration}
      />

      <UnavailableCapabilityModal
        isOpen={unavailableCapabilityNotice !== null}
        title={unavailableCapabilityNotice?.title ?? ''}
        description={unavailableCapabilityNotice?.description ?? ''}
        onClose={() => setUnavailableCapabilityNotice(null)}
      />
    </div>
  );
}
