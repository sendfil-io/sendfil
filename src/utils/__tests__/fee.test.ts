import { describe, it, expect, beforeEach } from 'vitest';
import { calculateFeeRows, Recipient } from '../fee';

beforeEach(() => {
  (import.meta as any).env = {
    VITE_FEE_ADDR_A: 'f1feeA',
    VITE_FEE_ADDR_B: 'f1feeB',
    VITE_FEE_SPLIT: '0.5',
    VITE_FEE_PERCENT: '1',
  };
});

describe('calculateFeeRows', () => {
  it('appends fee rows split 50/50', () => {
    const result = calculateFeeRows([
      { address: 'f1user1', amount: 100 },
      { address: 'f1user2', amount: 100 },
    ]);
    expect(result).toEqual([
      { address: 'f1user1', amount: 100 },
      { address: 'f1user2', amount: 100 },
      { address: 'f1feeA', amount: 1 },
      { address: 'f1feeB', amount: 1 },
    ]);
  });

  it('throws if fee address present', () => {
    expect(() =>
      calculateFeeRows([
        { address: 'f1feeA', amount: 1 },
      ]),
    ).toThrow();
  });
});
