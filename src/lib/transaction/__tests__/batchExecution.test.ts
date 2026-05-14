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
    const preparedForEstimate = prepareBatchExecution(recipients, 'PARTIAL', network);
    const preparedForSubmit = prepareBatchExecution(recipients, 'PARTIAL', network);

    expect(preparedForEstimate).toEqual(preparedForSubmit);
    expect(preparedForEstimate).toMatchObject({
      errorMode: 'PARTIAL',
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

    const prepared = prepareBatchExecution(recipients, 'PARTIAL', network);

    expect(prepared).toMatchObject({
      errorMode: 'PARTIAL',
      recipients,
      recipientCount: 5,
      networkKey: 'calibration',
      chainId: 314159,
    });
    expect(prepared.batch.to).toBe(network.multicall3Address);
    expect(prepared.batch.value).toBe(15_000_000_000_000_000_000n);
    expect(prepared.batch.calls[0]).toMatchObject({
      target: getAddress(EVM_RECIPIENT),
      allowFailure: true,
      value: 1_000_000_000_000_000_000n,
      callData: '0x',
    });
    expect(prepared.batch.calls[1]).toMatchObject({
      target: getAddress(EVM_RECIPIENT),
      allowFailure: true,
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
      'PARTIAL',
      network,
    );

    expect(prepared.batch.to).toBe(network.multicall3Address);
    expect(prepared.batch.calls[0]?.target).toBe(network.filForwarderAddress);
    expect(prepared.networkKey).toBe('calibration');
    expect(prepared.chainId).toBe(314159);
  });
});
