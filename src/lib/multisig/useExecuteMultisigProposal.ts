import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeFilecoinWalletProvider } from '../senders';
import { isNativeFilecoinSubmissionUncertainError } from '../senders/nativeFilecoinSubmission';
import {
  NativeSignerLockError,
  withNativeSignerLock,
} from '../senders/nativeSignerLock';
import {
  getMultisigProposalSubmissionIdentity,
  readNativeSubmissionRecords,
  removeNativeSubmissionRecord,
  verifyNativeSubmissionStorage,
  writeNativeSubmissionRecord,
  type MultisigProposalSubmissionRecord,
} from '../senders/nativeSubmissionStorage';
import type { NativeFilecoinConnectedSender } from '../senders/types';
import type { BatchExecutionRecipient, BatchGasEstimate } from '../transaction/batchExecution';
import type { ErrorMode } from '../transaction/multicall';
import type { ExecutionMethod } from '../batchConfiguration';
import type { BatchExecutionState } from '../transaction/useExecuteBatch';
import { BatchExecutionError, mapBatchExecutionError } from '../transaction/errorHandling';
import { pollTransactionStatus } from '../DataProvider';
import type { MessageReceipt, TransactionStatus } from '../DataProvider/types';
import type { SendFilNetworkConfig } from '../networks';
import type { MultisigActorState } from './types';
import { bytesToHex, decodeProposeReturn } from './actorParams';
import {
  preflightMultisigProposal,
  type MultisigPreflightRpc,
  type PreparedMultisigProposalPreflight,
} from './preflight';
import {
  getMultisigSnapshotTipSetKey,
  loadMultisigActorState,
  lotusMultisigRpc,
} from './rpc';

export interface UseExecuteMultisigProposalOptions {
  sender?: NativeFilecoinConnectedSender;
  provider?: NativeFilecoinWalletProvider;
  multisig?: MultisigActorState;
  network?: SendFilNetworkConfig;
  rpc?: MultisigPreflightRpc;
  pollMessageStatus?: typeof pollTransactionStatus;
  confirmationPollAttempts?: number;
  confirmationPollIntervalMs?: number;
  storage?: Storage;
}

export interface UseExecuteMultisigProposalReturn {
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
  proposalOutcome?: MultisigProposalOutcome;
  isIdentityLocked: boolean;
  isOperationLocked: boolean;
  isWalletMutationUnsafe: boolean;
  submissionSnapshot?: MultisigProposalSubmissionRecord;
  recheck: () => Promise<void>;
  reset: () => void;
}

interface MultisigProposalOutcomeBase {
  cid: string;
  txnId: number;
  returnData: Uint8Array;
  receipt: MessageReceipt;
}

export type MultisigProposalOutcome =
  | (MultisigProposalOutcomeBase & {
      kind: 'queued';
      applied: false;
      code: 0;
    })
  | (MultisigProposalOutcomeBase & {
      kind: 'applied-success';
      applied: true;
      code: 0;
    })
  | (MultisigProposalOutcomeBase & {
      kind: 'applied-failure';
      applied: true;
      code: number;
    });

type SignAndSubmitNativeProvider = NativeFilecoinWalletProvider & {
  signAndSubmitMessage: NonNullable<NativeFilecoinWalletProvider['signAndSubmitMessage']>;
};

interface ActiveMultisigExecution {
  identity: string;
  promise: Promise<string>;
}

interface MultisigConfirmationContext {
  networkKey: NativeFilecoinConnectedSender['networkKey'];
  errorMode: ErrorMode;
}

function assertReady<T>(value: T | undefined, message: string): asserts value is T {
  if (!value) {
    throw new Error(message);
  }
}

function getNativeExecutionProvider(
  provider: NativeFilecoinWalletProvider | undefined,
): SignAndSubmitNativeProvider {
  assertReady(provider, 'No native Filecoin wallet provider is connected.');

  if (!provider.signAndSubmitMessage) {
    throw new Error(`${provider.metadata.name} cannot sign and submit Filecoin messages.`);
  }

  return provider as SignAndSubmitNativeProvider;
}

