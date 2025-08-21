import { delegatedFromEthAddress, CoinType } from '@glif/filecoin-address'

export function convertEthToF4(ethAddress: string): string {
  try {
    // Convert to f4 address (using CoinType.MAIN for mainnet)
    const f4Address = delegatedFromEthAddress(ethAddress as `0x${string}`, CoinType.MAIN)
    return f4Address
  } catch (error) {
    console.error('Error converting address:', error)
    return ethAddress // fallback to original
  }
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars + (address.startsWith('0x') ? 2 : 1))}...${address.slice(-chars)}`
} 