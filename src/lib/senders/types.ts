import type { FilecoinMessage } from '../DataProvider/types';
import type {
  NetworkPrefix,
  SendFilNetworkConfig,
  SendFilNetworkKey,
} from '../networks';

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

export interface NativeFilecoinSendResult {
  cid: string;
}

export interface NativeFilecoinSubmissionOptions {
  /**
   * Must complete before the provider dispatches Filecoin.MpoolPush. Live
   * callers use this boundary to persist the exact signed-message CID and
   * block a second signature if the RPC response becomes ambiguous.
   */
  onCidComputed: (cid: string) => void | Promise<void>;
}

export interface NativeFilecoinWalletProvider {
  metadata: SenderProviderMetadata & { kind: 'native-filecoin-wallet' };
  prepareConnect?: (options?: NativeFilecoinConnectOptions) => Promise<void>;
  connect: (options?: NativeFilecoinConnectOptions) => Promise<NativeFilecoinAccount>;
  disconnect: () => Promise<void>;
  getAccount: () => Promise<NativeFilecoinAccount | null>;
  getBalance: (account: NativeFilecoinAccount) => Promise<bigint>;
  checkSupport?: () => Promise<NativeFilecoinProviderSupportStatus>;
  signAndSubmitMessage?: (
    message: FilecoinMessage,
    options: NativeFilecoinSubmissionOptions,
  ) => Promise<NativeFilecoinSendResult>;
}