function createInsufficientFundsError(message: string, errorMode: ErrorMode): BatchExecutionError {
  return new BatchExecutionError({
    category: 'INSUFFICIENT_FUNDS',
    title: 'Insufficient funds',
    message,
    errorMode,
    stage: 'execution',
    recoverable: true,
    hint: 'Review balances and try again.',
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

function receiptDiagnostics(cid: string, receipt?: MessageReceipt): string {
  const diagnostics = [`CID: ${cid}`];

  if (receipt) {
    diagnostics.push(
      `outer exit code: ${receipt.ExitCode}`,
      `gas used: ${receipt.GasUsed}`,
      `outer return: ${receipt.Return || '<empty>'}`,
    );
  }

  return diagnostics.join('; ');
}

function decodeProposalOutcome(cid: string, receipt: MessageReceipt): MultisigProposalOutcome {
  const decoded = decodeProposeReturn(receipt.Return);
  const base = {
    cid,
    txnId: decoded.txnId,
    returnData: decoded.ret,
    receipt,
  };

  if (!decoded.applied) {
    if (decoded.code !== 0 || decoded.ret.length !== 0) {
      throw new Error('Queued ProposeReturn must have exit code 0 and empty return data');
    }

    return {
      ...base,
      kind: 'queued',
      applied: false,
      code: 0,
    };
  }

  if (decoded.code === 0) {
    return {
      ...base,
      kind: 'applied-success',
      applied: true,
      code: 0,
    };
  }

  return {
    ...base,
    kind: 'applied-failure',
    applied: true,
    code: decoded.code,
  };
}

function createActorFailureError(
  outcome: Extract<MultisigProposalOutcome, { kind: 'applied-failure' }>,
  errorMode: ErrorMode,
): BatchExecutionError {
  return new BatchExecutionError({
    category: errorMode === 'ATOMIC' ? 'ONCHAIN_REVERT_ATOMIC' : 'UNKNOWN',
    title: 'Multisig batch execution failed',
    message:
      `The multisig proposal was confirmed, but the proposed batch failed ` +
      `with inner exit code ${outcome.code}.`,
    errorMode,
    stage: 'confirmation',
    recoverable: true,
    hint: 'Inspect the confirmed proposal before correcting the batch and trying again.',
    details: [
      receiptDiagnostics(outcome.cid, outcome.receipt),
      `multisig transaction ID: ${outcome.txnId}`,
      `inner exit code: ${outcome.code}`,
      `inner return: ${bytesToHex(outcome.returnData)}`,
    ].join('; '),
    cause: outcome,
  });
}

function createActorReturnError(
  cid: string,
  receipt: MessageReceipt | undefined,
  errorMode: ErrorMode,
  cause: unknown,
): BatchExecutionError {
  const decodeMessage = cause instanceof Error ? cause.message : String(cause);

  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: 'Could not verify multisig batch outcome',
    message:
      'The proposal message was confirmed, but its actor return could not be decoded. ' +
      'Check the transaction before attempting another send.',
    errorMode,
    stage: 'confirmation',
    recoverable: false,
    hint: 'Inspect the confirmed CID in Filfox before retrying to avoid a duplicate batch.',
    details: `${receiptDiagnostics(cid, receipt)}; decode error: ${decodeMessage}`,
    cause,
  });
}

function createConfirmationUncertainError(
  cid: string,
  receipt: MessageReceipt | undefined,
  errorMode: ErrorMode,
  cause: unknown,
): BatchExecutionError {
  const details = cause instanceof Error ? cause.message : String(cause);

  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: 'Multisig proposal confirmation is uncertain',
    message:
      'SendFIL could not prove that the submitted proposal reached a terminal on-chain result. ' +
      'The original CID may still land, so submitting this batch again could duplicate payments.',
    errorMode,
    stage: 'confirmation',
    recoverable: false,
    hint: 'Inspect the submitted CID in Filfox or your wallet before taking another action.',
    details: `${receiptDiagnostics(cid, receipt)}; confirmation error: ${details}`,
    cause,
  });
}

