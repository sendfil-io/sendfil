import { delegatedFromEthAddress } from '@glif/filecoin-address';
import { getCoinTypeForChainId } from '../lib/networks';

export function convertEthToDelegatedAddress(
  ethAddress: string,
  chainId?: number,
): string {
  try {
    return delegatedFromEthAddress(
      ethAddress as `0x${string}`,
      getCoinTypeForChainId(chainId),
    );
  } catch (error) {
    console.error('Error converting address:', error);
    return ethAddress;
  }
}

export function convertEthToF4(ethAddress: string, chainId?: number): string {
  return convertEthToDelegatedAddress(ethAddress, chainId);
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + (address.startsWith('0x') ? 2 : 1))}...${address.slice(-chars)}`;
}
