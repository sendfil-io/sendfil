import * as React from 'react';
import './App.css';
import { CustomConnectButton } from './components/CustomConnectButton';
import CSVUpload, { CSVRecipient, CSVUploadResult } from './components/CSVUpload';
import NetworkBanner from './components/NetworkBanner';
import ReviewTransactionModal, {
  TransactionState,
  GasEstimate,
} from './components/ReviewTransactionModal';
import { MultisigFundingPanel } from './components/multisig/MultisigFundingPanel';
import UnavailableCapabilityModal from './components/UnavailableCapabilityModal';
import { useBalance, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { validateNoEvmContractRecipients } from './utils/contractRecipientGuard';
import { calculateFeeRows, getFeeLabel } from './utils/fee';
import {
  DEFAULT_MAX_RECIPIENTS,
  validateRecipientRows,
  type RecipientValidationResult,
} from './utils/recipientValidation';
import {
  DEFAULT_BATCH_CONFIGURATION,
  getErrorHandlingLabel,
  getExecutionMethodLabel,
  type BatchConfiguration,
  type ErrorHandlingPreference,
  type ExecutionMethod,
  type SenderWalletType,
} from './lib/batchConfiguration';
import { attoFilBigIntToFil, type BatchGasEstimate } from './lib/transaction/batchExecution';
import { BatchExecutionError } from './lib/transaction/errorHandling';
import { createMockBatchExecutionAdapter } from './lib/transaction/mockAdapter';
import { useExecuteBatch } from './lib/transaction/useExecuteBatch';
import { useExecuteNativeBatch } from './lib/transaction/useExecuteNativeBatch';
import {
  useExecuteMultisigProposal,
  useMultisigs,
  type CreateMultisigFormValues,
  type CreateMultisigResult,
  type MultisigPendingProposal,
} from './lib/multisig';
import {
  getDefaultNetworkConfig,
  getFilfoxMessageUrl,
  getNetworkConfig,
  getSupportedNetworkByChainId,
  getSupportedNetworkListLabel,
  type NetworkPrefix,
} from './lib/networks';
import {
  createNativeFilecoinConnectedSender,
  getNativeFilecoinSenderBalanceAttoFil,
  getNativeFilecoinWalletProviders,
  useConnectedSender,
  type NativeFilecoinConnectedSender,
  type NativeFilecoinWalletProvider,
} from './lib/senders';

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

interface MultisigReviewContext {
  address?: string;
  label: string;
  chainId: number;
  networkLabel: string;
  signerAddress?: string;
  threshold?: number;
  signerCount?: number;
  spendableBalanceFil: number;
}

type InputMode = 'manual' | 'csv';

const E2E_MOCK_WALLET_ENABLED = import.meta.env.VITE_E2E_MOCK_WALLET === 'true';
const E2E_SKIP_GAS_ESTIMATION = import.meta.env.VITE_E2E_SKIP_GAS_ESTIMATION === 'true';
const E2E_MOCK_SEND_DELAY_MS = Number(import.meta.env.VITE_E2E_SEND_DELAY_MS ?? '3000');
const E2E_MOCK_ACCOUNT = '0x1234567890AbcdEF1234567890aBcdef12345678' as const;
const E2E_MOCK_BALANCE_FIL = 1000;
const E2E_MOCK_CHAIN_ID =
  getSupportedNetworkByChainId(Number(import.meta.env.VITE_E2E_CHAIN_ID ?? '314'))?.chainId ??
  getNetworkConfig('mainnet').chainId;

function createEmptyRecipients(count = 3): Recipient[] {
  return Array.from({ length: count }, () => ({ address: '', amount: '' }));
}

function createEmptyManualInteractions(count = 3): ManualRecipientInteraction[] {
  return Array.from({ length: count }, () => ({
    addressTouched: false,
    amountTouched: false,
  }));
}

function getManualRecipientAddressPlaceholder(
  rowIndex: number,
  expectedNetworkPrefix?: NetworkPrefix,
): string {
  const nativePrefix = expectedNetworkPrefix === 't' ? 't' : 'f';
  const placeholderPattern = [`${nativePrefix}1...`, `${nativePrefix}4...`, '0x...'];

  return placeholderPattern[rowIndex % placeholderPattern.length];
}

function createEmptyRecipientValidationResult(): RecipientValidationResult {
  return {
    validRecipients: [],
    errors: [],
    warnings: [],
    nonEmptyRowCount: 0,
  };
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

function createFallbackReviewGasEstimate(recipientCount: number): GasEstimate {
  const gasLimit = 21_000n * BigInt(recipientCount + 1);
  const gasPrice = 1_000_000_000n;
  const bufferedGasLimit = (gasLimit * 110n) / 100n;

  return {
    gasLimit: Number(bufferedGasLimit),
    gasFeeCap: gasPrice.toString(),
    gasPremium: gasPrice.toString(),
    estimatedFeeInFil: attoFilBigIntToFil(bufferedGasLimit * gasPrice),
  };
}

function toReviewGasEstimate(estimate: BatchGasEstimate): GasEstimate {
  return {
    gasLimit: Number(estimate.gasLimit),
    gasFeeCap: estimate.gasFeeCap.toString(),
    gasPremium: estimate.gasPremium.toString(),
    estimatedFeeInFil: attoFilBigIntToFil(estimate.estimatedFee),
  };
}

function formatWalletBalanceLabel(balanceFil: number): string {
  if (balanceFil === 0) {
    return '0 FIL';
  }

  if (balanceFil < 0.000001) {
    return '< 0.000001 FIL';
  }

  return `${balanceFil.toLocaleString(undefined, {
    maximumFractionDigits: balanceFil < 1 ? 6 : 3,
  })} FIL`;
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

const choiceCardSelectedShadow =
  'shadow-[0_18px_36px_-26px_rgba(31,105,255,0.82),0_14px_32px_-28px_rgba(60,212,160,0.22)]';

function ConfigurationChoiceGroup({
  title,
  description,
  selectedValue,
  options,
  onSelect,
  variant = 'cards',
  disabled = false,
}: {
  title: string;
  description?: string;
  selectedValue: string;
  options: ConfigurationChoice[];
  onSelect: (value: string) => void;
  variant?: 'cards' | 'segmented';
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      </div>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}

      {variant === 'segmented' ? (
        <div className="mt-3 flex gap-2">
          {options.map((option) => {
            const isSelected = option.value === selectedValue;

            return (
              <button
                key={`${title}-${option.value}`}
                type="button"
                onClick={() => onSelect(option.value)}
                disabled={disabled}
                data-testid={option.testId}
                aria-pressed={isSelected}
                className={`min-h-[44px] flex-1 rounded-2xl border px-3 py-2.5 text-center text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? `border-[#1f69ff] bg-white text-[#124ac4] ${choiceCardSelectedShadow}`
                    : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="whitespace-nowrap">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {options.map((option) => {
            const isSelected = option.value === selectedValue;

            return (
              <button
                key={`${title}-${option.value}`}
                type="button"
                onClick={() => onSelect(option.value)}
                disabled={disabled}
                data-testid={option.testId}
                aria-pressed={isSelected}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? `border-[#1f69ff] bg-[#eef4ff] ${choiceCardSelectedShadow}`
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
                        isSelected ? 'bg-white text-[#124ac4]' : 'bg-slate-200 text-slate-600'
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
      )}
    </div>
  );
}

function SocialLinks({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-sm text-slate-500 ${className}`.trim()}
    >
      <a
        href="https://x.com/send_fil"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium transition-colors hover:text-slate-900"
      >
        X
      </a>
      <span className="text-slate-300" aria-hidden="true">
        |
      </span>
      <a
        href="https://github.com/sendfil-io/sendfil"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium transition-colors hover:text-slate-900"
      >
        GitHub
      </a>
    </div>
  );
}

export default function App() {
  const e2eMockWallet = React.useMemo(
    () => ({
      enabled: E2E_MOCK_WALLET_ENABLED,
      address: E2E_MOCK_ACCOUNT,
      chainId: E2E_MOCK_CHAIN_ID,
    }),
    [],
  );
  const nativeFilecoinProviders = React.useMemo(() => getNativeFilecoinWalletProviders(), []);
  const [nativeFilecoinSender, setNativeFilecoinSender] = React.useState<
    NativeFilecoinConnectedSender | undefined
  >();
  const [nativeFilecoinProvider, setNativeFilecoinProvider] = React.useState<
    NativeFilecoinWalletProvider | undefined
  >();
  const [isNativeWalletTransitionInFlight, setIsNativeWalletTransitionInFlight] =
    React.useState(false);
  const [nativeWalletConnectionError, setNativeWalletConnectionError] = React.useState<
    string | undefined
  >();
  const connectedSenderState = useConnectedSender({
    e2eMockWallet,
    nativeFilecoinSender,
    nativeFilecoinProviders,
  });
  const {
    connectedSender,
    isConnected,
    address,
    chainId,
    connectedNetwork,
    hasSupportedConnectedNetwork,
    isUnsupportedConnectedNetwork,
    expectedNetworkPrefix,
    balanceSource,
    canUseLiveSendPath,
    liveSendPathUnavailableReason,
  } = connectedSenderState;
  const feeLabel = getFeeLabel(connectedNetwork?.chainId);
  const contractRecipientClient = usePublicClient({
    chainId: connectedNetwork?.chainId,
  });
  const evmBalanceSource = balanceSource.kind === 'evm-wagmi' ? balanceSource : undefined;
  const { data: balanceData } = useBalance({
    address: evmBalanceSource?.address,
    chainId: evmBalanceSource?.chainId,
    query: {
      enabled: Boolean(
        evmBalanceSource?.enabled && hasSupportedConnectedNetwork && !E2E_MOCK_WALLET_ENABLED,
      ),
    },
  });
  const nativeBalanceSource =
    balanceSource.kind === 'native-filecoin-lotus' ? balanceSource : undefined;
  const [nativeBalanceAttoFil, setNativeBalanceAttoFil] = React.useState<bigint | undefined>();
  const [nativeBalanceError, setNativeBalanceError] = React.useState<string | undefined>();

  React.useEffect(() => {
    let isCancelled = false;

    if (
      !nativeBalanceSource?.enabled ||
      !connectedSender ||
      connectedSender.kind !== 'native-filecoin'
    ) {
      setNativeBalanceAttoFil(undefined);
      setNativeBalanceError(undefined);
      return () => {
        isCancelled = true;
      };
    }

    setNativeBalanceAttoFil(undefined);
    setNativeBalanceError(undefined);

    getNativeFilecoinSenderBalanceAttoFil(connectedSender)
      .then((balance) => {
        if (!isCancelled) {
          setNativeBalanceAttoFil(balance);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setNativeBalanceError(
            error instanceof Error ? error.message : 'Native balance unavailable.',
          );
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    connectedSender,
    nativeBalanceSource?.address,
    nativeBalanceSource?.enabled,
    nativeBalanceSource?.networkKey,
  ]);

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
  const [multisigReviewContext, setMultisigReviewContext] = React.useState<MultisigReviewContext>();
  const [gasEstimate, setGasEstimate] = React.useState<GasEstimate | undefined>(undefined);
  const [isEstimatingGas, setIsEstimatingGas] = React.useState(false);
  const [gasEstimationError, setGasEstimationError] = React.useState<
    BatchExecutionError | undefined
  >(undefined);
  const [isCheckingContractRecipients, setIsCheckingContractRecipients] = React.useState(false);
  const [isStartingMultisigProposal, setIsStartingMultisigProposal] = React.useState(false);
  const [isStartingNativeBatch, setIsStartingNativeBatch] = React.useState(false);
  const [contractRecipientErrors, setContractRecipientErrors] = React.useState<string[]>([]);
  const contractRecipientCheckSequence = React.useRef(0);
  const gasEstimationSequence = React.useRef(0);
  const [batchConfiguration, setBatchConfiguration] = React.useState<BatchConfiguration>(
    DEFAULT_BATCH_CONFIGURATION,
  );
  const [isConfigureTransactionOpen, setIsConfigureTransactionOpen] = React.useState(false);
  const [unavailableCapabilityNotice, setUnavailableCapabilityNotice] =
    React.useState<UnavailableCapabilityNotice | null>(null);
  const batchExecutionAdapter = React.useMemo(
    () =>
      E2E_MOCK_WALLET_ENABLED
        ? createMockBatchExecutionAdapter({
            confirmationDelayMs: E2E_MOCK_SEND_DELAY_MS,
          })
        : undefined,
    [],
  );
  const evmBatchExecution = useExecuteBatch({
    adapter: batchExecutionAdapter,
  });
  const activeNativeSender =
    connectedSender?.kind === 'native-filecoin' ? connectedSender : undefined;
  const defaultMultisigNetwork = React.useMemo(() => getDefaultNetworkConfig(), []);
  const multisigNetwork = activeNativeSender?.network ?? connectedNetwork ?? defaultMultisigNetwork;
  const configurationNetwork = connectedNetwork ?? defaultMultisigNetwork;
  const maxUserRecipients =
    batchConfiguration.executionMethod === 'THINBATCH' && configurationNetwork.feePolicy.enabled
      ? DEFAULT_MAX_RECIPIENTS - 2
      : DEFAULT_MAX_RECIPIENTS;
  const multisigs = useMultisigs({
    sender: activeNativeSender,
    provider: nativeFilecoinProvider,
    network: multisigNetwork,
  });
  const refreshSelectedMultisig = multisigs.refreshSelected;
  const createMultisig = multisigs.createMultisig;
  const recheckCreateMultisig = multisigs.recheckCreateAction;
  const recheckMultisigProposalAction = multisigs.recheckProposalAction;
  const approveMultisigProposal = multisigs.approveProposal;
  const cancelMultisigProposal = multisigs.cancelProposal;
  const isMultisigFundingRequested = batchConfiguration.senderWalletType === 'MULTI_SIG';
  const isUsingNativeFundingPath =
    Boolean(activeNativeSender) || isMultisigFundingRequested;
  const unresolvedCreateAction =
    multisigs.createActionState?.status === 'uncertain'
      ? multisigs.createActionState
      : undefined;
  const unresolvedProposalAction =
    multisigs.proposalActionState?.status === 'uncertain'
      ? multisigs.proposalActionState
      : undefined;
  const isProposalActionRecoveryContextReady = Boolean(
    unresolvedProposalAction &&
      isMultisigFundingRequested &&
      activeNativeSender?.address === unresolvedProposalAction.signerAddress &&
      activeNativeSender.networkKey === unresolvedProposalAction.networkKey &&
      multisigs.selectedAddress === unresolvedProposalAction.multisigAddress,
  );
  const selectedMultisig =
    isMultisigFundingRequested &&
    !multisigs.isLoadingSelected &&
    multisigs.selectedAddress !== undefined &&
    multisigs.selectedMultisig?.address === multisigs.selectedAddress &&
    multisigs.selectedMultisig.networkKey === multisigNetwork.key
      ? multisigs.selectedMultisig
      : undefined;
  const selectedMultisigLabel = selectedMultisig
    ? multisigs.savedMultisigs.find((item) => item.address === selectedMultisig.address)?.label
    : undefined;

  const nativeBatchExecution = useExecuteNativeBatch({
    sender: activeNativeSender,
    provider: nativeFilecoinProvider,
  });
  const multisigBatchExecution = useExecuteMultisigProposal({
    sender: activeNativeSender,
    provider: nativeFilecoinProvider,
    multisig: selectedMultisig,
    network: multisigNetwork,
  });
  const activeBatchExecution = isMultisigFundingRequested
    ? multisigBatchExecution
    : activeNativeSender
      ? nativeBatchExecution
      : evmBatchExecution;
  const lockedNativeSubmissionSnapshot = multisigBatchExecution.isOperationLocked
    ? multisigBatchExecution.submissionSnapshot
    : nativeBatchExecution.isOperationLocked
      ? nativeBatchExecution.submissionSnapshot
      : undefined;
  const nativeSubmissionSnapshot =
    lockedNativeSubmissionSnapshot ??
    (isMultisigFundingRequested
      ? multisigBatchExecution.submissionSnapshot
      : activeNativeSender
        ? nativeBatchExecution.submissionSnapshot
        : undefined);
  const nativeSubmissionNetwork = nativeSubmissionSnapshot
    ? getNetworkConfig(nativeSubmissionSnapshot.networkKey)
    : undefined;
  const nativeSubmissionSafetyError =
    nativeBatchExecution.error?.title ===
      'Native submission safety storage is unavailable'
      ? nativeBatchExecution.error.message
      : multisigBatchExecution.error?.title ===
          'Native submission safety storage is unavailable'
        ? multisigBatchExecution.error.message
        : undefined;
  const isNativeSubmissionRecoveryRequired = Boolean(lockedNativeSubmissionSnapshot);
  const isNativeSubmissionContextReady = Boolean(
    nativeSubmissionSnapshot &&
      activeNativeSender?.address === nativeSubmissionSnapshot.signerAddress &&
      activeNativeSender.networkKey === nativeSubmissionSnapshot.networkKey &&
      (nativeSubmissionSnapshot.kind === 'native-batch'
        ? !isMultisigFundingRequested
        : isMultisigFundingRequested &&
          selectedMultisig?.address === nativeSubmissionSnapshot.multisigAddress),
  );
  const isNativeSubmissionRecoveryContextReady =
    isNativeSubmissionRecoveryRequired && isNativeSubmissionContextReady;
  const {
    estimateBatch,
    executeBatch,
    state: executionState,
    txHash: transactionHash,
    error: transactionError,
    reset: resetExecution,
  } = activeBatchExecution;
  const isViewingNativeSubmissionSnapshot = Boolean(
    isUsingNativeFundingPath &&
      nativeSubmissionSnapshot &&
      transactionHash === nativeSubmissionSnapshot.cid,
  );
  const hasInspectableNativeSubmissionOutcome = Boolean(
    !isNativeSubmissionRecoveryRequired &&
      isViewingNativeSubmissionSnapshot &&
      (executionState === 'confirmed' || executionState === 'failed'),
  );
  const reviewBatchConfiguration: BatchConfiguration =
    isViewingNativeSubmissionSnapshot && nativeSubmissionSnapshot
      ? {
          ...batchConfiguration,
          senderWalletType:
            nativeSubmissionSnapshot.kind === 'multisig-proposal'
              ? 'MULTI_SIG'
              : 'SINGLE_SIG',
          executionMethod: nativeSubmissionSnapshot.executionMethod,
          errorHandling: nativeSubmissionSnapshot.errorMode,
        }
      : batchConfiguration;
  const isMultisigBatchExecutionInFlight =
    isMultisigFundingRequested &&
    (executionState === 'building' || executionState === 'signing' || executionState === 'pending');
  const isMultisigBatchOutcomeUncertain = Boolean(
    isMultisigFundingRequested &&
    executionState === 'failed' &&
    transactionHash &&
    transactionError?.recoverable === false,
  );
  const isMultisigBatchExecutionLocked =
    isStartingMultisigProposal ||
    multisigBatchExecution.isOperationLocked ||
    isMultisigBatchExecutionInFlight ||
    isMultisigBatchOutcomeUncertain;
  const isNativeSingleSigBatchExecutionInFlight =
    !isMultisigFundingRequested &&
    Boolean(activeNativeSender) &&
    (executionState === 'building' || executionState === 'signing' || executionState === 'pending');
  const isNativeSingleSigBatchOutcomeUncertain = Boolean(
    !isMultisigFundingRequested &&
      activeNativeSender &&
      executionState === 'failed' &&
      transactionHash &&
      transactionError?.recoverable === false,
  );
  const isNativeSingleSigBatchExecutionLocked =
    isStartingNativeBatch ||
    nativeBatchExecution.isOperationLocked ||
    isNativeSingleSigBatchExecutionInFlight ||
    isNativeSingleSigBatchOutcomeUncertain;
  const isMultisigCreateActionInFlight = multisigs.isCreateActionInFlight;
  const isMultisigProposalActionInFlight = multisigs.isProposalActionInFlight;
  const isMultisigIdentityActionLocked =
    isMultisigBatchExecutionLocked ||
    isMultisigCreateActionInFlight ||
    isMultisigProposalActionInFlight;
  const isNativeActiveMutationOrSubmissionLocked =
    isMultisigIdentityActionLocked ||
    isNativeSingleSigBatchExecutionLocked ||
    nativeBatchExecution.isIdentityLocked ||
    multisigBatchExecution.isIdentityLocked;
  const isNativeIdentityActionLocked =
    isNativeActiveMutationOrSubmissionLocked ||
    multisigs.isCreateRetryBlocked ||
    multisigs.isProposalRetryBlocked;
  const isCreateWalletMutationUnsafe =
    multisigs.createActionState?.status === 'preparing' ||
    multisigs.createActionState?.status === 'signing' ||
    multisigs.createActionState?.status === 'submitting';
  const isProposalActionWalletMutationUnsafe =
    multisigs.proposalActionState?.status === 'preparing' ||
    multisigs.proposalActionState?.status === 'signing' ||
    multisigs.proposalActionState?.status === 'submitting';
  const isNativeWalletMutationUnsafe =
    isStartingNativeBatch ||
    isStartingMultisigProposal ||
    nativeBatchExecution.isWalletMutationUnsafe ||
    multisigBatchExecution.isWalletMutationUnsafe ||
    isCreateWalletMutationUnsafe ||
    isProposalActionWalletMutationUnsafe;
  const isNativeRecoveryNavigationLocked =
    isNativeWalletMutationUnsafe || isNativeWalletTransitionInFlight;
  const nativeIdentityActionLockRef = React.useRef(isNativeIdentityActionLocked);
  const nativeWalletMutationUnsafeRef = React.useRef(isNativeWalletMutationUnsafe);
  const multisigCreateInvocationRef = React.useRef(false);
  const multisigProposalInvocationRef = React.useRef(false);
  const nativeBatchInvocationRef = React.useRef(false);
  const nativeSubmissionEpoch = React.useRef(0);
  const nativeWalletTransitionRef = React.useRef(false);
  nativeIdentityActionLockRef.current = isNativeIdentityActionLocked;
  nativeWalletMutationUnsafeRef.current = isNativeWalletMutationUnsafe;
  const lastRefreshedProposalCid = React.useRef<string | undefined>(undefined);
  const submittedMultisigIdentity = React.useRef<
    | {
        address: string;
        networkKey: typeof multisigNetwork.key;
      }
    | undefined
  >(undefined);

  React.useEffect(() => {
    if (
      isMultisigFundingRequested &&
      executionState === 'confirmed' &&
      !isReviewModalOpen &&
      transactionHash &&
      submittedMultisigIdentity.current?.address === multisigs.selectedAddress &&
      submittedMultisigIdentity.current?.networkKey === multisigNetwork.key &&
      lastRefreshedProposalCid.current !== transactionHash
    ) {
      lastRefreshedProposalCid.current = transactionHash;
      void refreshSelectedMultisig();
    }
  }, [
    executionState,
    isMultisigFundingRequested,
    isReviewModalOpen,
    multisigNetwork.key,
    multisigs.selectedAddress,
    refreshSelectedMultisig,
    transactionHash,
  ]);

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

  const handleNativeWalletConnect = React.useCallback(
    async (
      provider: NativeFilecoinWalletProvider,
      networkKey: NativeFilecoinConnectedSender['networkKey'],
    ) => {
      if (
        nativeWalletMutationUnsafeRef.current ||
        nativeWalletTransitionRef.current
      ) {
        return;
      }

      const submissionEpochAtStart = nativeSubmissionEpoch.current;
      nativeWalletTransitionRef.current = true;
      setIsNativeWalletTransitionInFlight(true);

      try {
        setNativeWalletConnectionError(undefined);
        const account = await provider.connect({ networkKey });

        if (
          nativeWalletMutationUnsafeRef.current ||
          nativeSubmissionEpoch.current !== submissionEpochAtStart
        ) {
          setNativeWalletConnectionError(
            'The wallet changed while a native Filecoin action was being submitted. SendFIL preserved its status; reconnect after inspecting it.',
          );
          return;
        }

        const senderResult = createNativeFilecoinConnectedSender({
          address: account.address,
          provider: provider.metadata,
          expectedNetworkKey: account.networkKey,
        });

        if (!senderResult.sender) {
          await provider.disconnect();
          throw new Error(senderResult.error ?? 'Native Filecoin sender is not supported.');
        }

        resetExecution();
        setNativeFilecoinProvider(provider);
        setNativeFilecoinSender(senderResult.sender);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to connect native Filecoin wallet.';

        setNativeWalletConnectionError(message);
        throw error;
      } finally {
        nativeWalletTransitionRef.current = false;
        setIsNativeWalletTransitionInFlight(false);
      }
    },
    [resetExecution],
  );

  const handleNativeWalletDisconnect = React.useCallback(async () => {
    if (
      nativeWalletMutationUnsafeRef.current ||
      nativeWalletTransitionRef.current
    ) {
      return;
    }

    const submissionEpochAtStart = nativeSubmissionEpoch.current;
    nativeWalletTransitionRef.current = true;
    setIsNativeWalletTransitionInFlight(true);
    setNativeWalletConnectionError(undefined);

    try {
      if (nativeFilecoinProvider) {
        await nativeFilecoinProvider.disconnect();
      }

      if (
        nativeWalletMutationUnsafeRef.current ||
        nativeSubmissionEpoch.current !== submissionEpochAtStart
      ) {
        setNativeWalletConnectionError(
          'The wallet disconnected while a native Filecoin action was being submitted. SendFIL preserved its status; reconnect after inspecting it.',
        );
        return;
      }

      resetExecution();
      setNativeFilecoinProvider(undefined);
      setNativeFilecoinSender(undefined);
    } catch (error) {
      setNativeWalletConnectionError(
        error instanceof Error ? error.message : 'Failed to disconnect native Filecoin wallet.',
      );
      throw error;
    } finally {
      nativeWalletTransitionRef.current = false;
      setIsNativeWalletTransitionInFlight(false);
    }
  }, [nativeFilecoinProvider, resetExecution]);

  const handleCreateMultisig = React.useCallback(
    async (values: CreateMultisigFormValues): Promise<CreateMultisigResult> => {
      if (
        nativeIdentityActionLockRef.current ||
        multisigCreateInvocationRef.current ||
        multisigProposalInvocationRef.current ||
        nativeBatchInvocationRef.current ||
        nativeWalletTransitionRef.current
      ) {
        throw new Error('Wait for the current wallet or multisig action to finish.');
      }

      multisigCreateInvocationRef.current = true;
      nativeWalletMutationUnsafeRef.current = true;
      nativeSubmissionEpoch.current += 1;

      try {
        return await createMultisig(values);
      } finally {
        multisigCreateInvocationRef.current = false;
        nativeWalletMutationUnsafeRef.current = false;
      }
    },
    [createMultisig],
  );

  const runMultisigProposalAction = React.useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      if (
        nativeIdentityActionLockRef.current ||
        multisigCreateInvocationRef.current ||
        multisigProposalInvocationRef.current ||
        nativeBatchInvocationRef.current ||
        nativeWalletTransitionRef.current
      ) {
        throw new Error('Wait for the current wallet or multisig action to finish.');
      }

      multisigProposalInvocationRef.current = true;
      nativeWalletMutationUnsafeRef.current = true;
      nativeSubmissionEpoch.current += 1;

      try {
        return await action();
      } finally {
        multisigProposalInvocationRef.current = false;
        nativeWalletMutationUnsafeRef.current = false;
      }
    },
    [],
  );

  const handleApproveMultisigProposal = React.useCallback(
    (
      proposal: MultisigPendingProposal,
      acknowledgeDuplicatePayments?: boolean,
    ) =>
      runMultisigProposalAction(() =>
        approveMultisigProposal(proposal, acknowledgeDuplicatePayments),
      ),
    [approveMultisigProposal, runMultisigProposalAction],
  );

  const handleCancelMultisigProposal = React.useCallback(
    (proposal: MultisigPendingProposal) =>
      runMultisigProposalAction(() => cancelMultisigProposal(proposal)),
    [cancelMultisigProposal, runMultisigProposalAction],
  );

  const openUnavailableCapabilityNotice = (title: string, description: string) => {
    setUnavailableCapabilityNotice({ title, description });
  };

  const handleSenderWalletTypeSelect = (value: SenderWalletType) => {
    if (
      nativeWalletMutationUnsafeRef.current ||
      nativeWalletTransitionRef.current
    ) {
      return;
    }

    setBatchConfiguration((current) => ({ ...current, senderWalletType: value }));
  };

  const handleExecutionMethodSelect = (value: ExecutionMethod) => {
    if (
      (isUsingNativeFundingPath && nativeIdentityActionLockRef.current) ||
      nativeWalletTransitionRef.current
    ) {
      return;
    }

    if (value === 'STANDARD' && batchConfiguration.errorHandling === 'PARTIAL') {
      openUnavailableCapabilityNotice(
        'Partial requires ThinBatch',
        'Standard batches are all-or-nothing. Select Atomic for Standard, or keep ThinBatch for best-effort delivery.',
      );
      return;
    }

    if (value === 'THINBATCH' && !configurationNetwork.thinBatchAddress) {
      openUnavailableCapabilityNotice(
        'ThinBatch is unavailable on this network',
        'Use Standard for this batch, or switch to a supported network where ThinBatch is available.',
      );
      return;
    }

    setBatchConfiguration((current) => ({ ...current, executionMethod: value }));
  };

  const handleErrorHandlingSelect = (value: ErrorHandlingPreference) => {
    if (
      (isUsingNativeFundingPath && nativeIdentityActionLockRef.current) ||
      nativeWalletTransitionRef.current
    ) {
      return;
    }

    if (value === 'PARTIAL' && batchConfiguration.executionMethod === 'STANDARD') {
      openUnavailableCapabilityNotice(
        'Partial requires ThinBatch',
        'Partial sends are only available with ThinBatch. Switch the transaction method to ThinBatch before choosing Partial.',
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
    setManualInteractions((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    setManualRecipients((current) => {
      const nextRecipients = [...current];
      nextRecipients[index] = { ...nextRecipients[index], [field]: value };
      return nextRecipients;
    });
  };

  const markRecipientTouched = (index: number, field: keyof ManualRecipientInteraction) => {
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
        expectedNetworkPrefix,
        maxRecipients: maxUserRecipients,
        requireAtLeastOneRecipient: false,
      }),
    [expectedNetworkPrefix, manualRecipients, maxUserRecipients],
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

  const csvValidation = React.useMemo(
    () =>
      csvData.length > 0
        ? validateRecipientRows(csvRecipients, {
            source: 'csv',
            expectedNetworkPrefix,
            maxRecipients: maxUserRecipients,
            requireAtLeastOneRecipient: true,
          })
        : createEmptyRecipientValidationResult(),
    [csvData.length, csvRecipients, expectedNetworkPrefix, maxUserRecipients],
  );

  const hasEnteredData =
    inputMode === 'manual'
      ? manualValidation.nonEmptyRowCount > 0
      : csvData.length > 0 || csvErrors.length > 0 || csvWarnings.length > 0;

  const selectedErrorMode = batchConfiguration.errorHandling;
  const selectedExecutionMethod = batchConfiguration.executionMethod;
  const isNetworkMismatch = isUnsupportedConnectedNetwork;
  const networkValidationErrors =
    isNetworkMismatch && hasEnteredData
      ? [`Switch to ${getSupportedNetworkListLabel()} to review and send this batch.`]
      : [];
  const executionConfigurationErrors =
    selectedExecutionMethod === 'STANDARD' && selectedErrorMode === 'PARTIAL'
      ? [
          'Partial is only available with ThinBatch. Select Atomic or switch the transaction method to ThinBatch.',
        ]
      : selectedExecutionMethod === 'THINBATCH' &&
          connectedNetwork &&
          !connectedNetwork.thinBatchAddress
        ? [
            `ThinBatch is unavailable on ${connectedNetwork.chainName}. Switch back to Standard for this batch.`,
          ]
        : [];
  const multisigFundingErrors = isMultisigFundingRequested
    ? !activeNativeSender
      ? ['Connect a native Filecoin f1/t1 signer before using multisig funding.']
      : multisigs.selectedError
        ? [multisigs.selectedError]
        : !multisigs.selectedAddress
          ? ['Add or select an f2/t2 multisig before proposing this batch.']
          : multisigs.isLoadingSelected
            ? ['Selected multisig state is still loading.']
            : !selectedMultisig
              ? ['Selected multisig state is not current. Refresh it before proposing.']
              : !selectedMultisig.connectedSignerCanApprove
                ? ['The connected native signer is not a signer on the selected multisig.']
                : []
    : [];
  const displayedMultisigFundingErrors = hasEnteredData ? multisigFundingErrors : [];

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

  const validRecipients = React.useMemo(
    () =>
      (inputMode === 'manual'
        ? manualValidation.validRecipients
        : csvValidation.validRecipients
      ).map((recipient) => ({
        address: recipient.address,
        amount: Number(recipient.amount),
      })),
    [csvValidation.validRecipients, inputMode, manualValidation.validRecipients],
  );

  const feeComputation = React.useMemo(() => {
    if (validRecipients.length === 0) {
      return {
        recipients: validRecipients,
        feeTotal: 0,
        error: undefined as string | undefined,
      };
    }

    if (!connectedNetwork) {
      return {
        recipients: validRecipients,
        feeTotal: 0,
        error: undefined as string | undefined,
      };
    }

    try {
      const recipientsWithFees = calculateFeeRows(validRecipients, connectedNetwork);

      return {
        recipients: recipientsWithFees,
        feeTotal: recipientsWithFees
          .slice(validRecipients.length)
          .reduce((sum, row) => sum + row.amount, 0),
        error: undefined as string | undefined,
      };
    } catch (error) {
      return {
        recipients: validRecipients,
        feeTotal: 0,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to calculate the platform fee rows for this batch.',
      };
    }
  }, [connectedNetwork, validRecipients]);

  React.useEffect(() => {
    contractRecipientCheckSequence.current += 1;
    setContractRecipientErrors([]);
    setIsCheckingContractRecipients(false);
  }, [connectedNetwork?.chainId, feeComputation.recipients]);

  const checkEvmContractRecipients = React.useCallback(async (): Promise<string[]> => {
    const checkId = contractRecipientCheckSequence.current + 1;
    contractRecipientCheckSequence.current = checkId;

    if (E2E_MOCK_WALLET_ENABLED) {
      setContractRecipientErrors([]);
      setIsCheckingContractRecipients(false);
      return [];
    }

    setIsCheckingContractRecipients(true);

    try {
      const errors = await validateNoEvmContractRecipients(
        feeComputation.recipients,
        contractRecipientClient,
      );

      if (contractRecipientCheckSequence.current === checkId) {
        setContractRecipientErrors(errors);
      }

      return errors;
    } finally {
      if (contractRecipientCheckSequence.current === checkId) {
        setIsCheckingContractRecipients(false);
      }
    }
  }, [contractRecipientClient, feeComputation.recipients]);

  const activeValidationErrors =
    inputMode === 'manual'
      ? [
          ...manualDisplayErrors,
          ...(feeComputation.error ? [feeComputation.error] : []),
          ...networkValidationErrors,
          ...executionConfigurationErrors,
          ...displayedMultisigFundingErrors,
          ...contractRecipientErrors,
        ]
      : [
          ...csvErrors,
          ...csvValidation.errors,
          ...(feeComputation.error ? [feeComputation.error] : []),
          ...networkValidationErrors,
          ...executionConfigurationErrors,
          ...displayedMultisigFundingErrors,
          ...contractRecipientErrors,
        ];
  const activeBlockingValidationErrors =
    inputMode === 'manual'
      ? [
          ...manualValidation.errors,
          ...(feeComputation.error ? [feeComputation.error] : []),
          ...networkValidationErrors,
          ...executionConfigurationErrors,
          ...multisigFundingErrors,
          ...contractRecipientErrors,
        ]
      : activeValidationErrors;
  const activeValidationWarnings =
    inputMode === 'manual'
      ? manualValidation.warnings
      : [...csvWarnings, ...csvValidation.warnings];

  const draftRecipientCount =
    inputMode === 'manual' ? manualValidation.nonEmptyRowCount : csvValidation.nonEmptyRowCount;
  const hasReviewableRows = draftRecipientCount > 0;

  const recipientTotal = validRecipients.reduce((sum, recipient) => sum + recipient.amount, 0);
  const feeTotal = feeComputation.feeTotal;

  const singleSignerWalletBalance = E2E_MOCK_WALLET_ENABLED
    ? E2E_MOCK_BALANCE_FIL
    : balanceData
      ? Number(formatUnits(balanceData.value, balanceData.decimals))
      : nativeBalanceAttoFil !== undefined
        ? attoFilBigIntToFil(nativeBalanceAttoFil)
        : 0;
  const multisigSpendableBalance =
    selectedMultisig !== undefined
      ? attoFilBigIntToFil(selectedMultisig.availableBalanceAttoFil)
      : 0;
  const signerGasBalance =
    nativeBalanceAttoFil !== undefined ? attoFilBigIntToFil(nativeBalanceAttoFil) : 0;
  const reviewMultisigSpendableBalance =
    multisigReviewContext?.spendableBalanceFil ?? multisigSpendableBalance;
  const walletBalance = isMultisigFundingRequested
    ? reviewMultisigSpendableBalance
    : singleSignerWalletBalance;
  const nativeBalanceLabel =
    nativeBalanceAttoFil !== undefined
      ? formatWalletBalanceLabel(attoFilBigIntToFil(nativeBalanceAttoFil))
      : nativeBalanceError
        ? 'Balance unavailable'
        : activeNativeSender
          ? 'Balance loading'
          : undefined;
  const estimatedNetworkFee = gasEstimate?.estimatedFeeInFil || 0;
  const insufficientBalance = isMultisigFundingRequested
    ? reviewMultisigSpendableBalance < recipientTotal + feeTotal ||
      signerGasBalance < estimatedNetworkFee
    : walletBalance < recipientTotal + feeTotal + estimatedNetworkFee;

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

  const canInspectLockedNativeBatch =
    (hasInspectableNativeSubmissionOutcome && isNativeSubmissionContextReady) ||
    ((isMultisigBatchExecutionLocked || isNativeSingleSigBatchExecutionLocked) &&
      (!isNativeSubmissionRecoveryRequired ||
        isNativeSubmissionRecoveryContextReady));
  const canOpenCreateRecovery = Boolean(
    unresolvedCreateAction &&
      !isMultisigFundingRequested &&
      activeNativeSender?.address === unresolvedCreateAction.signerAddress &&
      activeNativeSender.networkKey === unresolvedCreateAction.networkKey &&
      !isNativeRecoveryNavigationLocked,
  );
  const reviewDisabled =
    canOpenCreateRecovery
      ? false
      : (isUsingNativeFundingPath &&
          (isMultisigCreateActionInFlight || isMultisigProposalActionInFlight)) ||
        isNativeWalletTransitionInFlight ||
        (canInspectLockedNativeBatch
          ? false
          : (isUsingNativeFundingPath && isNativeIdentityActionLocked) ||
            !isConnected ||
            !canUseLiveSendPath ||
            isNetworkMismatch ||
            !hasReviewableRows);
  const transactionState: TransactionState =
    executionState === 'idle'
      ? 'review'
      : executionState === 'building'
        ? 'signing'
        : executionState;

  const reviewHint = React.useMemo(() => {
    if (
      isUsingNativeFundingPath &&
      lockedNativeSubmissionSnapshot &&
      !isNativeSubmissionRecoveryContextReady
    ) {
      const operation =
        lockedNativeSubmissionSnapshot.kind === 'multisig-proposal'
          ? 'multisig proposal'
          : 'native batch';

      return `Restore the recorded signer${
        lockedNativeSubmissionSnapshot.kind === 'multisig-proposal'
          ? ' and multisig'
          : ''
      } to recheck the unresolved ${operation} CID.`;
    }

    if (hasInspectableNativeSubmissionOutcome && nativeSubmissionSnapshot) {
      const operation =
        nativeSubmissionSnapshot.kind === 'multisig-proposal'
          ? 'proposal'
          : 'native batch';

      return `The submitted ${operation} reached a terminal result. Open it to inspect the exact CID.`;
    }

    if (isUsingNativeFundingPath && isMultisigCreateActionInFlight) {
      return 'A multisig creation is in progress. Wait for its result before reviewing a batch.';
    }

    if (isUsingNativeFundingPath && isMultisigProposalActionInFlight) {
      return 'A multisig approval or cancellation is in progress. Wait for its result before reviewing a batch.';
    }

    if (isUsingNativeFundingPath && multisigs.uncertaintyStorageError) {
      return 'Restore native multisig safety storage before preparing another native submission.';
    }

    if (
      isUsingNativeFundingPath &&
      multisigs.createActionState?.status === 'uncertain'
    ) {
      return 'Recheck the unresolved multisig creation before preparing another native submission.';
    }

    if (
      isUsingNativeFundingPath &&
      multisigs.proposalActionState?.status === 'uncertain'
    ) {
      return 'Recheck the unresolved multisig approval or cancellation before preparing another native submission.';
    }

    if (
      isUsingNativeFundingPath &&
      (multisigs.isCreateRetryBlocked || multisigs.isProposalRetryBlocked)
    ) {
      return 'Resolve the recorded multisig action before preparing another native submission.';
    }

    if (isMultisigBatchExecutionInFlight) {
      return 'A multisig proposal is in progress. Reopen it to view confirmation status.';
    }

    if (isMultisigBatchOutcomeUncertain) {
      return 'The submitted proposal needs manual inspection before another batch can be sent.';
    }

    if (isNativeSingleSigBatchExecutionInFlight) {
      return 'A native batch is in progress. Reopen it to view confirmation status.';
    }

    if (
      isUsingNativeFundingPath &&
      (isNativeSingleSigBatchOutcomeUncertain || nativeBatchExecution.isOperationLocked)
    ) {
      return 'The submitted native batch needs CID reconciliation before another batch can be sent.';
    }

    if (isNativeWalletTransitionInFlight) {
      return 'Wait for the native wallet connection or network update to finish.';
    }

    if (!isConnected) {
      return 'Connect a wallet to review transaction';
    }

    if (isNetworkMismatch) {
      return `Switch to ${getSupportedNetworkListLabel()} before continuing.`;
    }

    if (!canUseLiveSendPath) {
      return liveSendPathUnavailableReason ?? 'The connected sender cannot review or send yet.';
    }

    if (!hasReviewableRows) {
      return inputMode === 'manual'
        ? 'Add at least one recipient to continue.'
        : 'Upload a CSV file to continue.';
    }

    if (
      inputMode === 'manual' &&
      manualIncompleteRowCount > 0 &&
      activeValidationErrors.length === 0
    ) {
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
    hasInspectableNativeSubmissionOutcome,
    inputMode,
    canUseLiveSendPath,
    isConnected,
    isUsingNativeFundingPath,
    isNativeSubmissionRecoveryContextReady,
    isMultisigCreateActionInFlight,
    isMultisigProposalActionInFlight,
    multisigs.isCreateRetryBlocked,
    multisigs.isProposalRetryBlocked,
    multisigs.createActionState?.status,
    multisigs.proposalActionState?.status,
    multisigs.uncertaintyStorageError,
    isNativeWalletTransitionInFlight,
    isMultisigBatchExecutionInFlight,
    isMultisigBatchOutcomeUncertain,
    isNativeSingleSigBatchExecutionInFlight,
    isNativeSingleSigBatchOutcomeUncertain,
    nativeBatchExecution.isOperationLocked,
    lockedNativeSubmissionSnapshot,
    nativeSubmissionSnapshot,
    isNetworkMismatch,
    liveSendPathUnavailableReason,
    manualIncompleteRowCount,
  ]);

  const handleNativeSubmissionRecheck = React.useCallback(async () => {
    if (!lockedNativeSubmissionSnapshot || !isNativeSubmissionRecoveryContextReady) {
      return;
    }

    try {
      if (lockedNativeSubmissionSnapshot.kind === 'multisig-proposal') {
        await multisigBatchExecution.recheck();
      } else {
        await nativeBatchExecution.recheck();
      }
    } catch (error) {
      setNativeWalletConnectionError(
        error instanceof Error
          ? error.message
          : 'SendFIL could not recheck the submitted native message.',
      );
    }
  }, [
    isNativeSubmissionRecoveryContextReady,
    lockedNativeSubmissionSnapshot,
    multisigBatchExecution,
    nativeBatchExecution,
  ]);

  const handleReview = async () => {
    if (
      (isUsingNativeFundingPath &&
        (isMultisigCreateActionInFlight || isMultisigProposalActionInFlight)) ||
      multisigCreateInvocationRef.current ||
      multisigProposalInvocationRef.current ||
      nativeBatchInvocationRef.current
    ) {
      return;
    }

    if (
      hasInspectableNativeSubmissionOutcome &&
      isNativeSubmissionContextReady
    ) {
      setIsReviewModalOpen(true);
      return;
    }

    if (
    isNativeSubmissionRecoveryRequired &&
      isUsingNativeFundingPath &&
      !isNativeSubmissionRecoveryContextReady
    ) {
      return;
    }

    if (isUsingNativeFundingPath && isMultisigBatchExecutionLocked) {
      setIsReviewModalOpen(true);
      if (isMultisigBatchOutcomeUncertain) {
        await handleNativeSubmissionRecheck();
      }
      return;
    }

    if (isUsingNativeFundingPath && isNativeSingleSigBatchExecutionLocked) {
      setIsReviewModalOpen(true);
      if (isNativeSingleSigBatchOutcomeUncertain) {
        await handleNativeSubmissionRecheck();
      }
      return;
    }

    if (isNativeWalletTransitionInFlight) {
      return;
    }

    if (
      !isConnected ||
      !canUseLiveSendPath ||
      !address ||
      isNativeWalletTransitionInFlight ||
      isNetworkMismatch ||
      !hasReviewableRows
    ) {
      return;
    }

    const estimationId = gasEstimationSequence.current + 1;
    gasEstimationSequence.current = estimationId;
    setIsEstimatingGas(false);

    if (isMultisigFundingRequested) {
      setMultisigReviewContext({
        address: selectedMultisig?.address ?? multisigs.selectedAddress,
        label: selectedMultisigLabel ?? 'Selected multisig',
        chainId: multisigNetwork.chainId,
        networkLabel: multisigNetwork.walletLabel,
        signerAddress: activeNativeSender?.address,
        threshold: selectedMultisig?.threshold,
        signerCount: selectedMultisig?.signers.length,
        spendableBalanceFil: selectedMultisig
          ? attoFilBigIntToFil(selectedMultisig.availableBalanceAttoFil)
          : 0,
      });
    } else {
      setMultisigReviewContext(undefined);
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

    resetExecution();
    setGasEstimate(undefined);
    setGasEstimationError(undefined);
    setIsReviewModalOpen(true);

    if (activeBlockingValidationErrors.length > 0) {
      return;
    }

    setIsEstimatingGas(true);

    if (isMultisigFundingRequested) {
      const refreshedMultisig = await refreshSelectedMultisig();

      if (gasEstimationSequence.current !== estimationId) {
        return;
      }

      if (
        !refreshedMultisig ||
        refreshedMultisig.address !== multisigs.selectedAddress ||
        refreshedMultisig.networkKey !== multisigNetwork.key ||
        !refreshedMultisig.connectedSignerCanApprove
      ) {
        setIsEstimatingGas(false);
        return;
      }

      setMultisigReviewContext({
        address: refreshedMultisig.address,
        label: selectedMultisigLabel ?? 'Selected multisig',
        chainId: multisigNetwork.chainId,
        networkLabel: multisigNetwork.walletLabel,
        signerAddress: activeNativeSender?.address,
        threshold: refreshedMultisig.threshold,
        signerCount: refreshedMultisig.signers.length,
        spendableBalanceFil: attoFilBigIntToFil(refreshedMultisig.availableBalanceAttoFil),
      });
    }

    const contractErrors = await checkEvmContractRecipients();

    if (gasEstimationSequence.current !== estimationId) {
      return;
    }

    if (contractErrors.length > 0) {
      setIsEstimatingGas(false);
      return;
    }

    if (E2E_SKIP_GAS_ESTIMATION && !batchExecutionAdapter) {
      if (gasEstimationSequence.current === estimationId) {
        setGasEstimate(createFallbackReviewGasEstimate(feeComputation.recipients.length));
        setIsEstimatingGas(false);
      }
      return;
    }

    if (validRecipients.length > 0) {
      try {
        const estimate = await estimateBatch(
          feeComputation.recipients,
          selectedErrorMode,
          selectedExecutionMethod,
        );
        if (gasEstimationSequence.current === estimationId) {
          setGasEstimate(toReviewGasEstimate(estimate));
        }
      } catch (error) {
        if (gasEstimationSequence.current === estimationId) {
          setGasEstimationError(
            error instanceof BatchExecutionError
              ? error
              : new BatchExecutionError({
                  category: 'UNKNOWN',
                  title: 'Batch preflight failed',
                  message: 'SendFIL could not estimate this batch with the current inputs.',
                  errorMode: selectedErrorMode,
                  stage: 'preflight',
                  recoverable: true,
                  hint: 'Review the batch inputs and retry the estimate.',
                  details: error instanceof Error ? error.message : 'Unknown error',
                  cause: error,
                }),
          );
        }
      } finally {
        if (gasEstimationSequence.current === estimationId) {
          setIsEstimatingGas(false);
        }
      }
    }
  };

  const handleCloseReviewModal = () => {
    if (transactionState === 'signing') {
      return;
    }

    gasEstimationSequence.current += 1;
    contractRecipientCheckSequence.current += 1;
    setIsEstimatingGas(false);
    setIsCheckingContractRecipients(false);
    setIsReviewModalOpen(false);

    if (!isMultisigBatchExecutionLocked) {
      setMultisigReviewContext(undefined);
    }

    if (
      isMultisigFundingRequested &&
      transactionState === 'confirmed' &&
      transactionHash &&
      submittedMultisigIdentity.current?.address === multisigs.selectedAddress &&
      submittedMultisigIdentity.current?.networkKey === multisigNetwork.key &&
      lastRefreshedProposalCid.current !== transactionHash
    ) {
      lastRefreshedProposalCid.current = transactionHash;
      void refreshSelectedMultisig();
    }

    if (transactionState !== 'pending') {
      resetExecution();
    }
  };

  const handleConfirmTransaction = async () => {
    if (
      (isUsingNativeFundingPath && nativeIdentityActionLockRef.current) ||
      multisigCreateInvocationRef.current ||
      multisigProposalInvocationRef.current ||
      nativeBatchInvocationRef.current ||
      nativeWalletTransitionRef.current ||
      !isConnected ||
      !canUseLiveSendPath ||
      !address ||
      isNetworkMismatch ||
      (isMultisigFundingRequested && !selectedMultisig) ||
      activeBlockingValidationErrors.length > 0
    ) {
      return;
    }

    const isNativeSubmission = Boolean(activeNativeSender);
    const isNativeSingleSigSubmission = Boolean(
      isNativeSubmission && !isMultisigFundingRequested,
    );

    if (isNativeSubmission) {
      nativeBatchInvocationRef.current = true;
      nativeWalletMutationUnsafeRef.current = true;
      nativeSubmissionEpoch.current += 1;
    }

    if (isMultisigFundingRequested) {
      setIsStartingMultisigProposal(true);
    } else if (isNativeSingleSigSubmission) {
      setIsStartingNativeBatch(true);
    }

    try {
      const contractErrors = await checkEvmContractRecipients();

      if (contractErrors.length > 0) {
        return;
      }

      submittedMultisigIdentity.current =
        isMultisigFundingRequested && selectedMultisig
          ? {
              address: selectedMultisig.address,
              networkKey: selectedMultisig.networkKey,
            }
          : undefined;

      await executeBatch(feeComputation.recipients, selectedErrorMode, selectedExecutionMethod);
    } catch {
      // useExecuteBatch stores the failure state used by the modal
    } finally {
      setIsStartingMultisigProposal(false);
      if (isNativeSubmission) {
        nativeBatchInvocationRef.current = false;
        nativeWalletMutationUnsafeRef.current = false;
      }
      if (isNativeSingleSigSubmission) {
        setIsStartingNativeBatch(false);
      }
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
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="flex flex-col border-b border-slate-200/80 bg-white/90 px-5 pb-6 pt-0 backdrop-blur lg:w-72 lg:border-b-0 lg:border-r lg:px-6 lg:pb-8">
          <div className="-mx-5 mb-8 flex items-center justify-center bg-gradient-to-r from-[#1F69FF] via-[#22A6E2] to-[#3CD4A0] px-5 py-[26px] lg:-mx-6 lg:px-6">
            <img
              src="/sendfil-wordmark.png"
              alt="SendFIL"
              className="h-10 w-auto select-none"
              draggable={false}
            />
          </div>

          <CustomConnectButton
            disabled={isNativeRecoveryNavigationLocked}
            nativeFilecoin={{
              providers: nativeFilecoinProviders,
              connectedSender: activeNativeSender,
              balanceLabel: nativeBalanceLabel,
              connectionError: nativeWalletConnectionError,
              onConnect: handleNativeWalletConnect,
              onDisconnect: handleNativeWalletDisconnect,
              onClearConnectionError: () => setNativeWalletConnectionError(undefined),
            }}
          />

          {lockedNativeSubmissionSnapshot && nativeSubmissionNetwork && (
            <div
              className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950"
              data-testid="native-submission-recovery"
              role="status"
            >
              <p className="font-semibold">
                Unresolved{' '}
                {lockedNativeSubmissionSnapshot.kind === 'multisig-proposal'
                  ? 'multisig proposal'
                  : 'native batch'}
              </p>
              <p className="mt-1 leading-5">
                New native submissions are blocked until this exact CID reaches a proven
                terminal result.
              </p>
              <dl className="mt-2 space-y-1">
                <div>
                  <dt className="inline font-semibold">Network: </dt>
                  <dd className="inline">{nativeSubmissionNetwork.walletLabel}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Signer</dt>
                  <dd className="break-all font-mono">
                    {lockedNativeSubmissionSnapshot.signerAddress}
                  </dd>
                </div>
                {lockedNativeSubmissionSnapshot.kind === 'multisig-proposal' && (
                  <div>
                    <dt className="font-semibold">Multisig</dt>
                    <dd className="break-all font-mono">
                      {lockedNativeSubmissionSnapshot.multisigAddress}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="font-semibold">CID</dt>
                  <dd className="break-all font-mono">
                    {lockedNativeSubmissionSnapshot.cid}
                  </dd>
                </div>
              </dl>
              <a
                href={getFilfoxMessageUrl(
                  lockedNativeSubmissionSnapshot.cid,
                  nativeSubmissionNetwork.chainId,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-semibold underline underline-offset-2"
              >
                Inspect exact CID on Filfox ↗
              </a>
              {!isNativeSubmissionRecoveryContextReady && (
                <p className="mt-2 leading-5">
                  Connect the recorded signer
                  {lockedNativeSubmissionSnapshot.kind === 'multisig-proposal'
                    ? ', select Multi-sig, and select the recorded multisig'
                    : ' and select Single-sig'}{' '}
                  to recheck it here.
                </p>
              )}
            </div>
          )}

          {!lockedNativeSubmissionSnapshot && nativeSubmissionSafetyError && (
            <div
              className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-900"
              role="alert"
              data-testid="native-submission-storage-error"
            >
              <p className="font-semibold">Native submission safety lock unavailable</p>
              <p className="mt-1">{nativeSubmissionSafetyError}</p>
              <p className="mt-1">
                New native submissions remain blocked. Restore browser storage access and
                inspect recent wallet messages before retrying.
              </p>
            </div>
          )}

          {multisigs.uncertaintyStorageError && (
            <div
              className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-900"
              role="alert"
              data-testid="native-action-storage-error"
            >
              <p className="font-semibold">Multisig action safety lock unavailable</p>
              <p className="mt-1">{multisigs.uncertaintyStorageError}</p>
              <p className="mt-1">
                Native create, approve, cancel, and batch submissions remain blocked until
                browser storage is restored. EVM wallet sends remain available.
              </p>
            </div>
          )}

          {unresolvedProposalAction && !isProposalActionRecoveryContextReady && (
            <div
              className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950"
              role="status"
              data-testid="multisig-action-recovery"
            >
              <p className="font-semibold">
                Unresolved multisig {unresolvedProposalAction.action}
              </p>
              <p className="mt-1">
                Reconnect the recorded signer, select Multi-sig, and select the recorded actor
                before rechecking this exact message.
              </p>
              <dl className="mt-2 space-y-1">
                <div>
                  <dt className="inline font-semibold">Network: </dt>
                  <dd className="inline">{unresolvedProposalAction.networkLabel}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Signer</dt>
                  <dd className="break-all font-mono">
                    {unresolvedProposalAction.signerAddress}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Multisig</dt>
                  <dd className="break-all font-mono">
                    {unresolvedProposalAction.multisigAddress}
                  </dd>
                </div>
                {unresolvedProposalAction.cid && (
                  <div>
                    <dt className="font-semibold">CID</dt>
                    <dd className="break-all font-mono">{unresolvedProposalAction.cid}</dd>
                  </div>
                )}
              </dl>
              {unresolvedProposalAction.cid && (
                <a
                  href={getFilfoxMessageUrl(
                    unresolvedProposalAction.cid,
                    unresolvedProposalAction.chainId,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-semibold underline underline-offset-2"
                >
                  Inspect exact action CID on Filfox ↗
                </a>
              )}
            </div>
          )}

          <div className="mt-6 rounded-[28px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.45)]">
            <ConfigurationChoiceGroup
              title="Sender type"
              variant="segmented"
              disabled={isNativeRecoveryNavigationLocked}
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

            {batchConfiguration.senderWalletType === 'MULTI_SIG' && (
              <MultisigFundingPanel
                enabled={Boolean(activeNativeSender)}
                isExternallyLocked={
                  isNativeActiveMutationOrSubmissionLocked || isNativeWalletTransitionInFlight
                }
                isRecoveryNavigationLocked={isNativeRecoveryNavigationLocked}
                network={multisigNetwork}
                connectedSigner={activeNativeSender}
                savedMultisigs={multisigs.savedMultisigs}
                selectedAddress={multisigs.selectedAddress}
                selectedMultisig={multisigs.selectedMultisig}
                pendingProposals={multisigs.pendingProposals}
                isLoadingSelected={multisigs.isLoadingSelected}
                selectedError={multisigs.selectedError}
                uncertaintyStorageError={multisigs.uncertaintyStorageError}
                createActionState={multisigs.createActionState}
                isCreateActionInFlight={multisigs.isCreateActionInFlight}
                isCreateRetryBlocked={multisigs.isCreateRetryBlocked}
                proposalActionState={multisigs.proposalActionState}
                isProposalActionInFlight={multisigs.isProposalActionInFlight}
                isProposalRetryBlocked={multisigs.isProposalRetryBlocked}
                onSelect={(multisigAddress) => {
                  multisigs.selectMultisig(multisigAddress);
                }}
                onAdd={multisigs.addMultisig}
                onRemove={multisigs.removeMultisig}
                onCreate={handleCreateMultisig}
                onRecheckCreate={recheckCreateMultisig}
                onApprove={handleApproveMultisigProposal}
                onCancel={handleCancelMultisigProposal}
                onRecheckProposal={recheckMultisigProposalAction}
                onRefresh={refreshSelectedMultisig}
              />
            )}
          </div>

          <div className="mt-auto hidden pt-8 lg:block">
            <SocialLinks />
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

            <NetworkBanner connectedSender={connectedSender} />

            <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setInputMode('manual')}
                  data-testid="manual-mode-toggle"
                  className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                    inputMode === 'manual'
                      ? `bg-[#1f69ff] text-white ${choiceCardSelectedShadow}`
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  Manual Entry
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('csv')}
                  className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                    inputMode === 'csv'
                      ? `bg-[#1f69ff] text-white ${choiceCardSelectedShadow}`
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  CSV Upload
                </button>
              </div>

              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
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
                    disabled={
                      (isUsingNativeFundingPath && isNativeIdentityActionLocked) ||
                      isNativeWalletTransitionInFlight
                    }
                    description="Choose how SendFIL executes the batch transaction."
                    selectedValue={batchConfiguration.executionMethod}
                    onSelect={(value) => handleExecutionMethodSelect(value as ExecutionMethod)}
                    options={[
                      {
                        value: 'STANDARD',
                        label: 'Standard',
                        helper: 'Default one-transaction send for normal payment batches.',
                        badge: 'Default',
                        testId: 'execution-method-standard',
                      },
                      {
                        value: 'THINBATCH',
                        label: 'ThinBatch',
                        helper:
                          'Enables best-effort delivery and per-recipient results when available.',
                        testId: 'execution-method-thinbatch',
                      },
                    ]}
                  />

                  <div className="xl:border-l xl:border-slate-200 xl:pl-5">
                    <ConfigurationChoiceGroup
                      title="Error handling"
                      disabled={
                        (isUsingNativeFundingPath && isNativeIdentityActionLocked) ||
                        isNativeWalletTransitionInFlight
                      }
                      description="Choose what happens when a payment within a batch transaction fails."
                      selectedValue={batchConfiguration.errorHandling}
                      onSelect={(value) =>
                        handleErrorHandlingSelect(value as ErrorHandlingPreference)
                      }
                      options={[
                        {
                          value: 'PARTIAL',
                          label: 'Partial',
                          helper: 'Best-effort: successful payments can continue if one fails.',
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
                          <div className="grid grid-cols-[minmax(0,1fr)_48px] gap-3 md:grid-cols-[minmax(0,1fr)_180px_48px]">
                            <div className="col-span-2 md:col-span-1">
                              <label className="mb-1 block text-xs font-medium text-slate-500 md:hidden">
                                Receiver
                              </label>
                              <input
                                placeholder={getManualRecipientAddressPlaceholder(
                                  index,
                                  expectedNetworkPrefix,
                                )}
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

                            <div className="flex items-end justify-end md:justify-center">
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

                          {(rowErrors.length > 0 ||
                            rowWarnings.length > 0 ||
                            Boolean(draftHint)) && (
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
                              {draftHint && <p className="text-sm text-slate-500">{draftHint}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={addRecipient}
                    className="mt-6 inline-flex items-center rounded-full border border-[#1f69ff]/35 bg-white px-5 py-2.5 text-sm font-semibold text-[#124ac4] transition-colors hover:border-[#1f69ff] hover:bg-[#f5f8ff]"
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
                    Import a batch of recipients and amounts using the template format.
                  </p>
                </div>

                <div className="px-6 pb-6 pt-5 sm:px-8">
                  {csvData.length === 0 ? (
                    <CSVUpload
                      onUpload={handleCSVUpload}
                      disabled={false}
                      expectedNetworkPrefix={expectedNetworkPrefix}
                    />
                  ) : (
                    <div>
                      <SummaryPanel
                        title="CSV loaded successfully"
                        messages={[
                          `${csvData.length} recipients imported from the uploaded file.`,
                          `Current valid total: ${formatSummaryFil(
                            csvValidation.validRecipients.reduce(
                              (sum, recipient) => sum + Number(recipient.amount),
                              0,
                            ),
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
                    onClick={
                      canOpenCreateRecovery
                        ? () => handleSenderWalletTypeSelect('MULTI_SIG')
                        : handleReview
                    }
                    disabled={reviewDisabled}
                    data-testid="review-batch-button"
                    className={`min-w-[220px] rounded-full px-6 py-3 text-sm font-semibold transition-colors ${
                      reviewDisabled
                        ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                        : `bg-[#1f69ff] text-white hover:bg-[#1857d4] ${choiceCardSelectedShadow}`
                    }`}
                  >
                    {canOpenCreateRecovery
                      ? 'Open Multisig to Recheck'
                      : hasInspectableNativeSubmissionOutcome && nativeSubmissionSnapshot
                      ? nativeSubmissionSnapshot.kind === 'multisig-proposal'
                        ? 'View Proposal Outcome'
                        : 'View Transaction Outcome'
                      : isUsingNativeFundingPath &&
                          isNativeSubmissionRecoveryRequired &&
                          !isNativeSubmissionRecoveryContextReady
                        ? lockedNativeSubmissionSnapshot?.kind === 'multisig-proposal'
                          ? 'Restore Submitted Proposal'
                          : 'Restore Submitted Transaction'
                        : isMultisigBatchExecutionInFlight
                          ? 'View Pending Proposal'
                          : isMultisigBatchOutcomeUncertain
                            ? 'Inspect Submitted Proposal'
                            : isNativeSingleSigBatchExecutionInFlight
                          ? 'View Pending Transaction'
                          : isNativeSingleSigBatchOutcomeUncertain ||
                              nativeBatchExecution.isOperationLocked
                            ? 'Inspect Submitted Transaction'
                            : isUsingNativeFundingPath &&
                                multisigs.createActionState?.status === 'uncertain'
                              ? 'Recheck Creation First'
                              : isUsingNativeFundingPath &&
                                  multisigs.proposalActionState?.status === 'uncertain'
                                ? 'Recheck Multisig Action First'
                                : isMultisigCreateActionInFlight
                                  ? 'Multisig Create In Progress'
                                  : isMultisigProposalActionInFlight
                                    ? 'Multisig Action In Progress'
                                    : isNativeWalletTransitionInFlight
                                      ? 'Wallet Update In Progress'
                                      : !isConnected
                                        ? 'Connect Wallet to Review'
                                        : isNetworkMismatch
                                          ? 'Switch Network to Review'
                                          : !canUseLiveSendPath
                                            ? 'Sender Not Available'
                                            : `Review Batch${draftRecipientCount > 0 ? ` (${draftRecipientCount})` : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-200/80 bg-white/90 px-5 py-6 backdrop-blur lg:hidden">
          <SocialLinks />
        </footer>
      </div>

      <ReviewTransactionModal
        isOpen={isReviewModalOpen}
        onClose={handleCloseReviewModal}
        onConfirm={handleConfirmTransaction}
        onRecheckTransaction={
          isNativeSubmissionRecoveryContextReady
            ? handleNativeSubmissionRecheck
            : undefined
        }
        recipients={validRecipients}
        validationErrors={activeValidationErrors}
        validationWarnings={activeValidationWarnings}
        recipientTotal={recipientTotal}
        feeTotal={feeTotal}
        gasEstimate={gasEstimate}
        isEstimatingGas={isEstimatingGas}
        isCheckingContractRecipients={isCheckingContractRecipients}
        gasEstimationError={gasEstimationError}
        walletBalance={walletBalance}
        insufficientBalance={insufficientBalance}
        fundingMode={isMultisigFundingRequested ? 'native-multisig' : 'single-signer'}
        fundingSourceLabel={
          isMultisigFundingRequested
            ? (multisigReviewContext?.label ?? selectedMultisigLabel ?? 'Selected multisig')
            : 'Wallet'
        }
        fundingSourceAddress={
          isMultisigFundingRequested
            ? (multisigReviewContext?.address ?? multisigs.selectedAddress)
            : undefined
        }
        connectedSignerAddress={
          isMultisigFundingRequested
            ? (multisigReviewContext?.signerAddress ?? activeNativeSender?.address)
            : undefined
        }
        multisigThreshold={
          isMultisigFundingRequested
            ? (multisigReviewContext?.threshold ?? selectedMultisig?.threshold)
            : undefined
        }
        multisigSignerCount={
          isMultisigFundingRequested
            ? (multisigReviewContext?.signerCount ?? selectedMultisig?.signers.length)
            : undefined
        }
        multisigProposalOutcome={
          isMultisigFundingRequested &&
          multisigBatchExecution.proposalOutcome &&
          multisigBatchExecution.proposalOutcome.kind !== 'applied-failure'
            ? {
                kind: multisigBatchExecution.proposalOutcome.kind,
                transactionId: multisigBatchExecution.proposalOutcome.txnId,
              }
            : undefined
        }
        signerGasBalance={isMultisigFundingRequested ? signerGasBalance : undefined}
        submissionSummary={
          isUsingNativeFundingPath && nativeSubmissionSnapshot
            ? {
                recipientCount: nativeSubmissionSnapshot.recipientCount,
                totalValueAttoFil: nativeSubmissionSnapshot.totalValueAttoFil,
              }
            : undefined
        }
        transactionState={transactionState}
        transactionHash={transactionHash}
        transactionError={transactionError}
        batchConfiguration={reviewBatchConfiguration}
        chainId={
          isMultisigFundingRequested
            ? (multisigReviewContext?.chainId ?? multisigNetwork.chainId)
            : (isUsingNativeFundingPath ? nativeSubmissionNetwork?.chainId : undefined) ?? chainId
        }
        networkLabel={
          isMultisigFundingRequested
            ? (multisigReviewContext?.networkLabel ?? multisigNetwork.walletLabel)
            : ((isUsingNativeFundingPath ? nativeSubmissionNetwork?.walletLabel : undefined) ??
              connectedNetwork?.walletLabel ??
              'Unsupported network')
        }
        feeLabel={feeLabel}
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
