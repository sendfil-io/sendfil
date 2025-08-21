import { newDelegatedEthAddress } from '@glif/filecoin-address';

/**
 * Convert an EVM 0x address to a Filecoin delegated f4/t4 address string.
 * @param ethAddr  checksummed 0x... address from wagmi/RainbowKit
 * @param network  'f' (mainnet) or 't' (Calibration)
 */
export function toF4(ethAddr: `0x${string}`, network: 'f' | 't' = 'f'): string {
  // Use GLIF's built-in function to create delegated address from ETH address
  // The second parameter sets the network prefix (f for mainnet, t for testnet)
  const addr = newDelegatedEthAddress(ethAddr, network);
  
  // Convert to string representation (f4... / t4...)
  return addr.toString();
}
