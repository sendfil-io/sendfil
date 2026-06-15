import { decodeFunctionData, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { toF4 } from '../../../utils/toF4';
import { encodeFilecoinAddressToBytes } from '../../../utils/addressEncoder';
import {
  THINBATCH_ERROR_MODE,
  THINBATCH_MAX_PAYMENTS,
  THINBATCH_PAYMENT_KIND,
  buildThinBatch,
  thinBatchAbi,
} from '../thinBatch';

const THINBATCH_ADDRESS = '0x5555555555555555555555555555555555555555' as const;
const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const EVM_TWIN = toF4(EVM_RECIPIENT, 'f');
const NATIVE_RECIPIENT = 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za';

describe('buildThinBatch', () => {
  it('canonicalizes 0x and f4 twins to identical EVM payment targets', () => {
    const batch = buildThinBatch(
      [
        { address: EVM_RECIPIENT, amount: 1n },
        { address: EVM_TWIN, amount: 2n },
      ],
      'PARTIAL',
      { thinBatchAddress: THINBATCH_ADDRESS },
    );

    const decoded = decodeFunctionData({
      abi: thinBatchAbi,
      data: batch.data,
    });
    const [payments, errorMode] = decoded.args;

    expect(batch).toMatchObject({
      executionMethod: 'THINBATCH',
      to: THINBATCH_ADDRESS,
      value: 3n,
      recipientCount: 2,
    });
    expect(errorMode).toBe(THINBATCH_ERROR_MODE.PARTIAL);
    expect(payments).toEqual([
      {
        kind: THINBATCH_PAYMENT_KIND.EVM,
        evmRecipient: getAddress(EVM_RECIPIENT),
        filecoinRecipient: '0x',
        amount: 1n,
      },
      {
        kind: THINBATCH_PAYMENT_KIND.EVM,
        evmRecipient: getAddress(EVM_RECIPIENT),
        filecoinRecipient: '0x',
        amount: 2n,
      },
    ]);
  });

  it('encodes f1/f2/f3-style recipients as Filecoin raw address bytes', () => {
    const batch = buildThinBatch(
      [{ address: NATIVE_RECIPIENT, amount: 5n }],
      'ATOMIC',
      { thinBatchAddress: THINBATCH_ADDRESS },
    );
    const decoded = decodeFunctionData({
      abi: thinBatchAbi,
      data: batch.data,
    });
    const [payments, errorMode] = decoded.args;

    expect(errorMode).toBe(THINBATCH_ERROR_MODE.ATOMIC);
    expect(payments).toEqual([
      {
        kind: THINBATCH_PAYMENT_KIND.FILECOIN,
        evmRecipient: '0x0000000000000000000000000000000000000000',
        filecoinRecipient: encodeFilecoinAddressToBytes(NATIVE_RECIPIENT),
        amount: 5n,
      },
    ]);
  });

  it('rejects unsupported recipient inputs before encoding calldata', () => {
    expect(() =>
      buildThinBatch(
        [{ address: 'f01234', amount: 1n }],
        'PARTIAL',
        { thinBatchAddress: THINBATCH_ADDRESS },
      ),
    ).toThrow('f0/t0 ID addresses are not supported');
  });

  it('rejects non-positive payment amounts before encoding calldata', () => {
    expect(() =>
      buildThinBatch(
        [{ address: EVM_RECIPIENT, amount: 0n }],
        'PARTIAL',
        { thinBatchAddress: THINBATCH_ADDRESS },
      ),
    ).toThrow('ThinBatch payment amount must be greater than 0');
  });

  it('requires at least one recipient', () => {
    expect(() =>
      buildThinBatch([], 'PARTIAL', { thinBatchAddress: THINBATCH_ADDRESS }),
    ).toThrow('No recipients provided');
  });

  it('caps batches at the ThinBatch contract payment limit', () => {
    expect(() =>
      buildThinBatch(
        Array.from({ length: THINBATCH_MAX_PAYMENTS + 1 }, () => ({
          address: EVM_RECIPIENT,
          amount: 1n,
        })),
        'PARTIAL',
        { thinBatchAddress: THINBATCH_ADDRESS },
      ),
    ).toThrow(`ThinBatch supports at most ${THINBATCH_MAX_PAYMENTS} payments`);
  });
});
