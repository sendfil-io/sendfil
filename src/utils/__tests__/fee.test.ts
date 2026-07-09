import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { getNetworkConfig } from '../../lib/networks';
import { calculateFeeRows, getFeeLabel } from '../fee';

const MAINNET_FEE_A = '0x1111111111111111111111111111111111111111';
const MAINNET_FEE_B = '0x2222222222222222222222222222222222222222';
const CALIBRATION_FEE_A = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const CALIBRATION_FEE_B = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

describe('calculateFeeRows', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('appends fee rows on mainnet when fees are enabled', () => {
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', MAINNET_FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', MAINNET_FEE_B);
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
      { address: MAINNET_FEE_A, amount: 1 },
      { address: MAINNET_FEE_B, amount: 1 },
    ]);
  });

  it('returns the original rows when calibration fees are disabled', () => {
    const recipients = [{ address: 't1user1', amount: 25 }];

    expect(calculateFeeRows(recipients, getNetworkConfig('calibration'))).toEqual(recipients);
    expect(getFeeLabel(314159)).toBe('Platform fee (disabled on testnet)');
  });

  it('appends Calibration fee rows only when explicitly enabled', () => {
    vi.stubEnv('VITE_FEE_ENABLED_CALIBRATION', 'true');
    vi.stubEnv('VITE_FEE_ADDR_A_CALIBRATION', CALIBRATION_FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B_CALIBRATION', CALIBRATION_FEE_B);

    const result = calculateFeeRows(
      [{ address: '0x1234567890abcdef1234567890abcdef12345678', amount: 10 }],
      getNetworkConfig('calibration'),
    );

    expect(result).toEqual([
      { address: '0x1234567890abcdef1234567890abcdef12345678', amount: 10 },
      { address: CALIBRATION_FEE_A, amount: 0.05 },
      { address: CALIBRATION_FEE_B, amount: 0.05 },
    ]);
  });

  it('rejects wrong-prefix fee addresses when Calibration fees are enabled', () => {
    vi.stubEnv('VITE_FEE_ENABLED_CALIBRATION', 'true');
    vi.stubEnv('VITE_FEE_ADDR_A_CALIBRATION', CALIBRATION_FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B_CALIBRATION', 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za');

    expect(() =>
      calculateFeeRows(
        [{ address: '0x1234567890abcdef1234567890abcdef12345678', amount: 10 }],
        getNetworkConfig('calibration'),
      ),
    ).toThrow('does not match the current Calibration address format');
  });

  it('throws if an enabled fee address is already present', () => {
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', MAINNET_FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', MAINNET_FEE_B);

    expect(() =>
      calculateFeeRows([{ address: MAINNET_FEE_A, amount: 1 }], getNetworkConfig('mainnet')),
    ).toThrow('One recipient is already used by SendFIL fees. Remove it to continue.');
  });
});
