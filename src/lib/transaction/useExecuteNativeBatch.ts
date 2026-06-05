import { useCallback, useRef, useState } from 'react';
import { pollTransactionStatus } from '../DataProvider';
import type {
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
} from '../senders';
import type { ExecutionMethod } from '../batchConfiguration';
import {
  type BatchExecutionRecipient,
  type BatchGasEstimate,
} from './batchExecution';
import {
  BatchExecutionError,
  mapBatchExecutionError,
} from './errorHandling';
import type { ErrorMode } from './multicall';
import {
  preflightNativeBatch,
  type NativeBatchPreflightRpc,
  type PreparedNativeBatchPreflight,
} from './nativeBatchPreflight';
import {
  createSubmitBalanceCheckError,
  recheckSubmitBalance,
} from './submitBalanceCheck';
import { emitBatchExecutionTelemetry } from './telemetry';
import type { BatchExecutionState } from './useExecuteBatch';

export interface UseExecuteNativeBatchOptions {
  sender?: NativeFilecoinConnectedSender;
  provider?: NativeFilecoinWalletProvider;
  rpc?: NativeBatchPreflightRpc;
  pollMessageStatus?: typeof pollTransactionStatus;
  confirmationPollAttempts?: number;
  confirmationPollIntervalMs?: number;
}

export interface UseExecuteNativeBatchReturn {
  executeBatch: (
    recipients: BatchExecutionRecipient[],
    errorMode: ErrorMode,
    executionMethod?: ExecutionMethod,
  ) => Promise<string>;
  estimateBatch: (
    recipients: BatchExecutionRecipient[],
    errorMode: ErrorMode,
    executionMethod?: ExecutionMethod,
  ) => Promise<BatchGasEstimate>;
  state: BatchExecutionState;
  txHash?: string;
  error?: BatchExecutionError;
  reset: () => void;
}

type SignAndSubmitNativeProvider = NativeFilecoinWalletProvider & {
  signAndSubmitMessage: NonNullable<NativeFilecoinWalletProvider['signAndSubmitMessage']>;
};

function assertNativeSenderReady(
  sender: NativeFilecoinConnectedSender | undefined,
): asserts sender is NativeFilecoinConnectedSender {
  if (!sender) {
    throw new Error('No connected native Filecoin sender is available.');
  }
}

function getNativeExecutionProvider(
  provider: NativeFilecoinWalletProvider | undefined,
): SignAndSubmitNativeProvider {
  if (!provider) {
    throw new Error('No native Filecoin wallet provider is connected.');
  }

  if (!provider.signAndSubmitMessage) {
    throw new Error(`${provider.metadata.name} cannot sign and submit Filecoin messages.`);
  }

  return provider as SignAndSubmitNativeProvider;
}