function createMultisigSubmissionStorageError(
  message: string,
  errorMode: ErrorMode,
): BatchExecutionError {
  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: 'Multisig submission safety storage is unavailable',
    message,
    errorMode,
    stage: 'execution',
    recoverable: false,
    hint:
      'Restore browser storage access before signing. If a CID is already shown, inspect it before changing storage or retrying.',
  });
}

function createMultisigExecutionIdentityLockError(
  errorMode: ErrorMode,
): BatchExecutionError {
  return new BatchExecutionError({
    category: 'UNKNOWN',
    title: 'Another multisig proposal is still unresolved',
    message:
      'A proposal started with a different multisig or signer identity has not reached a proven terminal result.',
    errorMode,
    stage: 'execution',
    recoverable: false,
    hint: 'Reconnect the original identity and inspect its CID before proposing another batch.',
  });
}

export function useExecuteMultisigProposal({
  sender,
  provider,
  multisig,
  network,
  rpc,
  pollMessageStatus = pollTransactionStatus,
  confirmationPollAttempts = 60,
  confirmationPollIntervalMs = 5000,
  storage,
}: UseExecuteMultisigProposalOptions = {}): UseExecuteMultisigProposalReturn {
  const [state, setState] = useState<BatchExecutionState>('idle');
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<BatchExecutionError | undefined>();
  const [proposalOutcome, setProposalOutcome] = useState<MultisigProposalOutcome | undefined>();
  const [submissionSnapshot, setSubmissionSnapshot] =
    useState<MultisigProposalSubmissionRecord>();
  const [isWalletMutationUnsafe, setIsWalletMutationUnsafe] = useState(false);
  const executionSequence = useRef(0);
  const activeExecution = useRef<ActiveMultisigExecution | undefined>(undefined);
  const confirmationInFlight = useRef(false);
  const executionIdentity =
    sender && multisig
      ? getMultisigProposalSubmissionIdentity({
          networkKey: sender.networkKey,
          signerAddress: sender.address,
          multisigAddress: multisig.address,
        })
      : undefined;
  const storedSubmissions = readNativeSubmissionRecords(storage);
  const storedSubmission = executionIdentity
    ? storedSubmissions.records.find(
        (record): record is MultisigProposalSubmissionRecord =>
          record.kind === 'multisig-proposal' &&
          record.identity === executionIdentity,
      )
    : undefined;
  const storedOperationSubmission = storedSubmissions.records.find(
    (record): record is MultisigProposalSubmissionRecord =>
      record.kind === 'multisig-proposal',
  );

  const runPreflight = useCallback(
    (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
      executionMethod: ExecutionMethod = 'STANDARD',
      currentMultisig: MultisigActorState | undefined = multisig,
    ): Promise<PreparedMultisigProposalPreflight> => {
      assertReady(sender, 'No connected native Filecoin signer is available.');
      assertReady(currentMultisig, 'No Filecoin native multisig is selected.');
      assertReady(network, 'No supported SendFIL network is selected.');
      getNativeExecutionProvider(provider);

      return preflightMultisigProposal({
        sender,
        multisig: currentMultisig,
        recipients,
        errorMode,
        executionMethod,
        network,
        rpc,
      });
    },
    [multisig, network, provider, rpc, sender],
  );

  const waitForConfirmation = useCallback(
    async (
      cid: string,
      context: MultisigConfirmationContext,
      executionId: number,
      identity: string,
      pollAttempts = confirmationPollAttempts,
      pollIntervalMs = confirmationPollIntervalMs,
    ): Promise<boolean> => {
      confirmationInFlight.current = true;

      try {
        const status: TransactionStatus = await pollMessageStatus(
          cid,
          pollAttempts,
          pollIntervalMs,
          context.networkKey,
        );

        if (executionSequence.current !== executionId) {
          return false;
        }

        if (
          status.status === 'confirmed' &&
          status.receipt &&
          status.receipt.ExitCode === 0
        ) {
          let outcome: MultisigProposalOutcome;

          try {
            outcome = decodeProposalOutcome(cid, status.receipt);
          } catch (cause) {
            setState('failed');
            setError(
              createActorReturnError(cid, status.receipt, context.errorMode, cause),
            );
            return false;
          }

          const storageError = removeNativeSubmissionRecord(identity, cid, storage);

          if (storageError) {
            setState('failed');
            setError(
              createMultisigSubmissionStorageError(storageError, context.errorMode),
            );
            return false;
          }

          setProposalOutcome(outcome);

          if (outcome.kind === 'applied-failure') {
            setState('failed');
            setError(createActorFailureError(outcome, context.errorMode));
            return true;
          }

          setState('confirmed');
          return true;
        }

        if (status.status === 'confirmed') {
          setState('failed');
          setError(
            createConfirmationUncertainError(
              cid,
              status.receipt,
              context.errorMode,
              new Error(
                status.receipt
                  ? `Confirmed proposal carried nonzero outer exit code ${status.receipt.ExitCode}.`
                  : 'Confirmed proposal is missing its message receipt.',
              ),
            ),
          );
          return false;
        }

        if (!status.receipt || status.receipt.ExitCode === 0) {
          setState('failed');
          setError(
            createConfirmationUncertainError(
              cid,
              status.receipt,
              context.errorMode,
              new Error(status.error ?? 'The proposal has no terminal receipt.'),
            ),
          );
          return false;
        }

        const mappedError = mapBatchExecutionError(
          new Error(
            `${status.error ?? 'Multisig proposal failed on-chain.'}; ` +
              receiptDiagnostics(cid, status.receipt),
          ),
          {
            stage: 'confirmation',
            errorMode: context.errorMode,
          },
        );

        const storageError = removeNativeSubmissionRecord(identity, cid, storage);

        if (storageError) {
          setState('failed');
          setError(
            createMultisigSubmissionStorageError(storageError, context.errorMode),
          );
          return false;
        }

        setState('failed');
        setError(mappedError);
        return true;
      } catch (cause) {
        if (executionSequence.current !== executionId) {
          return false;
        }

        setState('failed');
        setError(
          createConfirmationUncertainError(
            cid,
            undefined,
            context.errorMode,
            cause,
          ),
        );
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
      record: MultisigProposalSubmissionRecord,
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
      setProposalOutcome(undefined);
      setError(undefined);
      setState('pending');

      const canReleaseLock = await waitForConfirmation(
        record.cid,
        {
          networkKey: record.networkKey,
          errorMode: record.errorMode,
        },
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
        createMultisigSubmissionStorageError(
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
      try {
        const preflight = await runPreflight(recipients, errorMode, executionMethod);
        return preflight.gasEstimate;
      } catch (cause) {
        throw mapBatchExecutionError(cause, {
          stage: 'preflight',
          errorMode,
        });
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
            new Error('No native Filecoin multisig identity is selected.'),
            { stage: 'execution', errorMode },
          ),
        );
      }

      const latestStoredSubmissions = readNativeSubmissionRecords(storage);

      if (latestStoredSubmissions.error) {
        return Promise.reject(
          createMultisigSubmissionStorageError(
            latestStoredSubmissions.error,
            errorMode,
          ),
        );
      }

      const latestStoredSubmission = latestStoredSubmissions.records.find(
        (record): record is MultisigProposalSubmissionRecord =>
          record.kind === 'multisig-proposal' &&
          record.identity === executionIdentity,
      );

      if (activeExecution.current) {
        if (activeExecution.current.identity === executionIdentity) {
          return activeExecution.current.promise;
        }

        return Promise.reject(
          createMultisigExecutionIdentityLockError(errorMode),
        );
      }

      if (
        latestStoredSubmission &&
        latestStoredSubmissions.records.length === 1
      ) {
        void reconcileStoredSubmission(latestStoredSubmission);
        return Promise.resolve(latestStoredSubmission.cid);
      }

      if (latestStoredSubmissions.records.length > 0) {
        return Promise.reject(
          createMultisigExecutionIdentityLockError(errorMode),
        );
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
        setProposalOutcome(undefined);

        let preflight: PreparedMultisigProposalPreflight | undefined;
        let failureStage: 'preflight' | 'execution' = 'preflight';

        try {
          assertReady(sender, 'No connected native Filecoin signer is available.');
          assertReady(multisig, 'No Filecoin native multisig is selected.');
          const nativeProvider = getNativeExecutionProvider(provider);
          const currentMultisig = await loadMultisigActorState({
            address: multisig.address,
            connectedSignerAddress: sender.address,
            networkKey: multisig.networkKey,
            rpc: rpc?.multisig ?? lotusMultisigRpc,
          });
          const currentMultisigIdAddress = currentMultisig.idAddress;

          assertReady(
            currentMultisigIdAddress,
            'The selected multisig did not resolve to a Filecoin actor ID address.',
          );

          if (!currentMultisig.connectedSignerCanApprove) {
            throw new BatchExecutionError({
              category: 'UNKNOWN',
              title: 'Signer no longer authorized',
              message: 'The connected native signer is no longer a signer on this multisig.',
              errorMode,
              stage: 'preflight',
              recoverable: true,
              hint: 'Refresh the multisig and connect a current signer before trying again.',
            });
          }

          preflight = await runPreflight(recipients, errorMode, executionMethod, currentMultisig);

          failureStage = 'execution';

          const multisigRpc = rpc?.multisig ?? lotusMultisigRpc;
          const balanceTipSetKey = await getMultisigSnapshotTipSetKey(
            currentMultisig.networkKey,
            multisigRpc,
          );
          const [availableBalance, signerBalance] = await Promise.all([
            multisigRpc.getAvailableBalance(
              currentMultisigIdAddress,
              currentMultisig.networkKey,
              balanceTipSetKey,
            ),
            nativeProvider.getBalance({
              address: sender.address,
              networkKey: sender.networkKey,
              nativePrefix: sender.nativePrefix,
            }),
          ]);

          if (availableBalance < preflight.preparedBatch.totalValueAttoFil) {
            throw createInsufficientFundsError(
              'The selected multisig spendable balance is lower than the prepared batch total.',
              errorMode,
            );
          }

          if (signerBalance < preflight.gasEstimate.estimatedFee) {
            throw createInsufficientFundsError(
              'The connected signer balance is lower than the estimated proposal gas fee.',
              errorMode,
            );
          }

          const storageVerificationError = verifyNativeSubmissionStorage(storage);

          if (storageVerificationError) {
            throw createMultisigSubmissionStorageError(
              storageVerificationError,
              errorMode,
            );
          }

          const preSigningRecords = readNativeSubmissionRecords(storage);
          if (preSigningRecords.error) {
            throw createMultisigSubmissionStorageError(
              preSigningRecords.error,
              errorMode,
            );
          }

          if (preSigningRecords.records.length > 0) {
            throw createMultisigExecutionIdentityLockError(errorMode);
          }

          const cid = await withNativeSignerLock(
            {
              networkKey: sender.networkKey,
              signerAddress: sender.address,
              storage,
            },
            async () => {
              setState('signing');
              let lockedCid: string;
              let persistedCid: string | undefined;
              const createSubmissionRecord = (
                computedCid: string,
              ): MultisigProposalSubmissionRecord => ({
                  kind: 'multisig-proposal',
                  identity: executionIdentity,
                  cid: computedCid,
                  networkKey: sender.networkKey,
                  signerAddress: sender.address,
                  providerId: nativeProvider.metadata.id,
                  multisigAddress: currentMultisig.address,
                  errorMode,
                  executionMethod,
                  recipientCount: preflight!.preparedBatch.recipientCount,
                  totalValueAttoFil:
                    preflight!.preparedBatch.totalValueAttoFil.toString(),
                  createdAt: Date.now(),
                });
              const persistComputedCid = (computedCid: string) => {
                const record = createSubmissionRecord(computedCid);
                const persistenceError = writeNativeSubmissionRecord(record, storage);

                if (persistenceError) {
                  throw createMultisigSubmissionStorageError(
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
                  preflight!.estimatedMessage,
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
                      throw createMultisigSubmissionStorageError(
                        cleanupError,
                        errorMode,
                      );
                    }
                  }

                  throw cause;
                }

                lockedCid = cause.cid;
              }

              if (!persistedCid) {
                try {
                  persistComputedCid(lockedCid);
                } catch (cause) {
                  const mappedStorageError =
                    cause instanceof BatchExecutionError
                      ? cause
                      : createMultisigSubmissionStorageError(String(cause), errorMode);

                  persistedCid = lockedCid;
                  setSubmissionSnapshot(createSubmissionRecord(lockedCid));
                  setTxHash(lockedCid);
                  setState('failed');
                  setError(mappedStorageError);
                }
              } else if (persistedCid !== lockedCid) {
                lockedCid = persistedCid;
              }

              return lockedCid;
            },
          );

          const confirmationContext: MultisigConfirmationContext = {
            networkKey: sender.networkKey,
            errorMode,
          };

          confirmationStarted = true;
          void waitForConfirmation(
            cid,
            confirmationContext,
            executionId,
            executionIdentity,
          ).then(
            (canReleaseLock) => {
              if (
                canReleaseLock &&
                activeExecution.current?.promise === execution
              ) {
                activeExecution.current = undefined;
              }
            },
            () => {
              // Preserve the lock if confirmation reconciliation itself fails unexpectedly.
            },
          );

          return cid;
        } catch (cause) {
          const mappedError =
            cause instanceof NativeSignerLockError
              ? createNativeSignerLockExecutionError(cause, errorMode)
              : cause instanceof BatchExecutionError
              ? cause
              : mapBatchExecutionError(cause, {
                  stage: failureStage,
                  errorMode,
                });

          if (executionSequence.current !== executionId) {
            throw mappedError;
          }

          setState('failed');
          setError(mappedError);
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
          if (activeExecution.current?.promise === execution) {
            activeExecution.current = undefined;
          }
        },
      );

      return execution;
    },
    [
      executionIdentity,
      multisig,
      provider,
      rpc?.multisig,
      reconcileStoredSubmission,
      runPreflight,
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
    setProposalOutcome(undefined);
    setSubmissionSnapshot(undefined);
  }, [storedSubmissions.error, storedSubmissions.records.length]);

  const recheck = useCallback(async (): Promise<void> => {
    if (!executionIdentity) {
      throw new Error('Reconnect the signer and multisig used for this proposal first.');
    }

    const current = readNativeSubmissionRecords(storage);

    if (current.error) {
      setState('failed');
      setError(createMultisigSubmissionStorageError(current.error, 'ATOMIC'));
      return;
    }

    const persistedRecord = current.records.find(
      (candidate): candidate is MultisigProposalSubmissionRecord =>
        candidate.kind === 'multisig-proposal' &&
        candidate.identity === executionIdentity,
    );
    const record =
      persistedRecord ??
      (submissionSnapshot?.kind === 'multisig-proposal' &&
      submissionSnapshot.identity === executionIdentity
        ? submissionSnapshot
        : undefined);

    if (!record) {
      throw new Error('There is no pending multisig proposal to recheck for this identity.');
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
        activeExecution.current.identity.startsWith('multisig-proposal:')),
  );

  return {
    executeBatch,
    estimateBatch,
    state,
    txHash,
    error,
    proposalOutcome,
    isIdentityLocked,
    isOperationLocked,
    isWalletMutationUnsafe,
    submissionSnapshot: storedOperationSubmission ?? submissionSnapshot,
    recheck,
    reset,
  };
}
