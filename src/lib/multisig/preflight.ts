import type { FilecoinMessage } from '../DataProvider/types';
import type { NativeFilecoinConnectedSender } from '../senders';
import {
  buildBatchGasEstimate,
  type BatchExecutionRecipient,
  type BatchGasEstimate,
  type PreparedBatchExecution,
} from '../transaction/batchExecution';
import type { ErrorMode } from '../transaction/multicall';
import type { ExecutionMethod } from '../batchConfiguration';
import { getNonce as getNativeNonce } from '../DataProvider';
import type { SendFilNetworkConfig, SendFilNetworkKey } from '../networks';
import type {
  MultisigActorState,
  MultisigPendingProposal,
} from './types';
import {
  buildCreateMultisigMessage,
  buildMultisigProposalMessage,
  buildProposalActionMessage,
} from './proposalBuilder';
import {
  getCurrentMultisigActorCodeCid,
  lotusMultisigRpc,
  type MultisigRpc,
} from './rpc';

export interface MultisigPreflightRpc {
  getNonce?: (address: string, networkKey: SendFilNetworkKey) => Promise<number>;
  estimateGas?: (
    message: FilecoinMessage,
    networkKey: SendFilNetworkKey,
  ) => Promise<FilecoinMessage>;
  multisig?: MultisigRpc;
}

export interface PreparedMultisigProposalPreflight {
  sender: NativeFilecoinConnectedSender;
  multisig: MultisigActorState;
  preparedBatch: PreparedBatchExecution;
  draftMessage: FilecoinMessage;
  estimatedMessage: FilecoinMessage;
  gasEstimate: BatchGasEstimate;
  proposalTarget: string;
  proposalValueAttoFil: bigint;
  proposalMethod: number;
  proposalParamsBytes: Uint8Array;
}

export interface PreparedMultisigCreatePreflight {
  sender: NativeFilecoinConnectedSender;
  draftMessage: FilecoinMessage;
  estimatedMessage: FilecoinMessage;
  gasEstimate: BatchGasEstimate;
  multisigActorCodeCid: string;
}

export interface PreparedMultisigActionPreflight {
  sender: NativeFilecoinConnectedSender;
  multisig: MultisigActorState;
  proposal: MultisigPendingProposal;
  draftMessage: FilecoinMessage;
  estimatedMessage: FilecoinMessage;
  gasEstimate: BatchGasEstimate;
}

function buildGasEstimate(message: FilecoinMessage): BatchGasEstimate {
  return buildBatchGasEstimate(
    BigInt(message.GasLimit),
    BigInt(message.GasFeeCap),
  );
}

function estimateGasWithFields(estimatedMessage: FilecoinMessage): {
  gasLimit: number;
  gasFeeCap: string;
  gasPremium: string;
} {
  return {
    gasLimit: estimatedMessage.GasLimit,
    gasFeeCap: estimatedMessage.GasFeeCap,
    gasPremium: estimatedMessage.GasPremium,
  };
}

export async function preflightMultisigProposal({
  sender,
  multisig,
  recipients,
  errorMode,
  executionMethod = 'STANDARD',
  network,
  rpc,
}: {
  sender: NativeFilecoinConnectedSender;
  multisig: MultisigActorState;
  recipients: BatchExecutionRecipient[];
  errorMode: ErrorMode;
  executionMethod?: ExecutionMethod;
  network: SendFilNetworkConfig;
  rpc?: MultisigPreflightRpc;
}): Promise<PreparedMultisigProposalPreflight> {
  const readNonce = rpc?.getNonce ?? getNativeNonce;
  const estimateGas =
    rpc?.estimateGas ??
    ((message: FilecoinMessage, networkKey: SendFilNetworkKey) =>
      lotusMultisigRpc.estimateGas(message, networkKey));
  const nonce = await readNonce(sender.address, sender.networkKey);
  const draft = buildMultisigProposalMessage({
    sender,
    multisig,
    recipients,
    errorMode,
    executionMethod,
    network,
    nonce,
  });
  const estimated = await estimateGas(draft.message, sender.networkKey);
  const withGas = buildMultisigProposalMessage({
    sender,
    multisig,
    recipients,
    errorMode,
    executionMethod,
    network,
    nonce,
    gas: estimateGasWithFields(estimated),
  });

  return {
    sender,
    multisig,
    preparedBatch: withGas.preparedBatch,
    draftMessage: draft.message,
    estimatedMessage: withGas.message,
    gasEstimate: buildGasEstimate(withGas.message),
    proposalTarget: withGas.targetFilecoinAddress,
    proposalValueAttoFil: withGas.preparedBatch.totalValueAttoFil,
    proposalMethod: withGas.proposalMethod,
    proposalParamsBytes: withGas.proposalParamsBytes,
  };
}