export function useExecuteNativeBatch({
  sender,
  provider,
  rpc,
  pollMessageStatus = pollTransactionStatus,
  confirmationPollAttempts = 60,
  confirmationPollIntervalMs = 5000,
}: UseExecuteNativeBatchOptions = {}): UseExecuteNativeBatchReturn {
  const [state, setState] = useState<BatchExecutionState>('idle');
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<BatchExecutionError | undefined>();
  const executionSequence = useRef(0);

  const runPreflight = useCallback(
    (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
      executionMethod: ExecutionMethod = 'STANDARD',
    ): Promise<PreparedNativeBatchPreflight> => {
      assertNativeSenderReady(sender);
      getNativeExecutionProvider(provider);

      return preflightNativeBatch({
        sender,
        recipients,
        errorMode,
        executionMethod,
        network: sender.network,
        rpc,
      });
    },
    [provider, rpc, sender],
  );

  const waitForConfirmation = useCallback(
    async (
      cid: string,
      preflight: PreparedNativeBatchPreflight,
      executionId: number,
    ) => {
      try {
        const status = await pollMessageStatus(
          cid,
          confirmationPollAttempts,
          confirmationPollIntervalMs,
          preflight.sender.networkKey,
        );

        if (executionSequence.current !== executionId) {
          return;
        }

        if (status.status === 'confirmed') {
          setState('confirmed');
          emitBatchExecutionTelemetry({
            event: 'batch_confirmed',
            executionMethod: preflight.preparedBatch.executionMethod,
            errorMode: preflight.preparedBatch.errorMode,
            recipientCount: preflight.preparedBatch.recipientCount,
            totalValueAttoFil: preflight.preparedBatch.totalValueAttoFil.toString(),
            networkKey: preflight.preparedBatch.networkKey,
            chainId: preflight.preparedBatch.chainId,
            txHash: cid,
          });
          return;
        }

        const mappedError = mapBatchExecutionError(
          new Error(status.error ?? 'Native Filecoin message failed on-chain.'),
          {
            stage: 'confirmation',
            errorMode: preflight.preparedBatch.errorMode,
          },
        );

        setState('failed');
        setError(mappedError);
        emitBatchExecutionTelemetry({
          event: 'batch_failed',
          executionMethod: preflight.preparedBatch.executionMethod,
          errorMode: preflight.preparedBatch.errorMode,
          recipientCount: preflight.preparedBatch.recipientCount,
          totalValueAttoFil: preflight.preparedBatch.totalValueAttoFil.toString(),
          networkKey: preflight.preparedBatch.networkKey,
          chainId: preflight.preparedBatch.chainId,
          txHash: cid,
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });
      } catch (cause) {
        if (executionSequence.current !== executionId) {
          return;
        }

        const mappedError = mapBatchExecutionError(cause, {
          stage: 'confirmation',
          errorMode: preflight.preparedBatch.errorMode,
        });

        setState('failed');
        setError(mappedError);
        emitBatchExecutionTelemetry({
          event: 'batch_failed',
          executionMethod: preflight.preparedBatch.executionMethod,
          errorMode: preflight.preparedBatch.errorMode,
          recipientCount: preflight.preparedBatch.recipientCount,
          totalValueAttoFil: preflight.preparedBatch.totalValueAttoFil.toString(),
          networkKey: preflight.preparedBatch.networkKey,
          chainId: preflight.preparedBatch.chainId,
          txHash: cid,
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });
      }
    },
    [confirmationPollAttempts, confirmationPollIntervalMs, pollMessageStatus],
  );

  const estimateBatch = useCallback(
    async (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
      executionMethod: ExecutionMethod = 'STANDARD',
    ): Promise<BatchGasEstimate> => {
      let preflight: PreparedNativeBatchPreflight | undefined;

      try {
        preflight = await runPreflight(recipients, errorMode, executionMethod);

        emitBatchExecutionTelemetry({
          event: 'batch_preflight_succeeded',
          executionMethod,
          errorMode,
          recipientCount: preflight.preparedBatch.recipientCount,
          totalValueAttoFil: preflight.preparedBatch.totalValueAttoFil.toString(),
          networkKey: preflight.preparedBatch.networkKey,
          chainId: preflight.preparedBatch.chainId,
          simulationResult: 'passed',
          gasLimit: preflight.gasEstimate.gasLimit.toString(),
          estimatedFeeAttoFil: preflight.gasEstimate.estimatedFee.toString(),
        });

        return preflight.gasEstimate;
      } catch (cause) {
        const mappedError = mapBatchExecutionError(cause, {
          stage: 'preflight',
          errorMode,
        });

        emitBatchExecutionTelemetry({
          event: 'batch_preflight_failed',
          executionMethod,
          errorMode,
          recipientCount: preflight?.preparedBatch.recipientCount ?? recipients.length,
          totalValueAttoFil: preflight?.preparedBatch.totalValueAttoFil.toString() ?? '0',
          networkKey: preflight?.preparedBatch.networkKey,
          chainId: preflight?.preparedBatch.chainId,
          simulationResult: 'failed',
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });

        throw mappedError;
      }
    },
    [runPreflight],
  );

  const executeBatch = useCallback(
    async (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
      executionMethod: ExecutionMethod = 'STANDARD',
    ): Promise<string> => {
      const executionId = executionSequence.current + 1;
      executionSequence.current = executionId;
      setState('building');
      setError(undefined);
      setTxHash(undefined);

      let preflight: PreparedNativeBatchPreflight | undefined;
      let failureStage: 'preflight' | 'execution' = 'preflight';

      try {
        assertNativeSenderReady(sender);
        const nativeProvider = getNativeExecutionProvider(provider);
        preflight = await runPreflight(recipients, errorMode, executionMethod);
        const prepared = preflight.preparedBatch;

        emitBatchExecutionTelemetry({
          event: 'batch_submission_requested',
          executionMethod,
          errorMode,
          recipientCount: prepared.recipientCount,
          totalValueAttoFil: prepared.totalValueAttoFil.toString(),
          networkKey: prepared.networkKey,
          chainId: prepared.chainId,
          simulationResult: errorMode === 'ATOMIC' ? 'passed' : 'skipped',
        });

        failureStage = 'execution';
        const balanceCheck = await recheckSubmitBalance({
          sender: {
            kind: 'native',
            address: sender.address,
            networkKey: sender.networkKey,
          },
          network: sender.network,
          transferTotalAttoFil: prepared.totalValueAttoFil,
          estimatedNetworkFeeAttoFil: preflight.gasEstimate.estimatedFee,
          readNativeBalance: async ({ address, networkKey }) =>
            nativeProvider.getBalance({
              address,
              networkKey,
              nativePrefix: sender.nativePrefix,
            }),
        });

        if (!balanceCheck.ok) {
          throw createSubmitBalanceCheckError(balanceCheck, errorMode);
        }

        setState('signing');
        const { cid } = await nativeProvider.signAndSubmitMessage(
          preflight.estimatedNativeMessage.message,
        );

        setTxHash(cid);
        setState('pending');
        emitBatchExecutionTelemetry({
          event: 'batch_submitted',
          executionMethod,
          errorMode,
          recipientCount: prepared.recipientCount,
          totalValueAttoFil: prepared.totalValueAttoFil.toString(),
          networkKey: prepared.networkKey,
          chainId: prepared.chainId,
          txHash: cid,
        });

        void waitForConfirmation(cid, preflight, executionId);

        return cid;
      } catch (cause) {
        const mappedError = mapBatchExecutionError(cause, {
          stage: failureStage,
          errorMode,
        });

        if (executionSequence.current !== executionId) {
          throw mappedError;
        }

        setState('failed');
        setError(mappedError);
        emitBatchExecutionTelemetry({
          event: 'batch_failed',
          executionMethod,
          errorMode,
          recipientCount: preflight?.preparedBatch.recipientCount ?? recipients.length,
          totalValueAttoFil: preflight?.preparedBatch.totalValueAttoFil.toString() ?? '0',
          networkKey: preflight?.preparedBatch.networkKey,
          chainId: preflight?.preparedBatch.chainId,
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });
        throw mappedError;
      }
    },
    [provider, runPreflight, sender, waitForConfirmation],
  );

  const reset = useCallback(() => {
    executionSequence.current += 1;
    setState('idle');
    setTxHash(undefined);
    setError(undefined);
  }, []);

  return {
    executeBatch,
    estimateBatch,
    state,
    txHash,
    error,
    reset,
  };
}
