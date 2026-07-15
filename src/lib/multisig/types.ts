import type { FilecoinMessage } from '../DataProvider/types';
import type { NetworkPrefix, SendFilNetworkConfig, SendFilNetworkKey } from '../networks';
import type {
  BatchExecutionRecipient,
  BatchGasEstimate,
  PreparedBatchExecution,
} from '../transaction/batchExecution';

export type NativeMultisigAddress = `${NetworkPrefix}2${string}`;
export type NativeSignerAddress = `${NetworkPrefix}1${string}`;

export interface SavedMultisig {
  address: NativeMultisigAddress;
  networkKey: SendFilNetworkKey;
  robustAddress?: NativeMultisigAddress;
  idAddress?: string;
  label?: string;
  addedAt: string;
  updatedAt: string;
}

export interface MultisigActorState {
  address: NativeMultisigAddress;
  networkKey: SendFilNetworkKey;
  robustAddress?: NativeMultisigAddress;
  idAddress?: string;
  balanceAttoFil: bigint;
  availableBalanceAttoFil: bigint;
  lockedBalanceAttoFil?: bigint;
  threshold: number;
  signers: string[];
  signerIdAddresses: string[];
  signerIdentityStatusKnown: boolean;
  connectedSignerIdAddress?: string;
  connectedSignerMembershipKnown: boolean;
  connectedSignerCanApprove: boolean;
  startEpoch?: number;
  unlockDuration?: number;
}

export interface MultisigVestingSchedule {
  initialBalanceAttoFil?: bigint;
  startEpoch?: number;
  unlockDuration?: number;
  lockedBalanceAttoFil?: bigint;
}

export interface DecodedMultisigProposalPayment {
  index: number;
  kind: 'EVM' | 'FILECOIN';
  recipient: string;
  amountAttoFil: string;
}

export interface DecodedMultisigProposalBatch {
  executionMethod: 'STANDARD' | 'THINBATCH';
  errorMode: 'ATOMIC' | 'PARTIAL';
  recipientCount: number;
  totalValueAttoFil: string;
  payments: DecodedMultisigProposalPayment[];
}

export interface MultisigPendingProposal {
  id: number;
  proposer: string;
  proposerIdAddress?: string;
  to: string;
  valueAttoFil: bigint;
  method: number;
  paramsBase64: string;
  paramsBytes: Uint8Array;
  approvals: string[];
  approvalIdAddresses: string[];
  approvalStatusKnown: boolean;
  connectedSignerHasApproved: boolean;
  isSendFilCompatible: boolean;
  compatibilityReason?: string;
  decodedBatch?: DecodedMultisigProposalBatch;
  proposalHash?: Uint8Array;
  canApprove: boolean;
  canCancel: boolean;
}

export interface MultisigCreateRequest {
  from: NativeSignerAddress;
  network: SendFilNetworkConfig;
  signers: NativeSignerAddress[];
  threshold: number;
  initialDepositAttoFil: bigint;
  unlockDuration?: number;
  startEpoch?: number;
}

export interface MultisigProposalRequest {
  multisig: MultisigActorState;
  senderAddress: NativeSignerAddress;
  recipients: BatchExecutionRecipient[];
  errorMode: 'ATOMIC' | 'PARTIAL';
  executionMethod?: 'STANDARD' | 'THINBATCH';
  network: SendFilNetworkConfig;
}

export interface PreparedMultisigProposal {
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