export async function preflightCreateMultisig({
  sender,
  signers,
  threshold,
  initialDepositAttoFil,
  unlockDuration = 0,
  startEpoch = 0,
  rpc,
}: {
  sender: NativeFilecoinConnectedSender;
  signers: string[];
  threshold: number;
  initialDepositAttoFil: bigint;
  unlockDuration?: number;
  startEpoch?: number;
  rpc?: MultisigPreflightRpc;
}): Promise<PreparedMultisigCreatePreflight> {
  const readNonce = rpc?.getNonce ?? getNativeNonce;
  const estimateGas =
    rpc?.estimateGas ??
    ((message: FilecoinMessage, networkKey: SendFilNetworkKey) =>
      lotusMultisigRpc.estimateGas(message, networkKey));
  const multisigRpc = rpc?.multisig ?? lotusMultisigRpc;
  const [nonce, multisigActorCodeCid] = await Promise.all([
    readNonce(sender.address, sender.networkKey),
    getCurrentMultisigActorCodeCid(sender.networkKey, multisigRpc),
  ]);
  const draftMessage = buildCreateMultisigMessage({
    sender,
    nonce,
    signers,
    threshold,
    initialDepositAttoFil,
    multisigActorCodeCid,
    unlockDuration,
    startEpoch,
  });
  const estimated = await estimateGas(draftMessage, sender.networkKey);
  const estimatedMessage = buildCreateMultisigMessage({
    sender,
    nonce,
    signers,
    threshold,
    initialDepositAttoFil,
    multisigActorCodeCid,
    unlockDuration,
    startEpoch,
    gas: estimateGasWithFields(estimated),
  });

  return {
    sender,
    draftMessage,
    estimatedMessage,
    gasEstimate: buildGasEstimate(estimatedMessage),
    multisigActorCodeCid,
  };
}

export async function preflightProposalAction({
  sender,
  multisig,
  proposal,
  action,
  rpc,
}: {
  sender: NativeFilecoinConnectedSender;
  multisig: MultisigActorState;
  proposal: MultisigPendingProposal;
  action: 'approve' | 'cancel';
  rpc?: MultisigPreflightRpc;
}): Promise<PreparedMultisigActionPreflight> {
  const readNonce = rpc?.getNonce ?? getNativeNonce;
  const estimateGas =
    rpc?.estimateGas ??
    ((message: FilecoinMessage, networkKey: SendFilNetworkKey) =>
      lotusMultisigRpc.estimateGas(message, networkKey));
  const nonce = await readNonce(sender.address, sender.networkKey);
  const draftMessage = buildProposalActionMessage({
    sender,
    multisig,
    proposal,
    action,
    nonce,
  });
  const estimated = await estimateGas(draftMessage, sender.networkKey);
  const estimatedMessage = buildProposalActionMessage({
    sender,
    multisig,
    proposal,
    action,
    nonce,
    gas: estimateGasWithFields(estimated),
  });

  return {
    sender,
    multisig,
    proposal,
    draftMessage,
    estimatedMessage,
    gasEstimate: buildGasEstimate(estimatedMessage),
  };
}
