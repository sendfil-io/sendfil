const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const DAG_CBOR_CID_PREFIX = Uint8Array.from([0x01, 0x71, 0xa0, 0xe4, 0x02, 0x20]);
const DAG_CBOR_DIGEST_LENGTH = 32;
const DAG_CBOR_CID_BYTE_LENGTH = DAG_CBOR_CID_PREFIX.length + DAG_CBOR_DIGEST_LENGTH;
const DAG_CBOR_CID_BASE32_LENGTH = Math.ceil((DAG_CBOR_CID_BYTE_LENGTH * 8) / 5);
const DAG_CBOR_CID_TEXT_LENGTH = 1 + DAG_CBOR_CID_BASE32_LENGTH;

function encodeBase32(bytes: Uint8Array): string {
  let encoded = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(buffer >> bits) & 0x1f];
      buffer &= (1 << bits) - 1;
    }
  }

  if (bits > 0) {
    encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }

  return encoded;
}

function decodeCanonicalBase32(payload: string): Uint8Array | undefined {
  if (payload.length !== DAG_CBOR_CID_BASE32_LENGTH) {
    return undefined;
  }

  const bytes = new Uint8Array(DAG_CBOR_CID_BYTE_LENGTH);
  let outputIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (const character of payload) {
    const value = BASE32_ALPHABET.indexOf(character);

    if (value < 0) {
      return undefined;
    }

    buffer = (buffer << 5) | value;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;

      if (outputIndex >= bytes.length) {
        return undefined;
      }

      bytes[outputIndex] = (buffer >> bits) & 0xff;
      outputIndex += 1;
      buffer &= (1 << bits) - 1;
    }
  }

  if (outputIndex !== bytes.length || bits !== 1 || buffer !== 0) {
    return undefined;
  }

  return encodeBase32(bytes) === payload ? bytes : undefined;
}

/**
 * Returns true only for a canonical Filecoin CIDv1 using dag-cbor and a
 * 32-byte blake2b-256 digest, encoded as unpadded lowercase base32 with the
 * `b` multibase prefix. Lotus messages and block headers both use this framing.
 */
export function isCanonicalFilecoinDagCborCid(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== DAG_CBOR_CID_TEXT_LENGTH ||
    value[0] !== 'b'
  ) {
    return false;
  }

  const bytes = decodeCanonicalBase32(value.slice(1));

  if (!bytes) {
    return false;
  }

  return DAG_CBOR_CID_PREFIX.every((byte, index) => bytes[index] === byte);
}

/** Semantic alias for persisted and submitted Lotus message CIDs. */
export function isCanonicalFilecoinMessageCid(value: unknown): value is string {
  return isCanonicalFilecoinDagCborCid(value);
}
