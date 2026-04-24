import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useAccount,
  useChainId,
  useSendTransaction,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import {
  type ErrorMode,
} from './multicall';
import {
  applyGasBuffer,
  buildBatchGasEstimate,
  prepareBatchExecution,
  type BatchExecutionAdapter,
  type BatchExecutionRecipient,
  type BatchGasEstimate,
  type PreparedBatchExecution,
} from './batchExecution';
import {
  BatchExecutionError,
  mapBatchExecutionError,
} from './errorHandling';
import { emitBatchExecutionTelemetry } from './telemetry';
import {
  getSupportedNetworkByChainId,
  getSupportedNetworkListLabel,
} from '../networks';

export type BatchExecutionState =
  | 'idle'
  | 'building'
  | 'signing'
  | 'pending'
  | 'confirmed'
  | 'failed';

export interface BatchExecutionResult {
  state: BatchExecutionState;
  txHash?: `0x${string}`;
  error?: BatchExecutionError;
  gasEstimate?: BatchGasEstimate;
}

export interface UseExecuteBatchReturn {
  executeBatch: (
    recipients: BatchExecutionRecipient[],
    errorMode: ErrorMode,
  ) => Promise<`0x${string}`>;
  estimateBatch: (
    recipients: BatchExecutionRecipient[],
    errorMode: ErrorMode,
  ) => Promise<BatchGasEstimate>;
  state: BatchExecutionState;
  txHash?: `0x${string}`;
  error?: BatchExecutionError;
  reset: () => void;
}

export interface UseExecuteBatchOptions {
  adapter?: BatchExecutionAdapter;
}

/**
 * Hook for executing batch transactions via Multicall3.
 * Provides a single-signature batch execution for multiple recipients.
 */
