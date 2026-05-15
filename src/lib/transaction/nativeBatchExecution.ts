import type { TransactionStatus } from '../DataProvider/types';
import { pollTransactionStatus } from '../DataProvider';
import type {
  NativeFilecoinAccount,
  NativeFilecoinSendResult,
  NativeFilecoinWalletProvider,
} from '../senders';
import type { SendFilNetworkConfig, SendFilNetworkKey } from '../networks';
import {
  BatchExecutionError,
  mapBatchExecutionError,
} from './errorHandling';
import type { ErrorMode } from './multicall';
import type { PreparedNativeBatchPreflight } from './nativeBatchPreflight';
import {
  createSubmitBalanceCheckError,
  recheckSubmitBalance,
} from './submitBalanceCheck';

export interface SubmitPreparedNativeBatchRequest {
  preflight: PreparedNativeBatchPreflight;
  provider: NativeFilecoinWalletProvider;
  network: SendFilNetworkConfig;
  errorMode: ErrorMode;
  pollStatus?: (
    cid: string,
    maxAttempts: number,
    intervalMs: number,
    networkKey?: SendFilNetworkKey,
  ) => Promise<TransactionStatus>;
  pollMaxAttempts?: number;
  pollIntervalMs?: number;
  onSubmitted?: (result: NativeFilecoinSendResult) => void;
}

export interface SubmitPreparedNativeBatchResult {
  cid: string;
  status: TransactionStatus;
}

function createNativeExecutionError({
  title,
  message,
  details,
  errorMode,
  cause,
}: {
  title: string;
  message: string;
  details?: string;
  errorMode: ErrorMode;
  cause?: unknown;
}): BatchExecutionError {
  return new BatchExecutionError({
    category: 'UNSUPPORTED_SENDER',
    title,
    message,
    errorMode,
    stage: 'execution',
    recoverable: true,
    hint:
      'Reconnect the native Filecoin testnet sender, review the batch again, and retry.',
    details,
    cause,
  });
}

function assertCurrentAccountMatchesPreflight(
  account: NativeFilecoinAccount | null,
  preflight: PreparedNativeBatchPreflight,
  errorMode: ErrorMode,
): NativeFilecoinAccount {
  if (!account) {
    throw createNativeExecutionError({
      title: 'Native sender disconnected',
      message: 'The native Filecoin sender is no longer connected.',
      errorMode,
    });
  }

  if (
    account.address !== preflight.sender.address ||
    account.networkKey !== preflight.sender.networkKey
  ) {
    throw createNativeExecutionError({
      title: 'Native sender changed',
      message:
        'The connected native Filecoin sender changed after review. Please review again.',
      details: `Reviewed ${preflight.sender.address} on ${preflight.sender.networkKey}; connected ${account.address} on ${account.networkKey}.`,
      errorMode,
    });
  }

  return account;
}

export async function submitPreparedNativeBatch({
  preflight,
  provider,
  network,
  errorMode,
  pollStatus = pollTransactionStatus,
  pollMaxAttempts = 60,
  pollIntervalMs = 5000,
  onSubmitted,
}: SubmitPreparedNativeBatchRequest): Promise<SubmitPreparedNativeBatchResult> {
  if (!provider.signAndSubmitMessage) {
    throw createNativeExecutionError({
      title: 'Native signing unavailable',
      message:
        'The connected native Filecoin provider cannot sign and submit batch messages.',
      errorMode,
    });
  }

  try {
    const currentAccount = assertCurrentAccountMatchesPreflight(
      await provider.getAccount(),
      preflight,
      errorMode,
    );
    const balanceCheck = await recheckSubmitBalance({
      sender: {
        kind: 'native',
        address: currentAccount.address,
        networkKey: currentAccount.networkKey,
      },
      network,
      transferTotalAttoFil: preflight.preparedBatch.totalValueAttoFil,
      estimatedNetworkFeeAttoFil: preflight.gasEstimate.estimatedFee,
      readNativeBalance: async ({ address, networkKey }) =>
        provider.getBalance({
          address,
          networkKey,
          nativePrefix: preflight.sender.nativePrefix,
        }),
    });

    if (!balanceCheck.ok) {
      throw createSubmitBalanceCheckError(balanceCheck, errorMode);
    }

    const result = await provider.signAndSubmitMessage(
      preflight.estimatedNativeMessage.message,
    );
    onSubmitted?.(result);

    const status = await pollStatus(
      result.cid,
      pollMaxAttempts,
      pollIntervalMs,
      preflight.sender.networkKey,
    );

    if (status.status === 'failed') {
      throw new BatchExecutionError({
        category: 'UNKNOWN',
        title: 'Native message failed',
        message:
          'The native Filecoin batch message was submitted, but it did not confirm successfully.',
        errorMode,
        stage: 'confirmation',
        recoverable: true,
        hint:
          'Check the Filfox message status before retrying this batch.',
        details: status.error,
      });
    }

    return {
      cid: result.cid,
      status,
    };
  } catch (error) {
    throw mapBatchExecutionError(error, {
      errorMode,
      stage: error instanceof BatchExecutionError ? error.stage : 'execution',
    });
  }
}
