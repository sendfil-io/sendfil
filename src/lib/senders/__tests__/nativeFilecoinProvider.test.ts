import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import { getNetworkConfig } from '../../networks';
import type { FilecoinMessage } from '../../DataProvider/types';
import { createFilsnapCalibrationProvider } from '../filsnapProvider';
import {
  getNativeFilecoinSenderBalanceAttoFil,
  getNativeFilecoinWalletProviders,
  NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
} from '../nativeFilecoinProvider';
import { createNativeFilecoinConnectedSender } from '../senderModel';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const NATIVE_BATCH_MESSAGE: FilecoinMessage = {
  Version: 0,
  To: 't410f2lpnnzscfg4zbfo5verki2as6tpsrmb6m4a2lby',
  From: CALIBRATION_T1,
  Nonce: 7,
  Value: '1000000000000000000',
  GasLimit: 12345,
  GasFeeCap: '100',
  GasPremium: '10',
  Method: 3844450837,
  Params: 'RA==',
};

function createMockEthereumProvider({
  accountAddress = CALIBRATION_T1,
  cid = 'bafy2bzacedtestcid',
}: {
  accountAddress?: string;
  cid?: string;
} = {}) {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === 'wallet_requestSnaps') {
      return {
        'npm:filsnap': {
          id: 'npm:filsnap',
          enabled: true,
          version: '1.9.0',
        },
      };
    }

    if (method !== 'wallet_invokeSnap') {
      throw new Error(`Unexpected method ${method}`);
    }

    const invoke = params as {
      request: {
        method: string;
        params?: unknown;
      };
    };

    switch (invoke.request.method) {
      case 'fil_configure':
        return {
          error: null,
          result: {
            network: 'testnet',
            rpc: {
              url: getNetworkConfig('calibration').lotusRpcPrimaryUrl,
              token: '',
            },
          },
        };
      case 'fil_getAccount':
        return {
          error: null,
          result: {
            address: accountAddress,
            publicKey: 'abcd',
            path: "m/44'/1'/0'/0/0",
            type: 'SECP256K1',
          },
        };
      case 'fil_signMessage':
        return {
          error: null,
          result: {
            message: invoke.request.params,
            signature: {
              type: 'SECP256K1',
              data: 'YWJjZA==',
            },
          },
        };
      case 'fil_sendMessage':
        return {
          error: null,
          result: {
            cid,
            message: {},
          },
        };
      default:
        throw new Error(`Unexpected invoke method ${invoke.request.method}`);
    }
  });

  return { request };
}