export function useExecuteBatch(
  options: UseExecuteBatchOptions = {},
): UseExecuteBatchReturn {
  const { adapter } = options;
  const [state, setState] = useState<BatchExecutionState>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<BatchExecutionError | undefined>();
  const [pendingPreparedBatch, setPendingPreparedBatch] = useState<
    PreparedBatchExecution | undefined
  >();
  const executionSequence = useRef(0);

  const account = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const activeNetwork = getSupportedNetworkByChainId(chainId);

  // Watch for transaction confirmation
  const { isLoading: isConfirming, isSuccess, isError: txError, error: receiptError } =
    useWaitForTransactionReceipt({
      hash: txHash,
    });

  // Update state based on transaction receipt
  useEffect(() => {
    if (!txHash || state !== 'pending' || !pendingPreparedBatch || adapter) {
      return;
    }

    if (isConfirming) {
      // Still waiting for confirmation
      return;
    }

    if (isSuccess) {
      setState('confirmed');
      emitBatchExecutionTelemetry({
        event: 'batch_confirmed',
        errorMode: pendingPreparedBatch.errorMode,
        recipientCount: pendingPreparedBatch.recipientCount,
        totalValueAttoFil: pendingPreparedBatch.totalValueAttoFil.toString(),
        networkKey: pendingPreparedBatch.networkKey,
        chainId: pendingPreparedBatch.chainId,
        txHash,
      });
      return;
    }

    if (txError) {
      const mappedError = mapBatchExecutionError(
        receiptError ?? new Error('Transaction failed on-chain'),
        {
          stage: 'confirmation',
          errorMode: pendingPreparedBatch.errorMode,
        },
      );

      setState('failed');
      setError(mappedError);
      emitBatchExecutionTelemetry({
        event: 'batch_failed',
        errorMode: pendingPreparedBatch.errorMode,
        recipientCount: pendingPreparedBatch.recipientCount,
        totalValueAttoFil: pendingPreparedBatch.totalValueAttoFil.toString(),
        networkKey: pendingPreparedBatch.networkKey,
        chainId: pendingPreparedBatch.chainId,
        txHash,
        errorCategory: mappedError.category,
        errorMessage: mappedError.details ?? mappedError.message,
      });
    }
  }, [
    adapter,
    isConfirming,
    isSuccess,
    pendingPreparedBatch,
    receiptError,
    state,
    txError,
    txHash,
  ]);

  const estimatePreparedBatch = useCallback(
    async (prepared: PreparedBatchExecution): Promise<BatchGasEstimate> => {
      if (adapter) {
        return adapter.estimate(prepared);
      }

      if (!publicClient) {
        throw new Error('Public client not available');
      }

      const rawGasEstimate = await publicClient.estimateGas({
        to: prepared.batch.to,
        data: prepared.batch.data,
        value: prepared.batch.value,
        ...(account.address ? { account: account.address } : {}),
      });
      const gasLimit = applyGasBuffer(rawGasEstimate);
      const gasPrice = await publicClient.getGasPrice();

      return buildBatchGasEstimate(gasLimit, gasPrice);
    },
    [account.address, adapter, publicClient],
  );

  /**
   * Estimate gas for a batch transaction.
   */
  const estimateBatch = useCallback(
    async (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
    ): Promise<BatchGasEstimate> => {
      let prepared: PreparedBatchExecution | undefined;

      try {
        if (!activeNetwork) {
          throw new Error(
            `Connect to ${getSupportedNetworkListLabel()} before estimating a batch.`,
          );
        }

        prepared = prepareBatchExecution(recipients, errorMode, activeNetwork);
        const estimate = await estimatePreparedBatch(prepared);

        emitBatchExecutionTelemetry({
          event: 'batch_preflight_succeeded',
          errorMode,
          recipientCount: prepared.recipientCount,
          totalValueAttoFil: prepared.totalValueAttoFil.toString(),
          networkKey: prepared.networkKey,
          chainId: prepared.chainId,
          simulationResult: 'passed',
          gasLimit: estimate.gasLimit.toString(),
          estimatedFeeAttoFil: estimate.estimatedFee.toString(),
        });

        return estimate;
      } catch (cause) {
        const mappedError = mapBatchExecutionError(cause, {
          stage: 'preflight',
          errorMode,
        });

        emitBatchExecutionTelemetry({
          event: 'batch_preflight_failed',
          errorMode,
          recipientCount: prepared?.recipientCount ?? recipients.length,
          totalValueAttoFil: prepared?.totalValueAttoFil.toString() ?? '0',
          networkKey: prepared?.networkKey,
          chainId: prepared?.chainId,
          simulationResult: 'failed',
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });

        throw mappedError;
      }
    },
    [activeNetwork, estimatePreparedBatch],
  );

  /**
   * Execute a batch transaction.
   * Returns the transaction hash.
   */
  const executeBatch = useCallback(
    async (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
    ): Promise<`0x${string}`> => {
      const executionId = executionSequence.current + 1;
      executionSequence.current = executionId;
      setState('building');
      setError(undefined);
      setTxHash(undefined);
      setPendingPreparedBatch(undefined);

      let prepared: PreparedBatchExecution | undefined;
      let failureStage: 'preflight' | 'execution' = 'preflight';

      try {
        if (!activeNetwork) {
          throw new Error(
            `Connect to ${getSupportedNetworkListLabel()} before submitting a batch.`,
          );
        }

        prepared = prepareBatchExecution(recipients, errorMode, activeNetwork);

        emitBatchExecutionTelemetry({
          event: 'batch_submission_requested',
          errorMode,
          recipientCount: prepared.recipientCount,
          totalValueAttoFil: prepared.totalValueAttoFil.toString(),
          networkKey: prepared.networkKey,
          chainId: prepared.chainId,
          simulationResult: errorMode === 'ATOMIC' ? 'passed' : 'skipped',
        });

        if (errorMode === 'ATOMIC') {
          await estimatePreparedBatch(prepared);
        }

        failureStage = 'execution';
        setState('signing');

        const submission = adapter
          ? await adapter.execute(prepared)
          : {
              txHash: await sendTransactionAsync({
                to: prepared.batch.to,
                data: prepared.batch.data,
                value: prepared.batch.value,
              }),
            };
        const hash = submission.txHash;

        setTxHash(hash);
        setPendingPreparedBatch(prepared);
        setState('pending');
        emitBatchExecutionTelemetry({
          event: 'batch_submitted',
          errorMode,
          recipientCount: prepared.recipientCount,
          totalValueAttoFil: prepared.totalValueAttoFil.toString(),
          networkKey: prepared.networkKey,
          chainId: prepared.chainId,
          txHash: hash,
        });

        if (submission.confirmation) {
          await submission.confirmation;

          if (executionSequence.current !== executionId) {
            return hash;
          }

          setState('confirmed');
          emitBatchExecutionTelemetry({
            event: 'batch_confirmed',
            errorMode,
            recipientCount: prepared.recipientCount,
            totalValueAttoFil: prepared.totalValueAttoFil.toString(),
            networkKey: prepared.networkKey,
            chainId: prepared.chainId,
            txHash: hash,
          });
        }

        return hash;
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
          errorMode,
          recipientCount: prepared?.recipientCount ?? recipients.length,
          totalValueAttoFil: prepared?.totalValueAttoFil.toString() ?? '0',
          networkKey: prepared?.networkKey,
          chainId: prepared?.chainId,
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });
        throw mappedError;
      }
    },
    [activeNetwork, adapter, estimatePreparedBatch, sendTransactionAsync],
  );

  /**
   * Reset the hook state for a new transaction.
   */
  const reset = useCallback(() => {
    executionSequence.current += 1;
    setState('idle');
    setTxHash(undefined);
    setError(undefined);
    setPendingPreparedBatch(undefined);
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
