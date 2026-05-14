import {
  CoinType,
  newActorAddress,
  newBLSAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { toF4 } from '../../../utils/toF4';
import { NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA } from '../nativeFilecoinProvider';
import {
  createEvmConnectedSender,
  createNativeFilecoinConnectedSender,
} from '../senderModel';

const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

const MAINNET_F2 = newActorAddress(
  Uint8Array.from([1, 2, 3, 4]),
  CoinType.MAIN,
).toString();

const MAINNET_F3 = newBLSAddress(
  Uint8Array.from({ length: 48 }, (_, index) => index + 10),
  CoinType.MAIN,
).toString();

describe('sender model', () => {
  it('keeps the current wagmi EVM sender model on the supported FEVM path', () => {
    const sender = createEvmConnectedSender({
      address: EVM_ADDRESS,
      chainId: 314,
      isConnected: true,
    });

    expect(sender).toMatchObject({
      kind: 'evm',
      address: getAddress(EVM_ADDRESS),
      chainId: 314,
      networkKey: 'mainnet',
      nativePrefix: 'f',
      networkStatus: 'supported',
      canSignBatch: true,
    });
    expect(sender?.provider.capabilities.oneApprovalPerBatch).toBe(true);
  });

  it('preserves EVM sender connection state while marking unsupported chains', () => {
    const sender = createEvmConnectedSender({
      address: EVM_ADDRESS,
      chainId: 1,
      isConnected: true,
    });

    expect(sender).toMatchObject({
      kind: 'evm',
      address: getAddress(EVM_ADDRESS),
      chainId: 1,
      networkStatus: 'unsupported',
      canSignBatch: true,
    });
    expect(sender?.networkKey).toBeUndefined();
    expect(sender?.nativePrefix).toBeUndefined();
  });

  it('creates mainnet f1 and Calibration t1 native sender models without converting addresses', () => {
    const mainnet = createNativeFilecoinConnectedSender({
      address: `  ${MAINNET_F1}  `,
      provider: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
    });
    const calibration = createNativeFilecoinConnectedSender({
      address: CALIBRATION_T1,
      provider: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
    });

    expect(mainnet.error).toBeUndefined();
    expect(mainnet.sender).toMatchObject({
      kind: 'native-filecoin',
      address: MAINNET_F1,
      chainId: 314,
      networkKey: 'mainnet',
      nativePrefix: 'f',
      networkStatus: 'supported',
      canSignBatch: false,
    });
    expect(mainnet.sender?.address.startsWith('0x')).toBe(false);

    expect(calibration.error).toBeUndefined();
    expect(calibration.sender).toMatchObject({
      kind: 'native-filecoin',
      address: CALIBRATION_T1,
      chainId: 314159,
      networkKey: 'calibration',
      nativePrefix: 't',
      networkStatus: 'supported',
      canSignBatch: false,
    });
  });

  it('rejects unsupported native sender protocols and delegated EVM twins as native senders', () => {
    const unsupportedSenders = [
      'f01234',
      't01234',
      MAINNET_F2,
      MAINNET_F3,
      toF4('0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd', 'f'),
    ];

    for (const address of unsupportedSenders) {
      const result = createNativeFilecoinConnectedSender({
        address,
        provider: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
      });

      expect(result.sender).toBeUndefined();
      expect(result.error).toMatch(
        /Only f1\/t1 secp256k1 Filecoin sender addresses|f0\/t0 ID sender addresses are not supported/,
      );
    }
  });

  it('blocks native sender network prefix mismatches', () => {
    const result = createNativeFilecoinConnectedSender({
      address: MAINNET_F1,
      provider: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
      expectedNetworkKey: 'calibration',
    });

    expect(result.sender).toBeUndefined();
    expect(result.error).toContain('does not match the current Calibration Testnet sender network');
  });
});
