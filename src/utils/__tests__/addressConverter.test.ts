import { describe, expect, it } from 'vitest';
import { convertEthToDelegatedAddress } from '../addressConverter';

describe('convertEthToDelegatedAddress', () => {
  const ethAddress = '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd';

  it('formats mainnet delegated addresses with an f4 prefix', () => {
    expect(convertEthToDelegatedAddress(ethAddress, 314)).toMatch(/^f410f/);
  });

  it('formats Calibration delegated addresses with a t4 prefix', () => {
    expect(convertEthToDelegatedAddress(ethAddress, 314159)).toMatch(/^t410f/);
  });
});
