import type { FilecoinMessage } from '../DataProvider/types';
import type { NativeFilecoinConnectedSender } from '../senders';
import { toF4 } from '../../utils/toF4';
import type { PreparedBatchExecution } from './batchExecution';

// Filecoin EVM actors expose FRC42(InvokeEVM) for native -> EVM calls.
export const INVOKE_EVM_METHOD_NUMBER = 3_844_450_837;

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface NativeBatchMessageGasFields {
  gasLimit?: number;
  gasFeeCap?: string;
  gasPremium?: string;
}

export interface PrepareNativeBatchMessageParams {
  sender: NativeFilecoinConnectedSender;
  preparedBatch: PreparedBatchExecution;
  nonce: number;
  gas?: NativeBatchMessageGasFields;
}

export interface PreparedNativeBatchMessage {
  message: FilecoinMessage;
  sender: NativeFilecoinConnectedSender;
  preparedBatch: PreparedBatchExecution;
  targetEvmAddress: `0x${string}`;
  targetFilecoinAddress: string;
  method: typeof INVOKE_EVM_METHOD_NUMBER;
  paramsCodec: 'cbor-bytes-base64';
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const value = hex.slice(2);

  if (value.length % 2 !== 0) {
    throw new Error('Hex calldata must have an even number of characters');
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
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

function encodeCborByteString(bytes: Uint8Array): Uint8Array {
  const length = bytes.length;

  if (length < 24) {
    return Uint8Array.from([0x40 + length, ...bytes]);
  }

  if (length <= 0xff) {
    return Uint8Array.from([0x58, length, ...bytes]);
  }

  if (length <= 0xffff) {
    return Uint8Array.from([0x59, (length >> 8) & 0xff, length & 0xff, ...bytes]);
  }

  if (length <= 0xffffffff) {
    return Uint8Array.from([
      0x5a,
      (length >> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
      ...bytes,
    ]);
  }

  throw new Error('Calldata is too large to encode as a native Filecoin InvokeEVM param');
}

export function encodeInvokeEvmParams(calldata: `0x${string}`): string {
  return bytesToBase64(encodeCborByteString(hexToBytes(calldata)));
}

export function prepareNativeBatchMessage({
  sender,
  preparedBatch,
  nonce,
  gas,
}: PrepareNativeBatchMessageParams): PreparedNativeBatchMessage {
  if (sender.networkKey !== preparedBatch.networkKey || sender.chainId !== preparedBatch.chainId) {
    throw new Error(
      `Native sender network ${sender.networkKey} does not match prepared batch network ${preparedBatch.networkKey}.`,
    );
  }

  if (nonce < 0 || !Number.isInteger(nonce)) {
    throw new Error('Native Filecoin message nonce must be a non-negative integer');
  }

  const targetFilecoinAddress = toF4(preparedBatch.batch.to, sender.nativePrefix);
  const message: FilecoinMessage = {
    Version: 0,
    To: targetFilecoinAddress,
    From: sender.address,
    Nonce: nonce,
    Value: preparedBatch.totalValueAttoFil.toString(),
    Method: INVOKE_EVM_METHOD_NUMBER,
    Params: encodeInvokeEvmParams(preparedBatch.batch.data),
    GasLimit: gas?.gasLimit ?? 0,
    GasFeeCap: gas?.gasFeeCap ?? '0',
    GasPremium: gas?.gasPremium ?? '0',
  };

  return {
    message,
    sender,
    preparedBatch,
    targetEvmAddress: preparedBatch.batch.to,
    targetFilecoinAddress,
    method: INVOKE_EVM_METHOD_NUMBER,
    paramsCodec: 'cbor-bytes-base64',
  };
}
