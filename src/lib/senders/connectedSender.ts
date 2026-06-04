import { convertEthToDelegatedAddress } from '../../utils/addressConverter';
import type {
  NetworkPrefix,
  SendFilNetworkConfig,
  SendFilNetworkKey,
  SupportedChainId,
} from '../networks';
import { createEvmConnectedSender } from './senderModel';
import type {
  ConnectedSender,
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from './types';

export interface EvmWalletConnectionSnapshot {
  address?: string;
  chainId?: number;
  isConnected: boolean;
}

export interface E2eMockWalletSnapshot {
  enabled: boolean;
  address: `0x${string}`;
  chainId: SupportedChainId;
}

export type SenderBalanceSource =
  | {
      kind: 'none';
      enabled: false;
      reason:
        | 'disconnected'
        | 'unsupported-network'
        | 'unsupported-sender'
        | 'balance-disabled';
    }
  | {
      kind: 'evm-wagmi';
      enabled: boolean;
      address: `0x${string}`;
      chainId: SupportedChainId;
    }
  | {
      kind: 'native-filecoin-lotus';
      enabled: boolean;
      address: string;
      networkKey: SendFilNetworkKey;
      reason?: string;
    };

export interface NativeFilecoinProviderReadiness {
  status: 'hidden' | 'planned' | 'disabled' | 'available';
  providers: Array<SenderProviderMetadata & { kind: 'native-filecoin-wallet' }>;
  hasConnectableProvider: boolean;
  hasSignableProvider: boolean;
  unavailableReason?: string;
}

export interface ConnectedSenderState {
  connectedSender?: ConnectedSender;
  isConnected: boolean;
  address?: string;
  chainId?: number;
  connectedNetwork?: SendFilNetworkConfig;
  networkStatus: 'disconnected' | 'supported' | 'unsupported';
  hasSupportedConnectedNetwork: boolean;
  isUnsupportedConnectedNetwork: boolean;
  expectedNetworkPrefix?: NetworkPrefix;
  canUseLiveSendPath: boolean;
  liveSendPathUnavailableReason?: string;
  balanceSource: SenderBalanceSource;
  nativeFilecoin: NativeFilecoinProviderReadiness;
}

export interface ResolveConnectedSenderStateParams {
  evmWallet: EvmWalletConnectionSnapshot;
  e2eMockWallet?: E2eMockWalletSnapshot;
  nativeFilecoinSender?: NativeFilecoinConnectedSender;
  nativeFilecoinProviders?: NativeFilecoinWalletProvider[];
  balanceQueriesEnabled?: boolean;
}

function summarizeNativeFilecoinProviders(
  providers: NativeFilecoinWalletProvider[] = [],
): NativeFilecoinProviderReadiness {
  const providerMetadata = providers.map((provider) => provider.metadata);
  const hasConnectableProvider = providerMetadata.some(
    (provider) => provider.capabilities.canConnect,
  );
  const hasSignableProvider = providerMetadata.some(
    (provider) =>
      provider.capabilities.canSignBatch &&
      provider.capabilities.canSubmit &&
      provider.capabilities.oneApprovalPerBatch,
  );
  const unavailableReason = providerMetadata.find(
    (provider) => provider.unavailableReason,
  )?.unavailableReason;

  if (providerMetadata.length === 0) {
    return {
      status: 'hidden',
      providers: [],
      hasConnectableProvider: false,
      hasSignableProvider: false,
    };
  }

  if (hasConnectableProvider && hasSignableProvider) {
    return {
      status: 'available',
      providers: providerMetadata,
      hasConnectableProvider,
      hasSignableProvider,
      unavailableReason,
    };
  }

  const hasDisabledProvider = providerMetadata.some(
    (provider) => provider.status === 'disabled',
  );

  return {
    status: hasDisabledProvider ? 'disabled' : 'planned',
    providers: providerMetadata,
    hasConnectableProvider,
    hasSignableProvider,
    unavailableReason,
  };
}

function resolveEvmWalletSnapshot(
  evmWallet: EvmWalletConnectionSnapshot,
  e2eMockWallet?: E2eMockWalletSnapshot,
): EvmWalletConnectionSnapshot {
  if (!e2eMockWallet?.enabled) {
    return evmWallet;
  }

  return {
    address: e2eMockWallet.address,
    chainId: e2eMockWallet.chainId,
    isConnected: true,
  };
}

function resolveSenderBalanceSource(
  sender: ConnectedSender | undefined,
  balanceQueriesEnabled: boolean,
): SenderBalanceSource {
  if (!sender) {
    return {
      kind: 'none',
      enabled: false,
      reason: 'disconnected',
    };
  }

  if (sender.networkStatus !== 'supported' || !sender.network) {
    return {
      kind: 'none',
      enabled: false,
      reason: 'unsupported-network',
    };
  }

  if (!balanceQueriesEnabled) {
    return {
      kind: 'none',
      enabled: false,
      reason: 'balance-disabled',
    };
  }

  if (sender.kind === 'evm') {
    return {
      kind: 'evm-wagmi',
      enabled: true,
      address: sender.address,
      chainId: sender.network.chainId,
    };
  }

  return {
    kind: 'native-filecoin-lotus',
    enabled: sender.provider.capabilities.canReadBalance,
    address: sender.address,
    networkKey: sender.networkKey,
    reason: sender.provider.capabilities.canReadBalance
      ? undefined
      : 'Native Filecoin balance reads are not supported by this provider.',
  };
}

function getLiveSendPathUnavailableReason(
  sender: ConnectedSender | undefined,
): string | undefined {
  if (!sender) {
    return undefined;
  }

  if (!sender.canSignBatch) {
    return 'The connected sender cannot sign a SendFIL batch.';
  }

  if (!sender.provider.capabilities.canSubmit) {
    return 'The connected sender cannot submit a SendFIL batch.';
  }

  if (!sender.provider.capabilities.oneApprovalPerBatch) {
    return 'The connected sender cannot sign this batch with one wallet approval.';
  }

  return undefined;
}

export function resolveConnectedSenderState({
  evmWallet,
  e2eMockWallet,
  nativeFilecoinSender,
  nativeFilecoinProviders = [],
  balanceQueriesEnabled = true,
}: ResolveConnectedSenderStateParams): ConnectedSenderState {
  const evmSnapshot = resolveEvmWalletSnapshot(evmWallet, e2eMockWallet);
  const evmSender = createEvmConnectedSender(evmSnapshot);
  const connectedSender = nativeFilecoinSender ?? evmSender;
  const nativeFilecoin = summarizeNativeFilecoinProviders(nativeFilecoinProviders);
  const isConnected = Boolean(connectedSender);
  const networkStatus = connectedSender
    ? connectedSender.networkStatus
    : 'disconnected';
  const liveSendPathUnavailableReason =
    getLiveSendPathUnavailableReason(connectedSender);

  return {
    connectedSender,
    isConnected,
    address: connectedSender?.address,
    chainId: connectedSender?.chainId,
    connectedNetwork: connectedSender?.network,
    networkStatus,
    hasSupportedConnectedNetwork: networkStatus === 'supported',
    isUnsupportedConnectedNetwork: networkStatus === 'unsupported',
    expectedNetworkPrefix: connectedSender?.nativePrefix,
    canUseLiveSendPath:
      Boolean(connectedSender) &&
      connectedSender!.canSignBatch &&
      connectedSender!.networkStatus === 'supported' &&
      !liveSendPathUnavailableReason,
    liveSendPathUnavailableReason,
    balanceSource: resolveSenderBalanceSource(
      connectedSender,
      balanceQueriesEnabled,
    ),
    nativeFilecoin,
  };
}

export function getSenderDisplayAddress(sender: ConnectedSender): string {
  if (sender.kind === 'native-filecoin') {
    return sender.address;
  }

  if (!sender.network) {
    return sender.address;
  }

  return convertEthToDelegatedAddress(sender.address, sender.network.chainId);
}
