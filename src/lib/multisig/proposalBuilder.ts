import type { FilecoinMessage } from '../DataProvider/types';
import type { NativeFilecoinConnectedSender } from '../senders';
import {
  prepareBatchExecution,
  type BatchExecutionRecipient,
  type PreparedBatchExecution,
} from '../transaction/batchExecution';
import {
  INVOKE_EVM_METHOD_NUMBER,
} from '../transaction/nativeBatchMessage';
import type { ErrorMode } from '../transaction/multicall';
import type { ExecutionMethod } from '../batchConfiguration';
import type { SendFilNetworkConfig } from '../networks';
import { toF4 } from '../../utils/toF4';
import type {
  MultisigActorState,
  MultisigPendingProposal,
} from './types';
import {
  METHODS_INIT_EXEC,
  METHODS_MULTISIG_APPROVE,
  METHODS_MULTISIG_CANCEL,
  METHODS_MULTISIG_PROPOSE,
  bytesToParamsBase64,
  computeProposalHash,
  decodeInvokeEvmParamsBase64,
  encodeConstructorParams,
  encodeInitExecParams,
  encodeProposeParams,
  encodeTxnIDParams,
  getInitActorAddress,
} from './actorParams';

export interface BuildCreateMultisigMessageParams {
  sender: NativeFilecoinConnectedSender;
  nonce: number;
  signers: string[];
  threshold: number;
  initialDepositAttoFil: bigint;
  multisigActorCodeCid: string;
  unlockDuration?: number;
  startEpoch?: number;
  gas?: {
    gasLimit?: number;
    gasFeeCap?: string;
    gasPremium?: string;
  };
}

export interface BuildMultisigProposalMessageParams {
  sender: NativeFilecoinConnectedSender;
  multisig: MultisigActorState;
  recipients: BatchExecutionRecipient[];
  errorMode: ErrorMode;
  executionMethod?: ExecutionMethod;
  network: SendFilNetworkConfig;
  nonce: number;
  gas?: {
    gasLimit?: number;
    gasFeeCap?: string;
    gasPremium?: string;
  };
}

export interface BuiltMultisigProposalMessage {
  message: FilecoinMessage;
  preparedBatch: PreparedBatchExecution;
  targetFilecoinAddress: string;
  proposalMethod: typeof INVOKE_EVM_METHOD_NUMBER;
  proposalParamsBytes: Uint8Array;
}

export interface BuildProposalActionMessageParams {
  sender: NativeFilecoinConnectedSender;
  multisig: MultisigActorState;
  proposal: MultisigPendingProposal;
  nonce: number;
  action: 'approve' | 'cancel';
  gas?: {
    gasLimit?: number;
    gasFeeCap?: string;
    gasPremium?: string;
  };
}

function buildGasFields(gas?: {
  gasLimit?: number;
  gasFeeCap?: string;
  gasPremium?: string;
}): Pick<FilecoinMessage, 'GasLimit' | 'GasFeeCap' | 'GasPremium'> {
  return {
    GasLimit: gas?.gasLimit ?? 0,
    GasFeeCap: gas?.gasFeeCap ?? '0',
    GasPremium: gas?.gasPremium ?? '0',
  };
}

function assertSenderMatchesNetwork(
  sender: NativeFilecoinConnectedSender,
  network: SendFilNetworkConfig,
): void {
  if (sender.networkKey !== network.key || sender.chainId !== network.chainId) {
    throw new Error(
      `Native signer network ${sender.networkKey} does not match ${network.key}.`,
    );
  }
}

export function buildCreateMultisigMessage({
  sender,
  nonce,
  signers,
  threshold,
  initialDepositAttoFil,
  multisigActorCodeCid,
  unlockDuration = 0,
  startEpoch = 0,
  gas,
}: BuildCreateMultisigMessageParams): FilecoinMessage {
  const constructorParams = encodeConstructorParams({
    signers,
    threshold,
    unlockDuration,
    startEpoch,
  });
  const execParams = encodeInitExecParams({
    codeCid: multisigActorCodeCid,
    constructorParams,
  });

  return {
    Version: 0,
    To: getInitActorAddress(sender.networkKey),
    From: sender.address,
    Nonce: nonce,
    Value: initialDepositAttoFil.toString(),
    Method: METHODS_INIT_EXEC,
    Params: bytesToParamsBase64(execParams),
    ...buildGasFields(gas),
  };
}

export function buildMultisigProposalMessage({
  sender,
  multisig,
  recipients,
  errorMode,
  executionMethod = 'STANDARD',
  network,
  nonce,
  gas,
}: BuildMultisigProposalMessageParams): BuiltMultisigProposalMessage {
  assertSenderMatchesNetwork(sender, network);

  if (multisig.networkKey !== sender.networkKey) {
    throw new Error('Selected multisig network does not match the connected signer.');
  }

  if (!multisig.connectedSignerCanApprove) {
    throw new Error('Connected native signer is not a signer on the selected multisig.');
  }

  const preparedBatch = prepareBatchExecution(
    recipients,
    errorMode,
    network,
    executionMethod,
  );
  const targetFilecoinAddress = toF4(preparedBatch.batch.to, sender.nativePrefix);
  const proposalParamsBytes = decodeInvokeEvmParamsBase64(preparedBatch.batch.data);
  const proposeParams = encodeProposeParams({
    to: targetFilecoinAddress,
    valueAttoFil: preparedBatch.totalValueAttoFil,
    method: INVOKE_EVM_METHOD_NUMBER,
    params: proposalParamsBytes,
  });

  return {
    message: {
      Version: 0,
      To: multisig.address,
      From: sender.address,
      Nonce: nonce,
      Value: '0',
      Method: METHODS_MULTISIG_PROPOSE,
      Params: bytesToParamsBase64(proposeParams),
      ...buildGasFields(gas),
    },
    preparedBatch,
    targetFilecoinAddress,
    proposalMethod: INVOKE_EVM_METHOD_NUMBER,
    proposalParamsBytes,
  };
}

export function buildProposalActionMessage({
  sender,
  multisig,
  proposal,
  nonce,
  action,
  gas,
}: BuildProposalActionMessageParams): FilecoinMessage {
  if (!proposal.proposerIdAddress) {
    throw new Error('Cannot approve a proposal without a proposer ID address.');
  }

  const proposalHash =
    proposal.proposalHash ??
    computeProposalHash({
      requesterIdAddress: proposal.proposerIdAddress,
      to: proposal.to,
      valueAttoFil: proposal.valueAttoFil,
      method: proposal.method,
      params: proposal.paramsBytes,
    });
  const txnParams = encodeTxnIDParams({
    id: proposal.id,
    proposalHash,
  });

  return {
    Version: 0,
    To: multisig.address,
    From: sender.address,
    Nonce: nonce,
    Value: '0',
    Method:
      action === 'approve' ? METHODS_MULTISIG_APPROVE : METHODS_MULTISIG_CANCEL,
    Params: bytesToParamsBase64(txnParams),
    ...buildGasFields(gas),
  };
}

