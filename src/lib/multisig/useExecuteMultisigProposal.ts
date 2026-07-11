import { useCallback, useRef, useState } from 'react';
import type { NativeFilecoinWalletProvider } from '../senders';
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
import { loadMultisigActorState, lotusMultisigRpc } from './rpc';

export interface UseExecuteMultisigProposalOptions {
  sender?: NativeFilecoinConnectedSender;
  provider?: NativeFilecoinWalletProvider;
  multisig?: MultisigActorState;
  network?: SendFilNetworkConfig;
  rpc?: MultisigPreflightRpc;
  pollMessageStatus?: typeof pollTransactionStatus;
  confirmationPollAttempts?: number;
  confirmationPollIntervalMs?: number;
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

export function useExecuteMultisigProposal({
  sender,
  provider,
  multisig,
  network,
  rpc,
  pollMessageStatus = pollTransactionStatus,
  confirmationPollAttempts = 60,
  confirmationPollIntervalMs = 5000,
}: UseExecuteMultisigProposalOptions = {}): UseExecuteMultisigProposalReturn {
  const [state, setState] = useState<BatchExecutionState>('idle');
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<BatchExecutionError | undefined>();
  const [proposalOutcome, setProposalOutcome] = useState<MultisigProposalOutcome | undefined>();
  const executionSequence = useRef(0);
  const activeExecution = useRef<Promise<string> | undefined>(undefined);

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
      preflight: PreparedMultisigProposalPreflight,
      executionId: number,
    ): Promise<boolean> => {
      try {
        const status: TransactionStatus = await pollMessageStatus(
          cid,
          confirmationPollAttempts,
          confirmationPollIntervalMs,
          preflight.sender.networkKey,
        );

        if (executionSequence.current !== executionId) {
          return false;
        }

        if (status.status === 'confirmed') {
          let outcome: MultisigProposalOutcome;

          try {
            if (!status.receipt) {
              throw new Error('Confirmed proposal is missing its message receipt');
            }

            outcome = decodeProposalOutcome(cid, status.receipt);
          } catch (cause) {
            setState('failed');
            setError(
              createActorReturnError(cid, status.receipt, preflight.preparedBatch.errorMode, cause),
            );
            return false;
          }

          setProposalOutcome(outcome);

          if (outcome.kind === 'applied-failure') {
            setState('failed');
            setError(createActorFailureError(outcome, preflight.preparedBatch.errorMode));
            return true;
          }

          setState('confirmed');
          return true;
        }

        if (!status.receipt || status.receipt.ExitCode === 0) {
          setState('failed');
          setError(
            createConfirmationUncertainError(
              cid,
              status.receipt,
              preflight.preparedBatch.errorMode,
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
            errorMode: preflight.preparedBatch.errorMode,
          },
        );

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
            preflight.preparedBatch.errorMode,
            cause,
          ),
        );
        return false;
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
      if (activeExecution.current) {
        return activeExecution.current;
      }

      let confirmationStarted = false;
      let execution: Promise<string>;

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

          const [availableBalance, signerBalance] = await Promise.all([
            (rpc?.multisig ?? lotusMultisigRpc).getAvailableBalance(
              currentMultisig.address,
              currentMultisig.networkKey,
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

          setState('signing');
          const { cid } = await nativeProvider.signAndSubmitMessage(preflight.estimatedMessage);

          setTxHash(cid);
          setState('pending');

          confirmationStarted = true;
          void waitForConfirmation(cid, preflight, executionId).then(
            (canReleaseLock) => {
              if (canReleaseLock && activeExecution.current === execution) {
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
            cause instanceof BatchExecutionError
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

      activeExecution.current = execution;

      void execution.then(
        () => {
          if (!confirmationStarted && activeExecution.current === execution) {
            activeExecution.current = undefined;
          }
        },
        () => {
          if (activeExecution.current === execution) {
            activeExecution.current = undefined;
          }
        },
      );

      return execution;
    },
    [multisig, provider, rpc?.multisig, runPreflight, sender, waitForConfirmation],
  );

  const reset = useCallback(() => {
    if (activeExecution.current) {
      return;
    }

    executionSequence.current += 1;
    setState('idle');
    setTxHash(undefined);
    setError(undefined);
    setProposalOutcome(undefined);
  }, []);

  return {
    executeBatch,
    estimateBatch,
    state,
    txHash,
    error,
    proposalOutcome,
    reset,
  };
}
