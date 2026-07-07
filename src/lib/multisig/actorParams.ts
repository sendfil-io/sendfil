import {
  Address,
  CoinType,
  newFromString,
  newIDAddress,
  Protocol,
} from '@glif/filecoin-address';
import { blake2b } from 'blakejs';
import type { NetworkPrefix, SendFilNetworkKey } from '../networks';
import { encodeInvokeEvmParams } from '../transaction/nativeBatchMessage';

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE32_LOWER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export const INIT_ACTOR_ID = 1;
export const METHODS_INIT_EXEC = 2;
export const METHODS_MULTISIG_PROPOSE = 2;
export const METHODS_MULTISIG_APPROVE = 3;
export const METHODS_MULTISIG_CANCEL = 4;
export const MAX_MULTISIG_SIGNERS = 256;

export interface ConstructorParamsInput {
  signers: string[];
  threshold: number;
  unlockDuration?: number;
  startEpoch?: number;
}

export interface InitExecParamsInput {
  codeCid: string;
  constructorParams: Uint8Array;
}

export interface ProposeParamsInput {
  to: string;
  valueAttoFil: bigint;
  method: number;
  params: Uint8Array;
}

export interface ProposalHashDataInput extends ProposeParamsInput {
  requesterIdAddress: string;
}

export interface TxnIDParamsInput {
  id: number;
  proposalHash: Uint8Array;
}

export interface ProposeReturn {
  txnId: number;
  applied: boolean;
  code: number;
  ret: Uint8Array;
}

export interface ExecReturn {
  idAddress: string;
  robustAddress: string;
}

type DecodedCbor =
  | number
  | bigint
  | boolean
  | Uint8Array
  | DecodedCbor[];

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function numberToBytes(value: bigint, byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let remaining = value;

  for (let index = byteLength - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return output;
}

function encodeMajorType(majorType: number, value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error('CBOR major type value cannot be negative');
  }

  const prefix = majorType << 5;

  if (value < 24n) {
    return Uint8Array.from([prefix | Number(value)]);
  }

  if (value <= 0xffn) {
    return Uint8Array.from([prefix | 24, Number(value)]);
  }

  if (value <= 0xffffn) {
    return concatBytes([
      Uint8Array.from([prefix | 25]),
      numberToBytes(value, 2),
    ]);
  }

  if (value <= 0xffffffffn) {
    return concatBytes([
      Uint8Array.from([prefix | 26]),
      numberToBytes(value, 4),
    ]);
  }

  if (value <= 0xffffffffffffffffn) {
    return concatBytes([
      Uint8Array.from([prefix | 27]),
      numberToBytes(value, 8),
    ]);
  }

  throw new Error('CBOR integer is too large');
}

function encodeUnsigned(value: number | bigint): Uint8Array {
  return encodeMajorType(0, BigInt(value));
}

function encodeSigned(value: number | bigint): Uint8Array {
  const bigintValue = BigInt(value);

  if (bigintValue >= 0n) {
    return encodeMajorType(0, bigintValue);
  }

  return encodeMajorType(1, -bigintValue - 1n);
}

function encodeByteString(bytes: Uint8Array): Uint8Array {
  return concatBytes([encodeMajorType(2, BigInt(bytes.length)), bytes]);
}

function encodeArray(items: Uint8Array[]): Uint8Array {
  return concatBytes([encodeMajorType(4, BigInt(items.length)), ...items]);
}

function encodeCid(codeCid: string): Uint8Array {
  const cidBytes = decodeCidBytes(codeCid);

  return concatBytes([
    encodeMajorType(6, 42n),
    encodeByteString(concatBytes([Uint8Array.from([0]), cidBytes])),
  ]);
}

function encodeAddress(address: string): Uint8Array {
  return encodeByteString(newFromString(address).bytes);
}

