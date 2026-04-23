import { describe, expect, it } from 'vitest';
import { buildMulticallBatch } from '../multicall';

const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const NATIVE_RECIPIENT = 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za';

describe('buildMulticallBatch', () => {
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

  it('rejects malformed recipient inputs before encoding', () => {
    expect(() =>
      buildMulticallBatch([{ address: 'f01234', amount: 1n }], 'ATOMIC'),
    ).toThrow('f0/t0 ID addresses are not supported');
  });
});
