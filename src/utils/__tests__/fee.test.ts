import { describe, it, expect } from 'vitest';
import { calculateFeeRows } from '../fee';

const FEE_A = import.meta.env.VITE_FEE_ADDR_A as string;
const FEE_B = import.meta.env.VITE_FEE_ADDR_B as string;

describe('calculateFeeRows', () => {
  it('appends fee rows split 50/50', () => {
    const result = calculateFeeRows([
      { address: 'f1user1', amount: 100 },
      { address: 'f1user2', amount: 100 },
    ]);
    expect(result).toEqual([
      { address: 'f1user1', amount: 100 },
      { address: 'f1user2', amount: 100 },
      { address: FEE_A, amount: 1 },
      { address: FEE_B, amount: 1 },
    ]);
  });

  it('throws if fee address present', () => {
    expect(() =>
      calculateFeeRows([
        { address: FEE_A, amount: 1 },
      ]),
    ).toThrow();
  });
});
