import { useCallback, useEffect, useRef, useState } from 'react';
import { pollTransactionStatus } from '../DataProvider';
import type {
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
} from '../senders';
import { isNativeFilecoinSubmissionUncertainError } from '../senders/nativeFilecoinSubmission';
import {
  NativeSignerLockError,
  withNativeSignerLock,
} from '../senders/nativeSignerLock';
import {
  getNativeBatchSubmissionIdentity,
  readNativeSubmissionRecords,
  removeNativeSubmissionRecord,
  verifyNativeSubmissionStorage,
  writeNativeSubmissionRecord,
  type NativeBatchSubmissionRecord,
} from '../senders/nativeSubmissionStorage';
import type { ExecutionMethod } from '../batchConfiguration';
import { getNetworkConfig } from '../networks';
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
  storage?: Storage;
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
  isIdentityLocked: boolean;
  isOperationLocked: boolean;
  isWalletMutationUnsafe: boolean;
  submissionSnapshot?: NativeBatchSubmissionRecord;
  recheck: () => Promise<void>;
  reset: () => void;
}

type SignAndSubmitNativeProvider = NativeFilecoinWalletProvider & {
  signAndSubmitMessage: NonNullable<NativeFilecoinWalletProvider['signAndSubmitMessage']>;
};

interface ActiveNativeExecution {
  identity: string;
  promise: Promise<string>;
}

interface NativeConfirmationContext {
  networkKey: NativeFilecoinConnectedSender['networkKey'];
  chainId: NativeFilecoinConnectedSender['chainId'];
  executionMethod: ExecutionMethod;
  errorMode: ErrorMode;
  recipientCount: number;
  totalValueAttoFil: string;
}

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

function createNativeConfirmationUncertainError(
  cid: string,
  errorMode: ErrorMode,
  cause: unknown,
): BatchExecutionError {
  const details = cause instanceof Error ? cause.message : String(cause);

  return new BatchExecutionError({
    category: 'RPC_FAILURE',
    title: 'Native batch confirmation is uncertain',
    message:
      'SendFIL could not prove that the batch reached a terminal on-chain result. ' +
      'The original CID may still land, so submitting the batch again could duplicate payments.',
    errorMode,
    stage: 'confirmation',
    recoverable: false,
    hint: 'Inspect the CID in Filfox or your wallet before taking another action.',
    details: `CID: ${cid}; ${details}`,
    cause,
  });
}

function createNativeExecutionIdentityLockError(errorMode: ErrorMode): BatchExecutionError {
  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: 'Another native batch is still unresolved',
    message:
      'A native batch started with a different wallet identity has not reached a proven terminal result. ' +
      'Switching wallets does not make it safe to submit another batch from this screen.',
    errorMode,
    stage: 'execution',
    recoverable: false,
    hint: 'Reconnect the original wallet and inspect its CID before starting another native batch.',
  });
}

function createNativeSubmissionStorageError(
  message: string,
  errorMode: ErrorMode,
): BatchExecutionError {
  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: 'Native submission safety storage is unavailable',
    message,
    errorMode,
    stage: 'execution',
    recoverable: false,
    hint:
      'Restore browser storage access before signing. If a CID is already shown, inspect it before changing storage or retrying.',
  });
}

function createNativeSignerLockExecutionError(
  cause: NativeSignerLockError,
  errorMode: ErrorMode,
): BatchExecutionError {
  const isBusy = cause.code === 'LOCK_BUSY';

  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: isBusy
      ? 'Another native signing request is active'
      : 'Native signing is safety-locked',
    message: cause.message,
    errorMode,
    stage: 'execution',
    recoverable: isBusy,
    hint: isBusy
      ? 'Finish or cancel the wallet request in the other SendFIL tab, then try again.'
      : 'Resolve the exact-CID or browser safety issue before attempting another native signature.',
    details: cause.message,
    cause,
  });
}