function bigintMagnitudeBytes(value: bigint): Uint8Array {
  if (value === 0n) {
    return new Uint8Array();
  }

  const hex = value.toString(16).padStart(
    value.toString(16).length % 2 === 0 ? value.toString(16).length : value.toString(16).length + 1,
    '0',
  );
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function encodeTokenAmount(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error('Token amount cannot be negative');
  }

  if (value === 0n) {
    return encodeByteString(new Uint8Array());
  }

  return encodeByteString(
    concatBytes([Uint8Array.from([0]), bigintMagnitudeBytes(value)]),
  );
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitLength = 0;

  for (const char of normalized) {
    const index = BASE64_ALPHABET.indexOf(char);

    if (index < 0) {
      throw new Error(`Invalid base64 character "${char}"`);
    }

    buffer = (buffer << 6) | index;
    bitLength += 6;

    if (bitLength >= 8) {
      bitLength -= 8;
      bytes.push((buffer >> bitLength) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const hasSecond = second !== undefined;
    const hasThird = third !== undefined;
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += BASE64_ALPHABET[(chunk >> 18) & 0x3f];
    output += BASE64_ALPHABET[(chunk >> 12) & 0x3f];
    output += hasSecond ? BASE64_ALPHABET[(chunk >> 6) & 0x3f] : '=';
    output += hasThird ? BASE64_ALPHABET[chunk & 0x3f] : '=';
  }

  return output;
}

function decodeBase32Lower(value: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bitLength = 0;

  for (const char of value.toLowerCase().replace(/=+$/, '')) {
    const index = BASE32_LOWER_ALPHABET.indexOf(char);

    if (index < 0) {
      throw new Error(`Unsupported CID base32 character "${char}"`);
    }

    buffer = (buffer << 5) | index;
    bitLength += 5;

    if (bitLength >= 8) {
      bitLength -= 8;
      bytes.push((buffer >> bitLength) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

export function decodeCidBytes(codeCid: string): Uint8Array {
  if (!codeCid.startsWith('b')) {
    throw new Error('Only CIDv1 base32 actor code CIDs are supported');
  }

  return decodeBase32Lower(codeCid.slice(1));
}

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToBytes(hex: `0x${string}`): Uint8Array {
  const value = hex.slice(2);

  if (value.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters');
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

export function filStringToAttoFil(value: string): bigint {
  const trimmed = value.trim();

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(trimmed)) {
    throw new Error('Enter a nonnegative FIL amount with up to 18 decimal places.');
  }

  const [whole, decimal = ''] = trimmed.split('.');
  return BigInt(`${whole}${decimal.padEnd(18, '0')}`);
}

export function bytesToParamsBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function paramsBase64ToBytes(params: string): Uint8Array {
  return base64ToBytes(params);
}

export function encodeConstructorParams({
  signers,
  threshold,
  unlockDuration = 0,
  startEpoch = 0,
}: ConstructorParamsInput): Uint8Array {
  return encodeArray([
    encodeArray(signers.map(encodeAddress)),
    encodeUnsigned(threshold),
    encodeSigned(unlockDuration),
    encodeSigned(startEpoch),
  ]);
}

export function encodeInitExecParams({
  codeCid,
  constructorParams,
}: InitExecParamsInput): Uint8Array {
  return encodeArray([
    encodeCid(codeCid),
    encodeByteString(constructorParams),
  ]);
}

export function encodeProposeParams({
  to,
  valueAttoFil,
  method,
  params,
}: ProposeParamsInput): Uint8Array {
  return encodeArray([
    encodeAddress(to),
    encodeTokenAmount(valueAttoFil),
    encodeUnsigned(method),
    encodeByteString(params),
  ]);
}

export function encodeProposalHashData({
  requesterIdAddress,
  to,
  valueAttoFil,
  method,
  params,
}: ProposalHashDataInput): Uint8Array {
  const requester = newFromString(requesterIdAddress);

  if (requester.protocol() !== Protocol.ID) {
    throw new Error('Proposal hash requester must be an ID address');
  }

  return encodeArray([
    encodeAddress(requesterIdAddress),
    encodeAddress(to),
    encodeTokenAmount(valueAttoFil),
    encodeUnsigned(method),
    encodeByteString(params),
  ]);
}

export function computeProposalHash(input: ProposalHashDataInput): Uint8Array {
  return blake2b(encodeProposalHashData(input), undefined, 32);
}

export function encodeTxnIDParams({ id, proposalHash }: TxnIDParamsInput): Uint8Array {
  return encodeArray([encodeSigned(id), encodeByteString(proposalHash)]);
}

export function decodeInvokeEvmParamsBase64(calldata: `0x${string}`): Uint8Array {
  return paramsBase64ToBytes(encodeInvokeEvmParams(calldata));
}

export function getInitActorAddress(networkKey: SendFilNetworkKey): string {
  const coinType = networkKey === 'mainnet' ? CoinType.MAIN : CoinType.TEST;

  return newIDAddress(INIT_ACTOR_ID, coinType).toString();
}

export function inferNetworkKeyFromPrefix(prefix: NetworkPrefix): SendFilNetworkKey {
  return prefix === 'f' ? 'mainnet' : 'calibration';
}

function readCborHeader(bytes: Uint8Array, offset: number): {
  major: number;
  value: bigint;
  offset: number;
} {
  const first = bytes[offset];

  if (first === undefined) {
    throw new Error('Unexpected end of CBOR input');
  }

  const major = first >> 5;
  const additional = first & 0x1f;
  let nextOffset = offset + 1;

  if (additional < 24) {
    return { major, value: BigInt(additional), offset: nextOffset };
  }

  const byteLength =
    additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : 0;

  if (byteLength === 0) {
    throw new Error('Unsupported CBOR additional information');
  }

  if (nextOffset + byteLength > bytes.length) {
    throw new Error('Unexpected end of CBOR integer');
  }

  let value = 0n;
  for (let index = 0; index < byteLength; index += 1) {
    value = (value << 8n) | BigInt(bytes[nextOffset + index]!);
  }

  nextOffset += byteLength;
  return { major, value, offset: nextOffset };
}

function decodeCborValue(bytes: Uint8Array, startOffset = 0): {
  value: DecodedCbor;
  offset: number;
} {
  const header = readCborHeader(bytes, startOffset);

  if (header.major === 0) {
    const asNumber = Number(header.value);
    return {
      value: BigInt(asNumber) === header.value ? asNumber : header.value,
      offset: header.offset,
    };
  }

  if (header.major === 1) {
    const negative = -1n - header.value;
    const asNumber = Number(negative);
    return {
      value: BigInt(asNumber) === negative ? asNumber : negative,
      offset: header.offset,
    };
  }

  if (header.major === 2) {
    const length = Number(header.value);
    const endOffset = header.offset + length;

    if (endOffset > bytes.length) {
      throw new Error('Unexpected end of CBOR byte string');
    }

    return {
      value: bytes.slice(header.offset, endOffset),
      offset: endOffset,
    };
  }

  if (header.major === 4) {
    const items: DecodedCbor[] = [];
    let offset = header.offset;

    for (let index = 0; index < Number(header.value); index += 1) {
      const decoded = decodeCborValue(bytes, offset);
      items.push(decoded.value);
      offset = decoded.offset;
    }

    return { value: items, offset };
  }

  if (header.major === 7) {
    if (header.value === 20n) {
      return { value: false, offset: header.offset };
    }

    if (header.value === 21n) {
      return { value: true, offset: header.offset };
    }
  }

  throw new Error(`Unsupported CBOR major type ${header.major}`);
}

function assertDecodedArray(value: DecodedCbor, length: number): DecodedCbor[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`Expected CBOR array with ${length} fields`);
  }

  return value;
}

function assertDecodedBytes(value: DecodedCbor): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error('Expected CBOR byte string');
  }

  return value;
}

function assertDecodedNumber(value: DecodedCbor): number {
  if (typeof value !== 'number') {
    throw new Error('Expected CBOR number');
  }

  return value;
}

export function decodeProposeReturn(paramsBase64: string): ProposeReturn | undefined {
  if (!paramsBase64) {
    return undefined;
  }

  const decoded = decodeCborValue(paramsBase64ToBytes(paramsBase64));
  const fields = assertDecodedArray(decoded.value, 4);

  if (typeof fields[1] !== 'boolean') {
    throw new Error('Expected ProposeReturn applied flag');
  }

  return {
    txnId: assertDecodedNumber(fields[0]),
    applied: fields[1],
    code: assertDecodedNumber(fields[2]),
    ret: assertDecodedBytes(fields[3]),
  };
}

export function decodeExecReturn(
  paramsBase64: string,
  networkKey: SendFilNetworkKey,
): ExecReturn | undefined {
  if (!paramsBase64) {
    return undefined;
  }

  const decoded = decodeCborValue(paramsBase64ToBytes(paramsBase64));
  const fields = assertDecodedArray(decoded.value, 2);
  const idBytes = assertDecodedBytes(fields[0]);
  const robustBytes = assertDecodedBytes(fields[1]);
  const coinType = networkKey === 'mainnet' ? CoinType.MAIN : CoinType.TEST;
  const idAddress = new Address(idBytes, coinType).toString();
  const robustAddress = new Address(robustBytes, coinType).toString();

  return { idAddress, robustAddress };
}
