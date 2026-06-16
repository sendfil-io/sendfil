import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import { getNetworkConfig, type SendFilNetworkKey } from '../../networks';
import { FILSNAP_FILECOIN_PROVIDER_METADATA } from '../../senders';
import { createNativeFilecoinConnectedSender } from '../../senders/senderModel';
import type { FilecoinMessage } from '../../DataProvider/types';
import { toF4 } from '../../../utils/toF4';
import { prepareBatchExecution } from '../batchExecution';
import { encodeInvokeEvmParams, INVOKE_EVM_METHOD_NUMBER } from '../nativeBatchMessage';
import { preflightNativeBatch, type NativeBatchPreflightRpc } from '../nativeBatchPreflight';

const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

function getNativeSender(address: string) {
  const result = createNativeFilecoinConnectedSender({
    address,
    provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create native sender');
  }

  return result.sender;
}

function getRpc(gasFields?: Partial<Pick<FilecoinMessage, 'GasLimit' | 'GasFeeCap' | 'GasPremium'>>) {
  return {
    getNonce: vi.fn(async (address: string, networkKey: SendFilNetworkKey) => {
      void address;
      void networkKey;

      return 9;
    }),
    estimateGas: vi.fn(async (message: FilecoinMessage, networkKey: SendFilNetworkKey) => {
      void networkKey;

      return {
        ...message,
        GasLimit: gasFields?.GasLimit ?? 12_345,
        GasFeeCap: gasFields?.GasFeeCap ?? '456',
        GasPremium: gasFields?.GasPremium ?? '7',
      };
    }),
  } satisfies Required<NativeBatchPreflightRpc>;
}

describe('native Filecoin batch preflight', () => {
  it('preflights a Calibration native sender as one InvokeEVM message using Calibration RPC calls', async () => {
    const network = getNetworkConfig('calibration');
    const sender = getNativeSender(CALIBRATION_T1);
    const rpc = getRpc();
    const recipients = [
      { address: EVM_RECIPIENT, amount: '1' },
      { address: toF4(EVM_RECIPIENT, 't'), amount: '2' },
      { address: CALIBRATION_T1, amount: '3' },
    ];

    const result = await preflightNativeBatch({
      sender,
      recipients,
      errorMode: 'ATOMIC',
      network,
      rpc,
    });

    expect(rpc.getNonce).toHaveBeenCalledWith(CALIBRATION_T1, 'calibration');
    expect(rpc.estimateGas).toHaveBeenCalledTimes(1);
    const [draftMessage, rpcNetworkKey] = rpc.estimateGas.mock.calls[0]!;

    expect(rpcNetworkKey).toBe('calibration');
    expect(draftMessage).toEqual(result.draftNativeMessage.message);
    expect(draftMessage).toMatchObject({
      Version: 0,
      To: toF4(network.multicall3Address, 't'),
      From: CALIBRATION_T1,
      Nonce: 9,
      Value: '6000000000000000000',
      Method: INVOKE_EVM_METHOD_NUMBER,
      Params: encodeInvokeEvmParams(result.preparedBatch.batch.data),
      GasLimit: 0,
      GasFeeCap: '0',
      GasPremium: '0',
    });
    expect(result.estimatedNativeMessage.message).toMatchObject({
      To: toF4(network.multicall3Address, 't'),
      GasLimit: 12_345,
      GasFeeCap: '456',
      GasPremium: '7',
    });
    expect(result.gasEstimate).toEqual({
      gasLimit: 12_345n,
      gasFeeCap: 456n,
      gasPremium: 7n,
      estimatedFee: 12_345n * 456n,
    });
  });

  it('preflights ThinBatch as one native InvokeEVM message to the configured ThinBatch contract', async () => {
    const network = {
      ...getNetworkConfig('calibration'),
      thinBatchAddress: '0x5555555555555555555555555555555555555555' as const,
    };
    const sender = getNativeSender(CALIBRATION_T1);
    const rpc = getRpc();
    const recipients = [
      { address: EVM_RECIPIENT, amount: '1' },
      { address: CALIBRATION_T1, amount: '2' },
    ];
    const expectedPreparedBatch = prepareBatchExecution(
      recipients,
      'PARTIAL',
      network,
      'THINBATCH',
    );

    const result = await preflightNativeBatch({
      sender,
      recipients,
      errorMode: 'PARTIAL',
      executionMethod: 'THINBATCH',
      network,
      rpc,
    });

    expect(result.preparedBatch.executionMethod).toBe('THINBATCH');
    expect(result.preparedBatch.batch.data).toBe(expectedPreparedBatch.batch.data);
    expect(result.draftNativeMessage).toMatchObject({
      targetEvmAddress: network.thinBatchAddress,
      targetFilecoinAddress: toF4(network.thinBatchAddress, 't'),
    });
    expect(result.draftNativeMessage.message).toMatchObject({
      To: toF4(network.thinBatchAddress, 't'),
      From: CALIBRATION_T1,
      Value: '3000000000000000000',
      Method: INVOKE_EVM_METHOD_NUMBER,
      Params: encodeInvokeEvmParams(expectedPreparedBatch.batch.data),
    });
    expect(result.estimatedNativeMessage.message).toMatchObject({
      To: toF4(network.thinBatchAddress, 't'),
      GasLimit: 12_345,
      GasFeeCap: '456',
      GasPremium: '7',
    });
  });

  it('uses mainnet sender and RPC network keys for f1 native senders', async () => {
    const network = getNetworkConfig('mainnet');
    const sender = getNativeSender(MAINNET_F1);
    const rpc = getRpc({
      GasLimit: 20_000,
      GasFeeCap: '300',
      GasPremium: '2',
    });

    const result = await preflightNativeBatch({
      sender,
      recipients: [{ address: MAINNET_F1, amount: '0.5' }],
      errorMode: 'ATOMIC',
      network,
      rpc,
    });

    expect(rpc.getNonce).toHaveBeenCalledWith(MAINNET_F1, 'mainnet');
    expect(rpc.estimateGas).toHaveBeenCalledWith(
      result.draftNativeMessage.message,
      'mainnet',
    );
    expect(result.estimatedNativeMessage).toMatchObject({
      targetFilecoinAddress: toF4(network.multicall3Address, 'f'),
      targetEvmAddress: network.multicall3Address,
    });
    expect(result.gasEstimate).toEqual({
      gasLimit: 20_000n,
      gasFeeCap: 300n,
      gasPremium: 2n,
      estimatedFee: 20_000n * 300n,
    });
  });

  it('blocks native sender and batch network mismatches before RPC calls', async () => {
    const sender = getNativeSender(MAINNET_F1);
    const rpc = getRpc();

    await expect(
      preflightNativeBatch({
        sender,
        recipients: [{ address: CALIBRATION_T1, amount: '1' }],
        errorMode: 'ATOMIC',
        network: getNetworkConfig('calibration'),
        rpc,
      }),
    ).rejects.toThrow(
      'Native sender network mainnet does not match requested batch network calibration',
    );

    expect(rpc.getNonce).not.toHaveBeenCalled();
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });

  it('preserves the existing Multicall3 payload and ATOMIC call semantics', async () => {
    const network = getNetworkConfig('calibration');
    const sender = getNativeSender(CALIBRATION_T1);
    const rpc = getRpc();
    const recipients = [
      { address: EVM_RECIPIENT, amount: '1' },
      { address: CALIBRATION_T1, amount: '2' },
    ];
    const expectedPreparedBatch = prepareBatchExecution(recipients, 'ATOMIC', network);

    const result = await preflightNativeBatch({
      sender,
      recipients,
      errorMode: 'ATOMIC',
      network,
      rpc,
    });

    expect(result.preparedBatch.executionMethod).toBe('STANDARD');
    expect(result.preparedBatch.batch.data).toBe(expectedPreparedBatch.batch.data);
    if (result.preparedBatch.batch.executionMethod !== 'STANDARD') {
      throw new Error('Expected Standard native preflight');
    }

    expect(result.preparedBatch.batch.calls.every((call) => call.allowFailure === false)).toBe(
      true,
    );
    expect(result.estimatedNativeMessage.message.Params).toBe(
      encodeInvokeEvmParams(expectedPreparedBatch.batch.data),
    );
  });

  it('propagates native gas estimation failures without creating a submit-ready message', async () => {
    const network = getNetworkConfig('calibration');
    const sender = getNativeSender(CALIBRATION_T1);
    const rpc = {
      getNonce: vi.fn(async (address: string, networkKey: SendFilNetworkKey) => {
        void address;
        void networkKey;

        return 1;
      }),
      estimateGas: vi.fn(async (message: FilecoinMessage, networkKey: SendFilNetworkKey) => {
        void message;
        void networkKey;

        throw new Error('Calibration Lotus gas estimation failed');
      }),
    } satisfies Required<NativeBatchPreflightRpc>;

    await expect(
      preflightNativeBatch({
        sender,
        recipients: [{ address: CALIBRATION_T1, amount: '1' }],
        errorMode: 'ATOMIC',
        network,
        rpc,
      }),
    ).rejects.toThrow('Calibration Lotus gas estimation failed');
  });
});