function getConfirmationContext(
  preflight: PreparedNativeBatchPreflight,
): NativeConfirmationContext {
  return {
    networkKey: preflight.sender.networkKey,
    chainId: preflight.preparedBatch.chainId,
    executionMethod: preflight.preparedBatch.executionMethod,
    errorMode: preflight.preparedBatch.errorMode,
    recipientCount: preflight.preparedBatch.recipientCount,
    totalValueAttoFil: preflight.preparedBatch.totalValueAttoFil.toString(),
  };
}

function getStoredConfirmationContext(
  record: NativeBatchSubmissionRecord,
): NativeConfirmationContext {
  return {
    networkKey: record.networkKey,
    chainId: getNetworkConfig(record.networkKey).chainId,
    executionMethod: record.executionMethod,
    errorMode: record.errorMode,
    recipientCount: record.recipientCount,
    totalValueAttoFil: record.totalValueAttoFil,
  };
}

export function useExecuteNativeBatch({
  sender,
  provider,
  rpc,
  pollMessageStatus = pollTransactionStatus,
  confirmationPollAttempts = 60,
  confirmationPollIntervalMs = 5000,
  storage,
}: UseExecuteNativeBatchOptions = {}): UseExecuteNativeBatchReturn {
  const [state, setState] = useState<BatchExecutionState>('idle');
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<BatchExecutionError | undefined>();
  const [submissionSnapshot, setSubmissionSnapshot] =
    useState<NativeBatchSubmissionRecord>();
  const [isWalletMutationUnsafe, setIsWalletMutationUnsafe] = useState(false);
  const executionSequence = useRef(0);
  const activeExecution = useRef<ActiveNativeExecution | undefined>(undefined);
  const confirmationInFlight = useRef(false);
  const executionIdentity =
    sender && provider
      ? getNativeBatchSubmissionIdentity({
          networkKey: sender.networkKey,
          signerAddress: sender.address,
        })
      : undefined;
  const storedSubmissions = readNativeSubmissionRecords(storage);
  const storedSubmission = executionIdentity
    ? storedSubmissions.records.find(
        (record): record is NativeBatchSubmissionRecord =>
          record.kind === 'native-batch' && record.identity === executionIdentity,
      )
    : undefined;
  const storedOperationSubmission = storedSubmissions.records.find(
    (record): record is NativeBatchSubmissionRecord => record.kind === 'native-batch',
  );

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
      context: NativeConfirmationContext,
      executionId: number,
      identity: string,
      pollAttempts = confirmationPollAttempts,
      pollIntervalMs = confirmationPollIntervalMs,
    ): Promise<boolean> => {
      confirmationInFlight.current = true;

      try {
        const status = await pollMessageStatus(
          cid,
          pollAttempts,
          pollIntervalMs,
          context.networkKey,
        );

        if (executionSequence.current !== executionId) {
          return false;
        }

        if (status.status === 'confirmed' && status.receipt?.ExitCode === 0) {
          const storageError = removeNativeSubmissionRecord(identity, cid, storage);

          if (storageError) {
            setState('failed');
            setError(createNativeSubmissionStorageError(storageError, context.errorMode));
            return false;
          }

          setState('confirmed');
          setError(undefined);
          emitBatchExecutionTelemetry({
            event: 'batch_confirmed',
            executionMethod: context.executionMethod,
            errorMode: context.errorMode,
            recipientCount: context.recipientCount,
            totalValueAttoFil: context.totalValueAttoFil,
            networkKey: context.networkKey,
            chainId: context.chainId,
            txHash: cid,
          });
          return true;
        }

        if (
          status.status === 'confirmed' ||
          !status.receipt ||
          status.receipt.ExitCode === 0
        ) {
          const confirmationDetail = status.error ??
            (status.status === 'confirmed'
              ? status.receipt
                ? `Confirmed status carried nonzero exit code ${status.receipt.ExitCode}.`
                : 'Confirmed status is missing its message receipt.'
              : 'The batch has no terminal receipt.');
          const uncertainError = createNativeConfirmationUncertainError(
            cid,
            context.errorMode,
            new Error(confirmationDetail),
          );

          setState('failed');
          setError(uncertainError);
          emitBatchExecutionTelemetry({
            event: 'batch_failed',
            executionMethod: context.executionMethod,
            errorMode: context.errorMode,
            recipientCount: context.recipientCount,
            totalValueAttoFil: context.totalValueAttoFil,
            networkKey: context.networkKey,
            chainId: context.chainId,
            txHash: cid,
            errorCategory: uncertainError.category,
            errorMessage: uncertainError.details ?? uncertainError.message,
          });
          return false;
        }

        const mappedError = mapBatchExecutionError(
          new Error(status.error ?? 'Native Filecoin message failed on-chain.'),
          {
            stage: 'confirmation',
            errorMode: context.errorMode,
          },
        );

        const storageError = removeNativeSubmissionRecord(identity, cid, storage);

        if (storageError) {
          setState('failed');
          setError(createNativeSubmissionStorageError(storageError, context.errorMode));
          return false;
        }

        setState('failed');
        setError(mappedError);
        emitBatchExecutionTelemetry({
          event: 'batch_failed',
          executionMethod: context.executionMethod,
          errorMode: context.errorMode,
          recipientCount: context.recipientCount,
          totalValueAttoFil: context.totalValueAttoFil,
          networkKey: context.networkKey,
          chainId: context.chainId,
          txHash: cid,
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });
        return true;
      } catch (cause) {
        if (executionSequence.current !== executionId) {
          return false;
        }

        const mappedError = createNativeConfirmationUncertainError(
          cid,
          context.errorMode,
          cause,
        );

        setState('failed');
        setError(mappedError);
        emitBatchExecutionTelemetry({
          event: 'batch_failed',
          executionMethod: context.executionMethod,
          errorMode: context.errorMode,
          recipientCount: context.recipientCount,
          totalValueAttoFil: context.totalValueAttoFil,
          networkKey: context.networkKey,
          chainId: context.chainId,
          txHash: cid,
          errorCategory: mappedError.category,
          errorMessage: mappedError.details ?? mappedError.message,
        });
        return false;
      } finally {
        if (executionSequence.current === executionId) {
          confirmationInFlight.current = false;
        }
      }
    },
    [
      confirmationPollAttempts,
      confirmationPollIntervalMs,
      pollMessageStatus,
      storage,
    ],
  );

  const reconcileStoredSubmission = useCallback(
    async (
      record: NativeBatchSubmissionRecord,
      pollAttempts = confirmationPollAttempts,
      pollIntervalMs = confirmationPollIntervalMs,
    ): Promise<void> => {
      if (confirmationInFlight.current) {
        return;
      }

      const executionId = executionSequence.current + 1;
      executionSequence.current = executionId;
      const reconciliationPromise = Promise.resolve(record.cid);

      if (!activeExecution.current) {
        activeExecution.current = {
          identity: record.identity,
          promise: reconciliationPromise,
        };
      }

      setTxHash(record.cid);
      setSubmissionSnapshot(record);
      setError(undefined);
      setState('pending');

      const canReleaseLock = await waitForConfirmation(
        record.cid,
        getStoredConfirmationContext(record),
        executionId,
        record.identity,
        pollAttempts,
        pollIntervalMs,
      );

      if (
        canReleaseLock &&
        activeExecution.current?.identity === record.identity
      ) {
        activeExecution.current = undefined;
      }
    },
    [
      confirmationPollAttempts,
      confirmationPollIntervalMs,
      waitForConfirmation,
    ],
  );

  useEffect(() => {
    if (storedSubmissions.error) {
      setState('failed');
      setError(
        createNativeSubmissionStorageError(
          storedSubmissions.error,
          storedSubmission?.errorMode ?? 'ATOMIC',
        ),
      );
      return;
    }

    if (!executionIdentity) {
      return;
    }

    if (storedSubmission && !activeExecution.current) {
      void reconcileStoredSubmission(storedSubmission);
    }
  }, [
    executionIdentity,
    reconcileStoredSubmission,
    storedSubmission,
    storedSubmissions.error,
  ]);

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
    (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
      executionMethod: ExecutionMethod = 'STANDARD',
    ): Promise<string> => {
      if (!executionIdentity) {
        return Promise.reject(
          mapBatchExecutionError(
            new Error('No native Filecoin wallet identity is connected.'),
            { stage: 'execution', errorMode },
          ),
        );
      }

      const latestStoredSubmissions = readNativeSubmissionRecords(storage);

      if (latestStoredSubmissions.error) {
        return Promise.reject(
          createNativeSubmissionStorageError(
            latestStoredSubmissions.error,
            errorMode,
          ),
        );
      }

      const latestStoredSubmission = latestStoredSubmissions.records.find(
        (record): record is NativeBatchSubmissionRecord =>
          record.kind === 'native-batch' &&
          record.identity === executionIdentity,
      );

      if (activeExecution.current) {
        if (activeExecution.current.identity === executionIdentity) {
          return activeExecution.current.promise;
        }

        return Promise.reject(createNativeExecutionIdentityLockError(errorMode));
      }

      if (
        latestStoredSubmission &&
        latestStoredSubmissions.records.length === 1
      ) {
        void reconcileStoredSubmission(latestStoredSubmission);
        return Promise.resolve(latestStoredSubmission.cid);
      }

      if (latestStoredSubmissions.records.length > 0) {
        return Promise.reject(createNativeExecutionIdentityLockError(errorMode));
      }

      let confirmationStarted = false;
      let execution: Promise<string>;
      setIsWalletMutationUnsafe(true);

      execution = (async (): Promise<string> => {
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

          const storageVerificationError = verifyNativeSubmissionStorage(storage);

          if (storageVerificationError) {
            throw createNativeSubmissionStorageError(
              storageVerificationError,
              errorMode,
            );
          }

          const preSigningRecords = readNativeSubmissionRecords(storage);
          if (preSigningRecords.error) {
            throw createNativeSubmissionStorageError(
              preSigningRecords.error,
              errorMode,
            );
          }

          if (preSigningRecords.records.length > 0) {
            throw createNativeExecutionIdentityLockError(errorMode);
          }

          const { cid, submissionWasUncertain } = await withNativeSignerLock(
            {
              networkKey: sender.networkKey,
              signerAddress: sender.address,
              storage,
            },
            async () => {
              setState('signing');
              let lockedCid: string;
              let lockedSubmissionWasUncertain = false;
              let persistedCid: string | undefined;
              const createSubmissionRecord = (
                computedCid: string,
              ): NativeBatchSubmissionRecord => ({
                  kind: 'native-batch',
                  identity: executionIdentity,
                  cid: computedCid,
                  networkKey: sender.networkKey,
                  signerAddress: sender.address,
                  providerId: nativeProvider.metadata.id,
                  errorMode,
                  executionMethod,
                  recipientCount: prepared.recipientCount,
                  totalValueAttoFil: prepared.totalValueAttoFil.toString(),
                  createdAt: Date.now(),
                });
              const persistComputedCid = (computedCid: string) => {
                const record = createSubmissionRecord(computedCid);
                const persistenceError = writeNativeSubmissionRecord(record, storage);

                if (persistenceError) {
                  throw createNativeSubmissionStorageError(
                    persistenceError,
                    errorMode,
                  );
                }

                persistedCid = computedCid;
                setSubmissionSnapshot(record);
                setTxHash(computedCid);
                setState('pending');
              };

              try {
                const submission = await nativeProvider.signAndSubmitMessage(
                  preflight!.estimatedNativeMessage.message,
                  { onCidComputed: persistComputedCid },
                );
                lockedCid = submission.cid;
              } catch (cause) {
                if (!isNativeFilecoinSubmissionUncertainError(cause)) {
                  if (persistedCid) {
                    const cleanupError = removeNativeSubmissionRecord(
                      executionIdentity,
                      persistedCid,
                      storage,
                    );

                    if (cleanupError) {
                      throw createNativeSubmissionStorageError(
                        cleanupError,
                        errorMode,
                      );
                    }

                    setSubmissionSnapshot(undefined);
                    setTxHash(undefined);
                  }

                  throw cause;
                }

                lockedCid = cause.cid;
                lockedSubmissionWasUncertain = true;
              }

              if (!persistedCid) {
                try {
                  persistComputedCid(lockedCid);
                } catch (cause) {
                  const mappedStorageError =
                    cause instanceof BatchExecutionError
                      ? cause
                      : createNativeSubmissionStorageError(String(cause), errorMode);

                  persistedCid = lockedCid;
                  setSubmissionSnapshot(createSubmissionRecord(lockedCid));
                  setTxHash(lockedCid);
                  setState('failed');
                  setError(mappedStorageError);
                }
              } else if (persistedCid !== lockedCid) {
                lockedCid = persistedCid;
                lockedSubmissionWasUncertain = true;
              }

              return {
                cid: lockedCid,
                submissionWasUncertain: lockedSubmissionWasUncertain,
              };
            },
          );

          const confirmationContext = getConfirmationContext(preflight);

          if (!submissionWasUncertain) {
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
          }

          confirmationStarted = true;
          void waitForConfirmation(
            cid,
            confirmationContext,
            executionId,
            executionIdentity,
          ).then((canReleaseLock) => {
            if (
              canReleaseLock &&
              activeExecution.current?.promise === execution
            ) {
              activeExecution.current = undefined;
            }
          });

          return cid;
        } catch (cause) {
          const mappedError =
            cause instanceof NativeSignerLockError
              ? createNativeSignerLockExecutionError(cause, errorMode)
              : mapBatchExecutionError(cause, {
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
      })();

      activeExecution.current = {
        identity: executionIdentity,
        promise: execution,
      };

      void execution.then(
        () => {
          setIsWalletMutationUnsafe(false);
          if (
            !confirmationStarted &&
            activeExecution.current?.promise === execution
          ) {
            activeExecution.current = undefined;
          }
        },
        () => {
          setIsWalletMutationUnsafe(false);
          if (
            activeExecution.current?.promise === execution
          ) {
            activeExecution.current = undefined;
          }
        },
      );

      return execution;
    },
    [
      executionIdentity,
      provider,
      runPreflight,
      reconcileStoredSubmission,
      sender,
      storage,
      waitForConfirmation,
    ],
  );

  const reset = useCallback(() => {
    if (
      activeExecution.current ||
      storedSubmissions.records.length > 0 ||
      storedSubmissions.error
    ) {
      return;
    }

    executionSequence.current += 1;
    setState('idle');
    setTxHash(undefined);
    setError(undefined);
    setSubmissionSnapshot(undefined);
  }, [storedSubmissions.error, storedSubmissions.records.length]);

  const recheck = useCallback(async (): Promise<void> => {
    if (!executionIdentity) {
      throw new Error('Reconnect the native Filecoin signer used for this batch first.');
    }

    const current = readNativeSubmissionRecords(storage);

    if (current.error) {
      setState('failed');
      setError(createNativeSubmissionStorageError(current.error, 'ATOMIC'));
      return;
    }

    const persistedRecord = current.records.find(
      (candidate): candidate is NativeBatchSubmissionRecord =>
        candidate.kind === 'native-batch' &&
        candidate.identity === executionIdentity,
    );
    const record =
      persistedRecord ??
      (submissionSnapshot?.kind === 'native-batch' &&
      submissionSnapshot.identity === executionIdentity
        ? submissionSnapshot
        : undefined);

    if (!record) {
      throw new Error('There is no pending native batch to recheck for this signer.');
    }

    await reconcileStoredSubmission(record, 1, 0);
  }, [
    executionIdentity,
    reconcileStoredSubmission,
    storage,
    submissionSnapshot,
  ]);

  const isIdentityLocked = Boolean(
    activeExecution.current ||
      storedSubmissions.records.length > 0 ||
      storedSubmissions.error,
  );
  const isOperationLocked = Boolean(
    storedOperationSubmission ||
      (activeExecution.current &&
        activeExecution.current.identity.startsWith('native-batch:')),
  );

  return {
    executeBatch,
    estimateBatch,
    state,
    txHash,
    error,
    isIdentityLocked,
    isOperationLocked,
    isWalletMutationUnsafe,
    submissionSnapshot: storedOperationSubmission ?? submissionSnapshot,
    recheck,
    reset,
  };
}
