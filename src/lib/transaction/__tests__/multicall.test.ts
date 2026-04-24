import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { toF4 } from '../../../utils/toF4';
import {
  buildMulticallBatch,
  FILFORWARDER_ADDRESS,
  MULTICALL3_ADDRESS,
} from '../multicall';

const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const EVM_TWIN = toF4(EVM_RECIPIENT, 'f');
const NATIVE_RECIPIENT = 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za';

describe('buildMulticallBatch', () => {
  it('INV-ADDR-003 canonicalizes 0x and f4 twins to the same EVM transfer target', () => {
    const batch = buildMulticallBatch(
      [
        { address: EVM_RECIPIENT, amount: 1n },
        { address: EVM_TWIN, amount: 2n },
      ],
      'PARTIAL',
    );

    expect(batch.to).toBe(MULTICALL3_ADDRESS);
    expect(batch.value).toBe(3n);
    expect(batch.recipientCount).toBe(2);
    expect(batch.calls).toEqual([
      {
        target: getAddress(EVM_RECIPIENT),
        allowFailure: true,
        value: 1n,
        callData: '0x',
      },
      {
        target: getAddress(EVM_RECIPIENT),
        allowFailure: true,
        value: 2n,
        callData: '0x',
      },
    ]);
  });

  it('uses allowFailure=true for every call in PARTIAL mode', () => {
    const batch = buildMulticallBatch(
      [
        { address: EVM_RECIPIENT, amount: 1_000_000_000_000_000_000n },
        { address: NATIVE_RECIPIENT, amount: 2_000_000_000_000_000_000n },
      ],
      'PARTIAL',
    );

    expect(batch.calls).toHaveLength(2);
    expect(batch.calls.every((call) => call.allowFailure)).toBe(true);
    expect(batch.calls[1]?.target).toBe(FILFORWARDER_ADDRESS);
    expect(batch.calls[1]?.callData).not.toBe('0x');
  });

  it('uses allowFailure=false for every call in ATOMIC mode', () => {
    const batch = buildMulticallBatch(
      [
        { address: EVM_RECIPIENT, amount: 1_000_000_000_000_000_000n },
        { address: NATIVE_RECIPIENT, amount: 2_000_000_000_000_000_000n },
      ],
      'ATOMIC',
    );

    expect(batch.calls).toHaveLength(2);
    expect(batch.calls.every((call) => !call.allowFailure)).toBe(true);
  });

  it('INV-ADDR-002 rejects malformed recipient inputs before encoding', () => {
    expect(() =>
      buildMulticallBatch([{ address: 'f01234', amount: 1n }], 'ATOMIC'),
    ).toThrow('f0/t0 ID addresses are not supported');
  });
});
