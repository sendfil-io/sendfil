import type { FilecoinMessage } from '../DataProvider/types';
import type {
  NetworkPrefix,
  SendFilNetworkConfig,
  SendFilNetworkKey,
} from '../networks';
import type { PreparedBatchExecution } from '../transaction/batchExecution';

export type ConnectedSenderKind = 'evm' | 'native-filecoin';
export type SenderProviderKind = 'evm-wallet' | 'native-filecoin-wallet';
export type SenderProviderStatus = 'available' | 'disabled' | 'planned';

export interface SenderProviderCapabilities {
  canConnect: boolean;
  canDisconnect: boolean;
  canDetectNetwork: boolean;
  canReadBalance: boolean;
  canSignBatch: boolean;
  canSubmit: boolean;
  oneApprovalPerBatch: boolean;
}

export interface SenderProviderMetadata {
  id: string;
  name: string;
  kind: SenderProviderKind;
  status: SenderProviderStatus;
  capabilities: SenderProviderCapabilities;
  unavailableReason?: string;
}

export interface ConnectedSenderBase {
  kind: ConnectedSenderKind;
  address: string;
  chainId?: number;
  networkKey?: SendFilNetworkKey;
  nativePrefix?: NetworkPrefix;
  network?: SendFilNetworkConfig;
  networkStatus: 'supported' | 'unsupported';
  canSignBatch: boolean;
  provider: SenderProviderMetadata;
}

export interface EvmConnectedSender extends ConnectedSenderBase {
  kind: 'evm';
  address: `0x${string}`;
}

export interface NativeFilecoinConnectedSender extends ConnectedSenderBase {
  kind: 'native-filecoin';
  address: string;
  chainId: SendFilNetworkConfig['chainId'];
  networkKey: SendFilNetworkKey;
  nativePrefix: NetworkPrefix;
  network: SendFilNetworkConfig;
  networkStatus: 'supported';
}

export type ConnectedSender = EvmConnectedSender | NativeFilecoinConnectedSender;

export interface NativeFilecoinAccount {
  address: string;
  networkKey: SendFilNetworkKey;
  nativePrefix: NetworkPrefix;
}

export interface NativeFilecoinConnectOptions {
  networkKey?: SendFilNetworkKey;
}

export type NativeFilecoinProviderSupportStatus =
  | 'not-checked'
  | 'detected'
  | 'not-detected'
  | 'not-supported';

export interface NativeFilecoinBatchSigningRequest {
  sender: NativeFilecoinConnectedSender;
  preparedBatch: PreparedBatchExecution;
}

export interface NativeFilecoinSendResult {
  cid: string;
}

export interface NativeFilecoinWalletProvider {
  metadata: SenderProviderMetadata & { kind: 'native-filecoin-wallet' };
  connect: (options?: NativeFilecoinConnectOptions) => Promise<NativeFilecoinAccount>;
  disconnect: () => Promise<void>;
  getAccount: () => Promise<NativeFilecoinAccount | null>;
  getBalance: (account: NativeFilecoinAccount) => Promise<bigint>;
  checkSupport?: () => Promise<NativeFilecoinProviderSupportStatus>;
  signAndSubmitMessage?: (message: FilecoinMessage) => Promise<NativeFilecoinSendResult>;
  signAndSubmitBatch?: (
    request: NativeFilecoinBatchSigningRequest,
  ) => Promise<NativeFilecoinSendResult>;
}
