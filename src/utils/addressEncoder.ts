import {
  newFromString,
  ethAddressFromDelegated,
  Protocol,
} from '@glif/filecoin-address';

/**
 * Encode a Filecoin address to bytes for use with FilForwarder.
 * Returns the raw address bytes as a hex string.
 */
export function encodeFilecoinAddressToBytes(address: string): `0x${string}` {
  const addr = newFromString(address);
  const bytes = addr.bytes();
  return `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`;
}

/**
 * Convert an f4/t4 delegated address to an EVM 0x address.
 */
export function f4ToEthAddress(f4Address: string): `0x${string}` {
  return ethAddressFromDelegated(f4Address);
}

/**
 * Determine the address type for routing purposes.
 * - 'evm': Direct EVM transfer (0x or f4/t4)
 * - 'native': Route via FilForwarder (f1, f2, f3)
 * - 'invalid': Cannot be used (f0)
 */
export function getAddressType(
  address: string,
): 'evm' | 'native' | 'invalid' {
  const trimmed = address.trim();

  // 0x addresses are direct EVM
  if (trimmed.startsWith('0x')) {
    return 'evm';
  }

  // f0/t0 are ID addresses - reject
  if (trimmed.match(/^[ft]0/)) {
    return 'invalid';
  }

  // f4/t4 delegated addresses can be converted to 0x
  if (trimmed.match(/^[ft]4/)) {
    return 'evm';
  }

  // f1/f2/f3 (and t1/t2/t3) need FilForwarder routing
  if (trimmed.match(/^[ft][123]/)) {
    return 'native';
  }

  return 'invalid';
}

/**
 * Normalize an address to its canonical EVM form if possible.
 * - 0x addresses: returned as-is
 * - f4/t4 addresses: converted to 0x
 * - f1/f2/f3 addresses: returns null (need FilForwarder)
 */
export function normalizeToEvmAddress(
  address: string,
): `0x${string}` | null {
  const trimmed = address.trim();

  if (trimmed.startsWith('0x')) {
    return trimmed as `0x${string}`;
  }

  if (trimmed.match(/^[ft]4/)) {
    return f4ToEthAddress(trimmed);
  }

  return null;
}

/**
 * Validate that an address is supported for sending.
 * Throws an error if the address is not supported.
 */
export function validateAddressForSending(address: string): void {
  const type = getAddressType(address);

  if (type === 'invalid') {
    if (address.match(/^[ft]0/)) {
      throw new Error('f0/t0 ID addresses are not supported');
    }
    throw new Error(`Invalid address format: ${address}`);
  }
}

/**
 * Get the protocol type from a Filecoin address string.
 */
export function getProtocol(address: string): Protocol {
  const addr = newFromString(address);
  return addr.protocol();
}
