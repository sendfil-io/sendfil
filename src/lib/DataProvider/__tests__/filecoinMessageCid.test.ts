import { describe, expect, it } from 'vitest';
import { isCanonicalFilecoinMessageCid } from '../filecoinMessageCid';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const MESSAGE_PREFIX = [0x01, 0x71, 0xa0, 0xe4, 0x02, 0x20] as const;
const DIGEST = Uint8Array.from({ length: 32 }, (_, index) => index);
const KNOWN_MESSAGE_CID = 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';

function encodeBase32(bytes: Uint8Array): string {
  let output = '';
  let accumulator = 0;
  let bitCount = 0;

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      bitCount -= 5;
      output += BASE32_ALPHABET[(accumulator >> bitCount) & 0x1f];
      accumulator &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bitCount)) & 0x1f];
  }

  return output;
}

function cidFromBytes(bytes: Uint8Array): string {
  return `b${encodeBase32(bytes)}`;
}

function messageCid(prefix: readonly number[] = MESSAGE_PREFIX): string {
  return cidFromBytes(Uint8Array.from([...prefix, ...DIGEST]));
}

describe('isCanonicalFilecoinMessageCid', () => {
  it('accepts canonical Lotus message CIDs', () => {
    expect(isCanonicalFilecoinMessageCid(KNOWN_MESSAGE_CID)).toBe(true);
    expect(isCanonicalFilecoinMessageCid(messageCid())).toBe(true);
  });

  it.each([undefined, null, 1, {}, '', 'bafy2bzacedactioncid', `b${'a'.repeat(61)}`])(
    'rejects a non-message or fake CID: %j',
    (value) => {
      expect(isCanonicalFilecoinMessageCid(value)).toBe(false);
    },
  );

  it('rejects uppercase, whitespace, truncation, extension, padding, and malformed alphabet', () => {
    const valid = messageCid();

    expect(isCanonicalFilecoinMessageCid(valid.toUpperCase())).toBe(false);
    expect(isCanonicalFilecoinMessageCid(` ${valid}`)).toBe(false);
    expect(isCanonicalFilecoinMessageCid(`${valid} `)).toBe(false);
    expect(isCanonicalFilecoinMessageCid(valid.slice(0, -1))).toBe(false);
    expect(isCanonicalFilecoinMessageCid(`${valid}a`)).toBe(false);
    expect(isCanonicalFilecoinMessageCid(`${valid.slice(0, -1)}=`)).toBe(false);
    expect(isCanonicalFilecoinMessageCid(`${valid.slice(0, -1)}0`)).toBe(false);
  });

  it('rejects a base32 spelling with nonzero trailing pad bits', () => {
    const valid = messageCid();
    const canonicalLastValue = BASE32_ALPHABET.indexOf(valid[valid.length - 1]!);

    expect(canonicalLastValue & 1).toBe(0);

    const nonCanonical = valid.slice(0, -1) + BASE32_ALPHABET[canonicalLastValue | 1];

    expect(isCanonicalFilecoinMessageCid(nonCanonical)).toBe(false);
  });

  it.each([
    ['CIDv0/version byte', [0x00, ...MESSAGE_PREFIX.slice(1)]],
    ['actor-code/raw codec', [0x01, 0x55, ...MESSAGE_PREFIX.slice(2)]],
    ['different multihash code', [0x01, 0x71, 0x12, 0xe4, 0x02, 0x20]],
    ['different digest length', [...MESSAGE_PREFIX.slice(0, -1), 0x1f]],
  ] as const)('rejects a canonical base32 CID with %s', (_, prefix) => {
    expect(isCanonicalFilecoinMessageCid(messageCid(prefix))).toBe(false);
  });

  it('rejects a canonical sha2-256 CID with a different byte length', () => {
    const sha256Cid = cidFromBytes(Uint8Array.from([0x01, 0x71, 0x12, 0x20, ...DIGEST]));

    expect(isCanonicalFilecoinMessageCid(sha256Cid)).toBe(false);
  });
});
