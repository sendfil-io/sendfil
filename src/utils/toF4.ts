import { CoinType, delegatedFromEthAddress } from '@glif/filecoin-address';

/**
 * Convert an EVM 0x address to a Filecoin delegated f4/t4 address string.
 * @param ethAddr  checksummed 0x... address from wagmi/RainbowKit
 * @param network  'f' (mainnet) or 't' (Calibration)
 */
export function toF4(ethAddr: `0x${string}`, network: 'f' | 't' = 'f'): string {
  const coinType = network === 't' ? CoinType.TEST : CoinType.MAIN;
  return delegatedFromEthAddress(ethAddr, coinType);
}
