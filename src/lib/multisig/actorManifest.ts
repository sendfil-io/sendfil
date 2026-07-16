import type { SendFilNetworkKey } from '../networks';

const BASE32_LOWER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_MANIFEST_ENTRIES = 512;
const MAX_ACTOR_NAME_BYTES = 256;
const MAX_CID_BYTES = 256;

interface CborHeader {
  major: number;
  value: bigint;
  offset: number;
}

interface DecodedValue<T> {
  value: T;
  offset: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Builtin actor manifest is not canonical base64.');
  }

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;

  if (byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Builtin actor manifest is unreasonably large.');
  }

  const bytes = new Uint8Array(byteLength);
  let byteOffset = 0;

  for (let offset = 0; offset < value.length; offset += 4) {
    const first = BASE64_ALPHABET.indexOf(value[offset]!);
    const second = BASE64_ALPHABET.indexOf(value[offset + 1]!);
    const thirdChar = value[offset + 2]!;
    const fourthChar = value[offset + 3]!;
    const third = thirdChar === '=' ? 0 : BASE64_ALPHABET.indexOf(thirdChar);
    const fourth = fourthChar === '=' ? 0 : BASE64_ALPHABET.indexOf(fourthChar);
    const isFinalQuartet = offset + 4 === value.length;

    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw new Error('Builtin actor manifest is not canonical base64.');
    }

    if (
      (!isFinalQuartet && (thirdChar === '=' || fourthChar === '=')) ||
      (thirdChar === '=' && fourthChar !== '=') ||
      (thirdChar === '=' && (second & 0x0f) !== 0) ||
      (fourthChar === '=' && thirdChar !== '=' && (third & 0x03) !== 0)
    ) {
      throw new Error('Builtin actor manifest is not canonical base64.');
    }

    const chunk = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes[byteOffset] = (chunk >> 16) & 0xff;
    byteOffset += 1;

    if (thirdChar !== '=') {
      bytes[byteOffset] = (chunk >> 8) & 0xff;
      byteOffset += 1;
    }

    if (fourthChar !== '=') {
      bytes[byteOffset] = chunk & 0xff;
      byteOffset += 1;
    }
  }

  return bytes;
}

function readCborHeader(bytes: Uint8Array, startOffset: number): CborHeader {
  const first = bytes[startOffset];

  if (first === undefined) {
    throw new Error('Builtin actor manifest ended unexpectedly.');
  }

  const major = first >> 5;
  const additional = first & 0x1f;
  let offset = startOffset + 1;

  if (additional < 24) {
    return { major, value: BigInt(additional), offset };
  }

  const byteLength =
    additional === 24
      ? 1
      : additional === 25
        ? 2
        : additional === 26
          ? 4
          : additional === 27
            ? 8
            : 0;

  if (byteLength === 0) {
    throw new Error('Builtin actor manifest uses unsupported indefinite-length CBOR.');
  }

  if (offset + byteLength > bytes.length) {
    throw new Error('Builtin actor manifest ended inside a CBOR length.');
  }

  let value = 0n;
  for (let index = 0; index < byteLength; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }

  const minimum =
    byteLength === 1
      ? 24n
      : byteLength === 2
        ? 0x100n
        : byteLength === 4
          ? 0x1_0000n
          : 0x1_0000_0000n;

  if (value < minimum) {
    throw new Error('Builtin actor manifest uses a non-canonical CBOR length.');
  }

  offset += byteLength;
  return { major, value, offset };
}