describe('native Filecoin provider boundary', () => {
  it('keeps native Filecoin providers hidden while the feature flag is disabled', () => {
    expect(getNativeFilecoinWalletProviders({ featureEnabled: false })).toEqual([]);
  });

  it('exposes only an unsupported placeholder until testnet sends are explicitly enabled', async () => {
    const [provider] = getNativeFilecoinWalletProviders({
      featureEnabled: true,
      calibrationTestnetSendEnabled: false,
    });

    expect(provider.metadata).toMatchObject({
      id: 'native-filecoin-placeholder',
      kind: 'native-filecoin-wallet',
      status: 'planned',
      capabilities: {
        canConnect: false,
        canSignBatch: false,
        canSubmit: false,
        oneApprovalPerBatch: true,
      },
    });
    await expect(provider.connect()).rejects.toThrow(
      'Native Filecoin wallet signing is scaffolded',
    );
  });

  it('exposes a disabled FilSnap provider when testnet sends are enabled without MetaMask', () => {
    const [provider] = getNativeFilecoinWalletProviders({
      featureEnabled: true,
      calibrationTestnetSendEnabled: true,
    });

    expect(provider.metadata).toMatchObject({
      id: 'filsnap-calibration',
      status: 'disabled',
      capabilities: {
        canConnect: false,
        canSignBatch: false,
        canSubmit: false,
      },
    });
  });

  it('connects a FilSnap Calibration t1 account through MetaMask Snaps', async () => {
    const ethereumProvider = createMockEthereumProvider();
    const provider = createFilsnapCalibrationProvider({ ethereumProvider });

    const account = await provider.connect();

    expect(account).toEqual({
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(ethereumProvider.request).toHaveBeenCalledWith({
      method: 'wallet_requestSnaps',
      params: {
        'npm:filsnap': {},
      },
    });
    expect(ethereumProvider.request).toHaveBeenCalledWith({
      method: 'wallet_invokeSnap',
      params: {
        snapId: 'npm:filsnap',
        request: {
          method: 'fil_configure',
          params: {
            network: 'testnet',
            rpc: {
              url: getNetworkConfig('calibration').lotusRpcPrimaryUrl,
              token: '',
            },
          },
        },
      },
    });
  });

  it('rejects a FilSnap account that is not on Calibration', async () => {
    const provider = createFilsnapCalibrationProvider({
      ethereumProvider: createMockEthereumProvider({
        accountAddress: MAINNET_F1,
      }),
    });

    await expect(provider.connect()).rejects.toThrow(
      'does not match the current Calibration Testnet sender network',
    );
  });

  it('signs one native batch message and submits the signed message through FilSnap', async () => {
    const ethereumProvider = createMockEthereumProvider();
    const provider = createFilsnapCalibrationProvider({ ethereumProvider });

    const result = await provider.signAndSubmitMessage!(NATIVE_BATCH_MESSAGE);

    expect(result).toEqual({ cid: 'bafy2bzacedtestcid' });
    expect(ethereumProvider.request).toHaveBeenCalledWith({
      method: 'wallet_invokeSnap',
      params: {
        snapId: 'npm:filsnap',
        request: {
          method: 'fil_signMessage',
          params: {
            to: NATIVE_BATCH_MESSAGE.To,
            value: NATIVE_BATCH_MESSAGE.Value,
            nonce: NATIVE_BATCH_MESSAGE.Nonce,
            gasLimit: NATIVE_BATCH_MESSAGE.GasLimit,
            gasFeeCap: NATIVE_BATCH_MESSAGE.GasFeeCap,
            gasPremium: NATIVE_BATCH_MESSAGE.GasPremium,
            method: NATIVE_BATCH_MESSAGE.Method,
            params: NATIVE_BATCH_MESSAGE.Params,
          },
        },
      },
    });
    expect(ethereumProvider.request).toHaveBeenCalledWith({
      method: 'wallet_invokeSnap',
      params: {
        snapId: 'npm:filsnap',
        request: {
          method: 'fil_sendMessage',
          params: {
            message: {
              to: NATIVE_BATCH_MESSAGE.To,
              value: NATIVE_BATCH_MESSAGE.Value,
              nonce: NATIVE_BATCH_MESSAGE.Nonce,
              gasLimit: NATIVE_BATCH_MESSAGE.GasLimit,
              gasFeeCap: NATIVE_BATCH_MESSAGE.GasFeeCap,
              gasPremium: NATIVE_BATCH_MESSAGE.GasPremium,
              method: NATIVE_BATCH_MESSAGE.Method,
              params: NATIVE_BATCH_MESSAGE.Params,
            },
            signature: {
              type: 'SECP256K1',
              data: 'YWJjZA==',
            },
          },
        },
      },
    });
  });

  it('reads native sender balances on the sender network', async () => {
    const senderResult = createNativeFilecoinConnectedSender({
      address: CALIBRATION_T1,
      provider: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
    });
    const readBalance = vi.fn(async () => '123');

    expect(senderResult.sender).toBeDefined();

    const balance = await getNativeFilecoinSenderBalanceAttoFil(
      senderResult.sender!,
      readBalance,
    );

    expect(balance).toBe(123n);
    expect(readBalance).toHaveBeenCalledWith(CALIBRATION_T1, 'calibration');
  });
});
