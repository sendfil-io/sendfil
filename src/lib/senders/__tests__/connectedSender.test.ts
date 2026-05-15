import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { toF4 } from '../../../utils/toF4';
import { NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA } from '../nativeFilecoinProvider';
import {
  getSenderDisplayAddress,
  resolveConnectedSenderState,
} from '../connectedSender';
import { createNativeFilecoinConnectedSender } from '../senderModel';
import type { NativeFilecoinWalletProvider, SenderProviderMetadata } from '../types';

const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

const FILSNAP_CALIBRATION_METADATA: SenderProviderMetadata = {
  id: 'filsnap-calibration',
  name: 'FilSnap Calibration',
  kind: 'native-filecoin-wallet',
  status: 'available',
  capabilities: {
    canConnect: true,
    canDisconnect: false,
    canDetectNetwork: true,
    canReadBalance: true,
    canSignBatch: true,
    canSubmit: true,
    oneApprovalPerBatch: true,
  },
};

function getNativeSender(
  address: string,
  provider: SenderProviderMetadata = NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
) {
  const result = createNativeFilecoinConnectedSender({
    address,
    provider,
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create native sender');
  }

  return result.sender;
}

function getPlannedNativeProvider(): NativeFilecoinWalletProvider {
  return {
    metadata: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
    async connect() {
      throw new Error('Native provider is planned');
    },
    async disconnect() {
      return undefined;
    },
    async getAccount() {
      return null;
    },
    async getBalance() {
      return 0n;
    },
  };
}

describe('connected sender state', () => {
  it('resolves the existing wagmi EVM sender as the only live send-capable path', () => {
    const state = resolveConnectedSenderState({
      evmWallet: {
        address: EVM_ADDRESS,
        chainId: 314,
        isConnected: true,
      },
    });

    expect(state.connectedSender).toMatchObject({
      kind: 'evm',
      address: getAddress(EVM_ADDRESS),
      chainId: 314,
      networkKey: 'mainnet',
      networkStatus: 'supported',
      canSignBatch: true,
    });
    expect(state.canUseLiveSendPath).toBe(true);
    expect(state.expectedNetworkPrefix).toBe('f');
    expect(state.balanceSource).toEqual({
      kind: 'evm-wagmi',
      enabled: true,
      address: getAddress(EVM_ADDRESS),
      chainId: 314,
    });
  });

  it('keeps unsupported EVM networks connected but disables network-scoped reads', () => {
    const state = resolveConnectedSenderState({
      evmWallet: {
        address: EVM_ADDRESS,
        chainId: 1,
        isConnected: true,
      },
    });

    expect(state.isConnected).toBe(true);
    expect(state.isUnsupportedConnectedNetwork).toBe(true);
    expect(state.hasSupportedConnectedNetwork).toBe(false);
    expect(state.canUseLiveSendPath).toBe(false);
    expect(state.connectedNetwork).toBeUndefined();
    expect(state.balanceSource).toEqual({
      kind: 'none',
      enabled: false,
      reason: 'unsupported-network',
    });
  });

  it('uses the E2E mock wallet snapshot without changing the production EVM model', () => {
    const state = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      e2eMockWallet: {
        enabled: true,
        address: EVM_ADDRESS,
        chainId: 314159,
      },
    });

    expect(state.connectedSender).toMatchObject({
      kind: 'evm',
      address: getAddress(EVM_ADDRESS),
      chainId: 314159,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(state.balanceSource).toEqual({
      kind: 'evm-wagmi',
      enabled: true,
      address: getAddress(EVM_ADDRESS),
      chainId: 314159,
    });
  });

  it('surfaces planned native Filecoin providers without enabling review or send', () => {
    const state = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      nativeFilecoinProviders: [getPlannedNativeProvider()],
    });

    expect(state.connectedSender).toBeUndefined();
    expect(state.nativeFilecoin).toMatchObject({
      status: 'planned',
      hasConnectableProvider: false,
      hasSignableProvider: false,
      unavailableReason:
        'Native Filecoin wallet signing is scaffolded, but no browser provider has been verified for production use yet.',
    });
    expect(state.canUseLiveSendPath).toBe(false);
  });

  it('keeps placeholder native f1/t1 senders unsupported by the live send path', () => {
    const mainnetState = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      nativeFilecoinSender: getNativeSender(MAINNET_F1),
    });
    const calibrationState = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      nativeFilecoinSender: getNativeSender(CALIBRATION_T1),
    });

    expect(mainnetState.connectedSender).toMatchObject({
      kind: 'native-filecoin',
      address: MAINNET_F1,
      networkKey: 'mainnet',
      nativePrefix: 'f',
    });
    expect(mainnetState.canUseLiveSendPath).toBe(false);
    expect(mainnetState.liveSendPathUnavailableReason).toBe(
      'The connected sender cannot sign a SendFIL batch.',
    );
    expect(mainnetState.balanceSource).toEqual({
      kind: 'native-filecoin-lotus',
      enabled: true,
      address: MAINNET_F1,
      networkKey: 'mainnet',
      reason: undefined,
    });

    expect(calibrationState.connectedSender).toMatchObject({
      kind: 'native-filecoin',
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(calibrationState.canUseLiveSendPath).toBe(false);
  });

  it('enables the live send path only for signable native Calibration senders', () => {
    const calibrationState = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      nativeFilecoinSender: getNativeSender(
        CALIBRATION_T1,
        FILSNAP_CALIBRATION_METADATA,
      ),
    });
    const mainnetState = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      nativeFilecoinSender: getNativeSender(MAINNET_F1, FILSNAP_CALIBRATION_METADATA),
    });

    expect(calibrationState.connectedSender).toMatchObject({
      kind: 'native-filecoin',
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      canSignBatch: true,
    });
    expect(calibrationState.canUseLiveSendPath).toBe(true);
    expect(calibrationState.balanceSource).toEqual({
      kind: 'native-filecoin-lotus',
      enabled: true,
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      reason: undefined,
    });

    expect(mainnetState.canUseLiveSendPath).toBe(false);
    expect(mainnetState.liveSendPathUnavailableReason).toBe(
      'Native Filecoin mainnet sending is not enabled in this testnet path yet.',
    );
  });

  it('formats sender display addresses without converting native f1/t1 senders to 0x', () => {
    const mainnetEvmState = resolveConnectedSenderState({
      evmWallet: {
        address: EVM_ADDRESS,
        chainId: 314,
        isConnected: true,
      },
    });
    const calibrationEvmState = resolveConnectedSenderState({
      evmWallet: {
        address: EVM_ADDRESS,
        chainId: 314159,
        isConnected: true,
      },
    });
    const unsupportedEvmState = resolveConnectedSenderState({
      evmWallet: {
        address: EVM_ADDRESS,
        chainId: 1,
        isConnected: true,
      },
    });
    const nativeState = resolveConnectedSenderState({
      evmWallet: {
        address: undefined,
        chainId: undefined,
        isConnected: false,
      },
      nativeFilecoinSender: getNativeSender(CALIBRATION_T1),
    });

    expect(getSenderDisplayAddress(mainnetEvmState.connectedSender!)).toBe(
      toF4(getAddress(EVM_ADDRESS), 'f'),
    );
    expect(getSenderDisplayAddress(calibrationEvmState.connectedSender!)).toBe(
      toF4(getAddress(EVM_ADDRESS), 't'),
    );
    expect(getSenderDisplayAddress(unsupportedEvmState.connectedSender!)).toBe(
      getAddress(EVM_ADDRESS),
    );
    expect(getSenderDisplayAddress(nativeState.connectedSender!)).toBe(CALIBRATION_T1);
  });
});