function readSafeLength(header: CborHeader, expectedMajor: number, label: string): number {
  if (header.major !== expectedMajor) {
    throw new Error(`Builtin actor manifest ${label} has the wrong CBOR type.`);
  }

  const length = Number(header.value);

  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Builtin actor manifest ${label} length is invalid.`);
  }

  return length;
}

function readArrayLength(bytes: Uint8Array, offset: number, label: string): DecodedValue<number> {
  const header = readCborHeader(bytes, offset);

  return {
    value: readSafeLength(header, 4, label),
    offset: header.offset,
  };
}

function readText(bytes: Uint8Array, offset: number): DecodedValue<string> {
  const header = readCborHeader(bytes, offset);
  const length = readSafeLength(header, 3, 'actor name');
  const endOffset = header.offset + length;

  if (length === 0 || length > MAX_ACTOR_NAME_BYTES || endOffset > bytes.length) {
    throw new Error('Builtin actor manifest actor name is malformed.');
  }

  let value: string;

  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(header.offset, endOffset));
  } catch {
    throw new Error('Builtin actor manifest actor name is not valid UTF-8.');
  }

  return { value, offset: endOffset };
}

function readByteString(bytes: Uint8Array, offset: number): DecodedValue<Uint8Array> {
  const header = readCborHeader(bytes, offset);
  const length = readSafeLength(header, 2, 'CID');
  const endOffset = header.offset + length;

  if (length < 2 || length > MAX_CID_BYTES || endOffset > bytes.length) {
    throw new Error('Builtin actor manifest CID byte string is malformed.');
  }

  return {
    value: bytes.slice(header.offset, endOffset),
    offset: endOffset,
  };
}

function readUnsignedVarint(
  bytes: Uint8Array,
  startOffset: number,
  label: string,
): DecodedValue<bigint> {
  let value = 0n;
  let shift = 0n;

  for (let offset = startOffset; offset < bytes.length; offset += 1) {
    const byte = bytes[offset]!;
    const payload = byte & 0x7f;

    if (shift >= 64n || (shift === 63n && payload > 1)) {
      throw new Error(`Builtin actor manifest CID ${label} varint is too large.`);
    }

    value |= BigInt(payload) << shift;

    if ((byte & 0x80) === 0) {
      if (offset > startOffset && payload === 0) {
        throw new Error(`Builtin actor manifest CID ${label} varint is not canonical.`);
      }

      return { value, offset: offset + 1 };
    }

    shift += 7n;
  }

  throw new Error(`Builtin actor manifest CID ${label} varint is truncated.`);
}

function assertCanonicalCidBytes(bytes: Uint8Array): void {
  const version = readUnsignedVarint(bytes, 0, 'version');
  const codec = readUnsignedVarint(bytes, version.offset, 'codec');
  const multihashCode = readUnsignedVarint(bytes, codec.offset, 'multihash code');
  const digestLength = readUnsignedVarint(bytes, multihashCode.offset, 'digest length');
  const remaining = bytes.length - digestLength.offset;

  if (version.value !== 1n || codec.value === 0n || multihashCode.value === 0n) {
    throw new Error('Builtin actor manifest contains an unsupported CID.');
  }

  if (
    digestLength.value === 0n ||
    digestLength.value > BigInt(MAX_CID_BYTES) ||
    digestLength.value !== BigInt(remaining)
  ) {
    throw new Error('Builtin actor manifest CID multihash length is malformed.');
  }
}

function encodeBase32Lower(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bitLength = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitLength += 8;

    while (bitLength >= 5) {
      bitLength -= 5;
      output += BASE32_LOWER_ALPHABET[(buffer >> bitLength) & 0x1f];
    }

    buffer &= bitLength === 0 ? 0 : (1 << bitLength) - 1;
  }

  if (bitLength > 0) {
    output += BASE32_LOWER_ALPHABET[(buffer << (5 - bitLength)) & 0x1f];
  }

  return output;
}

function decodeBase32Lower(value: string): Uint8Array {
  const output: number[] = [];
  let buffer = 0;
  let bitLength = 0;

  for (const char of value) {
    const decoded = BASE32_LOWER_ALPHABET.indexOf(char);

    if (decoded < 0) {
      throw new Error('System actor BuiltinActors manifest link is malformed.');
    }

    buffer = (buffer << 5) | decoded;
    bitLength += 5;

    if (bitLength >= 8) {
      bitLength -= 8;
      output.push((buffer >> bitLength) & 0xff);
      buffer &= bitLength === 0 ? 0 : (1 << bitLength) - 1;
    }
  }

  if (bitLength > 0 && buffer !== 0) {
    throw new Error('System actor BuiltinActors manifest link is not canonical base32.');
  }

  return Uint8Array.from(output);
}

function readCid(bytes: Uint8Array, offset: number): DecodedValue<string> {
  const tag = readCborHeader(bytes, offset);

  if (tag.major !== 6 || tag.value !== 42n) {
    throw new Error('Builtin actor manifest entry is not a DAG-CBOR CID link.');
  }

  const encoded = readByteString(bytes, tag.offset);

  if (encoded.value[0] !== 0) {
    throw new Error('Builtin actor manifest CID link is missing its identity prefix.');
  }

  const cidBytes = encoded.value.slice(1);
  assertCanonicalCidBytes(cidBytes);

  return {
    value: `b${encodeBase32Lower(cidBytes)}`,
    offset: encoded.offset,
  };
}

export function getBuiltinActorsManifestCid(systemActorState: unknown): string {
  if (!isRecord(systemActorState) || !isRecord(systemActorState.State)) {
    throw new Error('System actor state is malformed.');
  }

  const link = systemActorState.State.BuiltinActors;

  if (
    !isRecord(link) ||
    Object.keys(link).length !== 1 ||
    typeof link['/'] !== 'string' ||
    !/^b[a-z2-7]+$/.test(link['/']) ||
    link['/'].length > MAX_CID_BYTES
  ) {
    throw new Error('System actor BuiltinActors manifest link is malformed.');
  }

  const manifestCid = link['/'];
  const cidBytes = decodeBase32Lower(manifestCid.slice(1));

  assertCanonicalCidBytes(cidBytes);

  if (`b${encodeBase32Lower(cidBytes)}` !== manifestCid) {
    throw new Error('System actor BuiltinActors manifest link is not canonical base32.');
  }

  return manifestCid;
}

export function decodeMultisigActorCodeCid(manifestBase64: string): string {
  const bytes = decodeCanonicalBase64(manifestBase64);
  const list = readArrayLength(bytes, 0, 'actor list');

  if (list.value === 0 || list.value > MAX_MANIFEST_ENTRIES) {
    throw new Error('Builtin actor manifest actor list length is invalid.');
  }

  const actors = new Map<string, string>();
  let offset = list.offset;

  for (let index = 0; index < list.value; index += 1) {
    const pair = readArrayLength(bytes, offset, 'entry');

    if (pair.value !== 2) {
      throw new Error('Builtin actor manifest entries must be name/CID pairs.');
    }

    const name = readText(bytes, pair.offset);
    const cid = readCid(bytes, name.offset);

    if (actors.has(name.value)) {
      throw new Error(`Builtin actor manifest contains duplicate "${name.value}" entries.`);
    }

    actors.set(name.value, cid.value);
    offset = cid.offset;
  }

  if (offset !== bytes.length) {
    throw new Error('Builtin actor manifest has trailing CBOR data.');
  }

  const multisigCodeCid = actors.get('multisig');

  if (!multisigCodeCid) {
    throw new Error('Builtin actor manifest does not contain a multisig entry.');
  }

  return multisigCodeCid;
}

export function getSystemActorAddress(networkKey: SendFilNetworkKey): 'f00' | 't00' {
  return networkKey === 'mainnet' ? 'f00' : 't00';
}
