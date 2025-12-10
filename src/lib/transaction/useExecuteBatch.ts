import { useState, useCallback, useEffect } from 'react';
import {
  useSendTransaction,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import {
  buildMulticallBatch,
  convertRecipientsToBatch,
  MULTICALL3_ADDRESS,
  type ErrorMode,
} from './multicall';

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
  error?: string;
  gasEstimate?: bigint;
}

export interface UseExecuteBatchReturn {
  executeBatch: (
    recipients: Array<{ address: string; amount: number }>,
    errorMode?: ErrorMode,
  ) => Promise<`0x${string}`>;
  estimateGas: (
    recipients: Array<{ address: string; amount: number }>,
    errorMode?: ErrorMode,
  ) => Promise<bigint>;
  state: BatchExecutionState;
  txHash?: `0x${string}`;
  error?: string;
  reset: () => void;
}

/**
 * Hook for executing batch transactions via Multicall3.
 * Provides a single-signature batch execution for multiple recipients.
 */
export function useExecuteBatch(): UseExecuteBatchReturn {
  const [state, setState] = useState<BatchExecutionState>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | undefined>();

  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  // Watch for transaction confirmation
  const { isLoading: isConfirming, isSuccess, isError: txError } =
    useWaitForTransactionReceipt({
      hash: txHash,
    });

  // Update state based on transaction receipt
  useEffect(() => {
    if (txHash && isConfirming && state === 'pending') {
      // Still waiting for confirmation
    } else if (txHash && isSuccess && state === 'pending') {
      setState('confirmed');
    } else if (txHash && txError && state === 'pending') {
      setState('failed');
      setError('Transaction failed on-chain');
    }
  }, [txHash, isConfirming, isSuccess, txError, state]);

  /**
   * Estimate gas for a batch transaction.
   */
  const estimateGas = useCallback(
    async (
      recipients: Array<{ address: string; amount: number }>,
      errorMode: ErrorMode = 'PARTIAL',
    ): Promise<bigint> => {
      if (!publicClient) {
        throw new Error('Public client not available');
      }

      const batchRecipients = convertRecipientsToBatch(recipients);
      const batch = buildMulticallBatch(batchRecipients, errorMode);

      const gasEstimate = await publicClient.estimateGas({
        to: batch.to,
        data: batch.data,
        value: batch.value,
      });

      // Add 10% buffer for safety
      return (gasEstimate * 110n) / 100n;
    },
    [publicClient],
  );

  /**
   * Execute a batch transaction.
   * Returns the transaction hash.
   */
  const executeBatch = useCallback(
    async (
      recipients: Array<{ address: string; amount: number }>,
      errorMode: ErrorMode = 'PARTIAL',
    ): Promise<`0x${string}`> => {
      setState('building');
      setError(undefined);
      setTxHash(undefined);

      try {
        // Validate and build the batch
        const batchRecipients = convertRecipientsToBatch(recipients);
        const batch = buildMulticallBatch(batchRecipients, errorMode);

        console.log('[useExecuteBatch] Built batch:', {
          to: batch.to,
          value: batch.value.toString(),
          recipientCount: batch.recipientCount,
          callsCount: batch.calls.length,
        });

        setState('signing');

        // Send the transaction
        const hash = await sendTransactionAsync({
          to: batch.to,
          data: batch.data,
          value: batch.value,
        });

        console.log('[useExecuteBatch] Transaction sent:', hash);
        setTxHash(hash);
        setState('pending');

        return hash;
      } catch (err) {
        console.error('[useExecuteBatch] Error:', err);

        // Extract user-friendly error message
        let errorMessage = 'Transaction failed';
        if (err instanceof Error) {
          if (err.message.includes('User rejected')) {
            errorMessage = 'Transaction rejected by user';
          } else if (err.message.includes('insufficient funds')) {
            errorMessage = 'Insufficient funds for transaction';
          } else {
            errorMessage = err.message;
          }
        }

        setState('failed');
        setError(errorMessage);
        throw new Error(errorMessage);
      }
    },
    [sendTransactionAsync],
  );

  /**
   * Reset the hook state for a new transaction.
   */
  const reset = useCallback(() => {
    setState('idle');
    setTxHash(undefined);
    setError(undefined);
  }, []);

  return {
    executeBatch,
    estimateGas,
    state,
    txHash,
    error,
    reset,
  };
}

/**
 * Hook for estimating gas for a batch transaction.
 * Separate from execution for use in the review modal.
 */
export function useBatchGasEstimate(
  recipients: Array<{ address: string; amount: number }> | undefined,
  errorMode: ErrorMode = 'PARTIAL',
) {
  const [gasEstimate, setGasEstimate] = useState<bigint | undefined>();
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | undefined>();

  const publicClient = usePublicClient();

  useEffect(() => {
    if (!recipients || recipients.length === 0 || !publicClient) {
      setGasEstimate(undefined);
      return;
    }

    let cancelled = false;

    const estimate = async () => {
      setIsEstimating(true);
      setEstimateError(undefined);

      try {
        const batchRecipients = convertRecipientsToBatch(recipients);
        const batch = buildMulticallBatch(batchRecipients, errorMode);

        const gas = await publicClient.estimateGas({
          to: batch.to,
          data: batch.data,
          value: batch.value,
        });

        if (!cancelled) {
          // Add 10% buffer
          setGasEstimate((gas * 110n) / 100n);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[useBatchGasEstimate] Error:', err);
          setEstimateError(
            err instanceof Error ? err.message : 'Gas estimation failed',
          );
        }
      } finally {
        if (!cancelled) {
          setIsEstimating(false);
        }
      }
    };

    estimate();

    return () => {
      cancelled = true;
    };
  }, [recipients, errorMode, publicClient]);

  return {
    gasEstimate,
    isEstimating,
    estimateError,
  };
}
