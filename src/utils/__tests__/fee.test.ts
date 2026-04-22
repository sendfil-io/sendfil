import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNetworkConfig } from '../../lib/networks';
import { calculateFeeRows, getFeeLabel } from '../fee';

describe('calculateFeeRows', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('appends fee rows on mainnet when fees are enabled', () => {
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', 'f1mainfeea');
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', 'f1mainfeeb');
    vi.stubEnv('VITE_FEE_PERCENT_MAINNET', '1');
    vi.stubEnv('VITE_FEE_SPLIT_MAINNET', '0.5');

    const result = calculateFeeRows(
      [
        { address: 'f1user1', amount: 100 },
        { address: 'f1user2', amount: 100 },
      ],
      getNetworkConfig('mainnet'),
    );

    expect(result).toEqual([
      { address: 'f1user1', amount: 100 },
      { address: 'f1user2', amount: 100 },
      { address: 'f1mainfeea', amount: 1 },
      { address: 'f1mainfeeb', amount: 1 },
    ]);
  });

  it('returns the original rows when calibration fees are disabled', () => {
    const recipients = [{ address: 't1user1', amount: 25 }];

    expect(calculateFeeRows(recipients, getNetworkConfig('calibration'))).toEqual(recipients);
    expect(getFeeLabel(314159)).toBe('Platform fee (disabled on testnet)');
  });

  it('throws if an enabled fee address is already present', () => {
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', 'f1mainfeea');
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', 'f1mainfeeb');

    expect(() =>
      calculateFeeRows([{ address: 'f1mainfeea', amount: 1 }], getNetworkConfig('mainnet')),
    ).toThrow('Fee address included in recipient list');
  });
});
