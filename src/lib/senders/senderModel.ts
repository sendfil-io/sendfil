import { newFromString } from '@glif/filecoin-address';
import { getAddress, isAddress } from 'viem';
import {
  getNetworkConfig,
  getSupportedNetworkByChainId,
  type SendFilNetworkKey,
} from '../networks';
import type {
  EvmConnectedSender,
  NativeFilecoinConnectedSender,
  SenderProviderMetadata,
} from './types';

export const WAGMI_EVM_SENDER_PROVIDER: SenderProviderMetadata = {
  id: 'wagmi-evm',
  name: 'EVM wallet',
  kind: 'evm-wallet',
  status: 'available',
  capabilities: {
    canConnect: true,
    canDisconnect: true,
    canDetectNetwork: true,
    canReadBalance: true,
    canSignBatch: true,
    canSubmit: true,
    oneApprovalPerBatch: true,
  },
};

export interface CreateEvmConnectedSenderParams {
  address?: string;
  chainId?: number;
  isConnected: boolean;
  provider?: SenderProviderMetadata;
}

export interface NativeSenderModelResult {
  sender?: NativeFilecoinConnectedSender;
  error?: string;
}

export function createEvmConnectedSender({
  address,
  chainId,
  isConnected,
  provider = WAGMI_EVM_SENDER_PROVIDER,
}: CreateEvmConnectedSenderParams): EvmConnectedSender | undefined {
  if (!isConnected || !address) {
    return undefined;
  }

  if (!isAddress(address)) {
    return undefined;
  }

  const network = getSupportedNetworkByChainId(chainId);

  return {
    kind: 'evm',
    address: getAddress(address),
    chainId,
    networkKey: network?.key,
    nativePrefix: network?.nativePrefix,
    network,
    networkStatus: network ? 'supported' : 'unsupported',
    canSignBatch: provider.capabilities.canSignBatch,
    provider,
  };
}

function getNativeSenderNetworkKey(address: string): SendFilNetworkKey | undefined {
  if (address.startsWith('f')) {
    return 'mainnet';
  }

  if (address.startsWith('t')) {
    return 'calibration';
  }

  return undefined;
}

export function createNativeFilecoinConnectedSender({
  address,
  provider,
  expectedNetworkKey,
}: {
  address: string;
  provider: SenderProviderMetadata;
  expectedNetworkKey?: SendFilNetworkKey;
}): NativeSenderModelResult {
  const trimmedAddress = address.trim();

  if (/^[ft]0/.test(trimmedAddress)) {
    return { error: 'f0/t0 ID sender addresses are not supported' };
  }

  try {
    newFromString(trimmedAddress);
  } catch {
    return { error: `Invalid native Filecoin sender address "${trimmedAddress}"` };
  }

  if (!/^[ft]1/.test(trimmedAddress)) {
    return {
      error:
        'Only f1/t1 secp256k1 Filecoin sender addresses are supported by the v1 native sender model.',
    };
  }

  const networkKey = getNativeSenderNetworkKey(trimmedAddress);
  if (!networkKey) {
    return {
      error: `Native Filecoin sender address "${trimmedAddress}" has an unsupported network prefix.`,
    };
  }

  if (expectedNetworkKey && networkKey !== expectedNetworkKey) {
    const expectedNetwork = getNetworkConfig(expectedNetworkKey);

    return {
      error: `${trimmedAddress} does not match the current ${expectedNetwork.walletLabel} sender network.`,
    };
  }

  const network = getNetworkConfig(networkKey);

  return {
    sender: {
      kind: 'native-filecoin',
      address: trimmedAddress,
      chainId: network.chainId,
      networkKey: network.key,
      nativePrefix: network.nativePrefix,
      network,
      networkStatus: 'supported',
      canSignBatch: provider.capabilities.canSignBatch,
      provider,
    },
  };
}
