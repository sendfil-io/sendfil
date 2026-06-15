import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  CoinType,
  newActorAddress,
  newBLSAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { toF4 } from '../../../utils/toF4';
import { getDefaultNetworkConfig, getNetworkConfig } from '../../networks';
import { prepareBatchExecution } from '../batchExecution';

const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const CALIBRATION_T2 = newActorAddress(Uint8Array.from([1, 2, 3, 4]), CoinType.TEST).toString();
const CALIBRATION_T3 = newBLSAddress(
  Uint8Array.from({ length: 48 }, (_, index) => index + 10),
  CoinType.TEST,
).toString();

describe('INV-EXEC-001 prepared batch determinism', () => {
  it('produces the same prepared execution config for estimate and submit inputs', () => {
    const recipients = [
      {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        amount: 1.25,
      },
      {
        address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
        amount: 2.5,
      },
    ];
    const network = getDefaultNetworkConfig();
    const preparedForEstimate = prepareBatchExecution(recipients, 'ATOMIC', network);
    const preparedForSubmit = prepareBatchExecution(recipients, 'ATOMIC', network);

    expect(preparedForEstimate).toEqual(preparedForSubmit);
    expect(preparedForEstimate).toMatchObject({
      errorMode: 'ATOMIC',
      recipients,
      recipientCount: 2,
      totalValueAttoFil: 3_750_000_000_000_000_000n,
      batch: {
        value: 3_750_000_000_000_000_000n,
        recipientCount: 2,
      },
    });
    expect(preparedForEstimate.batch.data).toBe(preparedForSubmit.batch.data);
  });

  it('prepares the current Calibration EVM sender recipient matrix with network metadata', () => {
    const network = getNetworkConfig('calibration');
    const calibrationT4 = toF4(EVM_RECIPIENT, 't');
    const recipients = [
      { address: EVM_RECIPIENT, amount: 1 },
      { address: calibrationT4, amount: 2 },
      { address: CALIBRATION_T1, amount: 3 },
      { address: CALIBRATION_T2, amount: 4 },
      { address: CALIBRATION_T3, amount: 5 },
    ];

    const prepared = prepareBatchExecution(recipients, 'ATOMIC', network);

    expect(prepared).toMatchObject({
      errorMode: 'ATOMIC',
      recipients,
      recipientCount: 5,
      networkKey: 'calibration',
      chainId: 314159,
    });
    expect(prepared.batch.to).toBe(network.multicall3Address);
    expect(prepared.batch.value).toBe(15_000_000_000_000_000_000n);
    expect(prepared.batch.calls[0]).toMatchObject({
      target: getAddress(EVM_RECIPIENT),
      allowFailure: false,
      value: 1_000_000_000_000_000_000n,
      callData: '0x',
    });
    expect(prepared.batch.calls[1]).toMatchObject({
      target: getAddress(EVM_RECIPIENT),
      allowFailure: false,
      value: 2_000_000_000_000_000_000n,
      callData: '0x',
    });
    expect(prepared.batch.calls.slice(2).every((call) => call.target === network.filForwarderAddress))
      .toBe(true);
    expect(prepared.batch.calls.slice(2).every((call) => call.callData !== '0x')).toBe(true);
  });

  it('uses the active network contract addresses when preparing a batch', () => {
    const network = {
      ...getNetworkConfig('calibration'),
      multicall3Address: '0x3333333333333333333333333333333333333333' as const,
      filForwarderAddress: '0x4444444444444444444444444444444444444444' as const,
    };

    const prepared = prepareBatchExecution(
      [{ address: CALIBRATION_T1, amount: 1 }],
      'ATOMIC',
      network,
    );

    expect(prepared.batch.to).toBe(network.multicall3Address);
    expect(prepared.batch.calls[0]?.target).toBe(network.filForwarderAddress);
    expect(prepared.networkKey).toBe('calibration');
    expect(prepared.chainId).toBe(314159);
  });

  it('blocks Standard PARTIAL preparation because Multicall3 cannot refund failed value calls', () => {
    expect(() =>
      prepareBatchExecution(
        [{ address: EVM_RECIPIENT, amount: 1 }],
        'PARTIAL',
        getNetworkConfig('calibration'),
      ),
    ).toThrow('Standard Partial execution is disabled');
  });

  it('prepares ThinBatch calldata when the active network has a deployed ThinBatch address', () => {
    const network = {
      ...getNetworkConfig('calibration'),
      thinBatchAddress: '0x5555555555555555555555555555555555555555' as const,
    };

    const prepared = prepareBatchExecution(
      [
        { address: EVM_RECIPIENT, amount: 1 },
        { address: CALIBRATION_T1, amount: 2 },
      ],
      'PARTIAL',
      network,
      'THINBATCH',
    );

    expect(prepared).toMatchObject({
      executionMethod: 'THINBATCH',
      errorMode: 'PARTIAL',
      recipientCount: 2,
      networkKey: 'calibration',
      chainId: 314159,
    });
    expect(prepared.batch.executionMethod).toBe('THINBATCH');
    expect(prepared.batch.to).toBe(network.thinBatchAddress);
    expect(prepared.batch.value).toBe(3_000_000_000_000_000_000n);

    if (prepared.batch.executionMethod !== 'THINBATCH') {
      throw new Error('Expected ThinBatch execution');
    }

    expect(prepared.batch.payments).toHaveLength(2);
    expect(prepared.batch.payments[0]).toMatchObject({
      kind: 0,
      evmRecipient: getAddress(EVM_RECIPIENT),
      filecoinRecipient: '0x',
      amount: 1_000_000_000_000_000_000n,
    });
    expect(prepared.batch.payments[1]).toMatchObject({
      kind: 1,
      evmRecipient: '0x0000000000000000000000000000000000000000',
      amount: 2_000_000_000_000_000_000n,
    });
  });

  it('blocks ThinBatch preparation when the active network has no ThinBatch address', () => {
    const network = {
      ...getNetworkConfig('calibration'),
      thinBatchAddress: undefined,
    };

    expect(() =>
      prepareBatchExecution(
        [{ address: EVM_RECIPIENT, amount: 1 }],
        'PARTIAL',
        network,
        'THINBATCH',
      ),
    ).toThrow(
      'ThinBatch is not configured for Calibration. Set VITE_THINBATCH_ADDRESS_CALIBRATION before using this execution method.',
    );
  });
});
