import { useCallback, useRef, useState } from 'react';
import type { NativeFilecoinWalletProvider } from '../senders';
import type { NativeFilecoinConnectedSender } from '../senders/types';
import type {
  BatchExecutionRecipient,
  BatchGasEstimate,
} from '../transaction/batchExecution';
import type { ErrorMode } from '../transaction/multicall';
import type { ExecutionMethod } from '../batchConfiguration';
import type { BatchExecutionState } from '../transaction/useExecuteBatch';
import {
  BatchExecutionError,
  mapBatchExecutionError,
} from '../transaction/errorHandling';
import { pollTransactionStatus } from '../DataProvider';
import type { TransactionStatus } from '../DataProvider/types';
import type { SendFilNetworkConfig } from '../networks';
import type { MultisigActorState } from './types';
import {
  preflightMultisigProposal,
  type MultisigPreflightRpc,
  type PreparedMultisigProposalPreflight,
} from './preflight';
import { lotusMultisigRpc } from './rpc';

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
  reset: () => void;
}

type SignAndSubmitNativeProvider = NativeFilecoinWalletProvider & {
  signAndSubmitMessage: NonNullable<NativeFilecoinWalletProvider['signAndSubmitMessage']>;
};

function assertReady<T>(
  value: T | undefined,
  message: string,
): asserts value is T {
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
  const executionSequence = useRef(0);

  const runPreflight = useCallback(
    (
      recipients: BatchExecutionRecipient[],
      errorMode: ErrorMode,
      executionMethod: ExecutionMethod = 'STANDARD',
    ): Promise<PreparedMultisigProposalPreflight> => {
      assertReady(sender, 'No connected native Filecoin signer is available.');
      assertReady(multisig, 'No Filecoin native multisig is selected.');
      assertReady(network, 'No supported SendFIL network is selected.');
      getNativeExecutionProvider(provider);

      return preflightMultisigProposal({
        sender,
        multisig,
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
    ) => {
      try {
        const status: TransactionStatus = await pollMessageStatus(
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
          return;
        }

        const mappedError = mapBatchExecutionError(
          new Error(status.error ?? 'Multisig proposal failed on-chain.'),
          {
            stage: 'confirmation',
            errorMode: preflight.preparedBatch.errorMode,
          },
        );

        setState('failed');
        setError(mappedError);
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

      let preflight: PreparedMultisigProposalPreflight | undefined;
      let failureStage: 'preflight' | 'execution' = 'preflight';

      try {
        assertReady(sender, 'No connected native Filecoin signer is available.');
        assertReady(multisig, 'No Filecoin native multisig is selected.');
        const nativeProvider = getNativeExecutionProvider(provider);
        preflight = await runPreflight(recipients, errorMode, executionMethod);

        failureStage = 'execution';

        const [availableBalance, signerBalance] = await Promise.all([
          (rpc?.multisig ?? lotusMultisigRpc).getAvailableBalance(
            multisig.address,
            multisig.networkKey,
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
        const { cid } = await nativeProvider.signAndSubmitMessage(
          preflight.estimatedMessage,
        );

        setTxHash(cid);
        setState('pending');

        void waitForConfirmation(cid, preflight, executionId);

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
    },
    [multisig, provider, rpc?.multisig, runPreflight, sender, waitForConfirmation],
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

