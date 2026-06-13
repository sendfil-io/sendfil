import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it } from 'vitest';
import { getNetworkConfig } from '../../networks';
import { FILSNAP_FILECOIN_PROVIDER_METADATA } from '../../senders';
import { createNativeFilecoinConnectedSender } from '../../senders/senderModel';
import { toF4 } from '../../../utils/toF4';
import { prepareBatchExecution } from '../batchExecution';
import {
  encodeInvokeEvmParams,
  INVOKE_EVM_METHOD_NUMBER,
  prepareNativeBatchMessage,
} from '../nativeBatchMessage';

const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

function decodeCborByteString(value: string): Uint8Array {
  const bytes = base64ToBytes(value);
  const first = bytes[0];

  if (first === undefined || (first & 0xe0) !== 0x40) {
    throw new Error('Expected a CBOR byte string');
  }

  const additional = first & 0x1f;

  if (additional < 24) {
    return bytes.slice(1, 1 + additional);
  }

  if (additional === 24) {
    const length = bytes[1]!;
    return bytes.slice(2, 2 + length);
  }

  if (additional === 25) {
    const length = (bytes[1]! << 8) | bytes[2]!;
    return bytes.slice(3, 3 + length);
  }

  if (additional === 26) {
    const length =
      (bytes[1]! << 24) | (bytes[2]! << 16) | (bytes[3]! << 8) | bytes[4]!;
    return bytes.slice(5, 5 + length);
  }

  throw new Error('Unsupported CBOR byte string length encoding');
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function getNativeSender(address: string) {
  const result = createNativeFilecoinConnectedSender({
    address,
    provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create native sender');
  }

  return result.sender;
}

describe('native Filecoin batch message preparation', () => {
  it('builds one Calibration InvokeEVM message from the existing Multicall3 batch payload', () => {
    const network = getNetworkConfig('calibration');
    const sender = getNativeSender(CALIBRATION_T1);
    const recipients = [
      { address: EVM_RECIPIENT, amount: 1 },
      { address: toF4(EVM_RECIPIENT, 't'), amount: 2 },
      { address: CALIBRATION_T1, amount: 3 },
    ];
    const preparedBatch = prepareBatchExecution(recipients, 'ATOMIC', network);

    const nativePrepared = prepareNativeBatchMessage({
      sender,
      preparedBatch,
      nonce: 7,
    });

    expect(nativePrepared).toMatchObject({
      sender,
      preparedBatch,
      targetEvmAddress: network.multicall3Address,
      targetFilecoinAddress: toF4(network.multicall3Address, 't'),
      method: INVOKE_EVM_METHOD_NUMBER,
      paramsCodec: 'cbor-bytes-base64',
    });
    expect(nativePrepared.message).toEqual({
      Version: 0,
      To: toF4(network.multicall3Address, 't'),
      From: CALIBRATION_T1,
      Nonce: 7,
      Value: '6000000000000000000',
      Method: INVOKE_EVM_METHOD_NUMBER,
      Params: encodeInvokeEvmParams(preparedBatch.batch.data),
      GasLimit: 0,
      GasFeeCap: '0',
      GasPremium: '0',
    });
    expect(bytesToHex(decodeCborByteString(nativePrepared.message.Params!))).toBe(
      preparedBatch.batch.data,
    );
  });

  it('preserves ATOMIC call semantics from the prepared FEVM batch', () => {
    const network = getNetworkConfig('calibration');
    const sender = getNativeSender(CALIBRATION_T1);
    const preparedBatch = prepareBatchExecution(
      [{ address: CALIBRATION_T1, amount: 1 }],
      'ATOMIC',
      network,
    );

    const nativePrepared = prepareNativeBatchMessage({
      sender,
      preparedBatch,
      nonce: 0,
      gas: {
        gasLimit: 123,
        gasFeeCap: '456',
        gasPremium: '789',
      },
    });

    expect(preparedBatch.batch.calls.every((call) => call.allowFailure === false)).toBe(true);
    expect(bytesToHex(decodeCborByteString(nativePrepared.message.Params!))).toBe(
      preparedBatch.batch.data,
    );
    expect(nativePrepared.message).toMatchObject({
      GasLimit: 123,
      GasFeeCap: '456',
      GasPremium: '789',
    });
  });

  it('rejects native sender and batch network mismatches', () => {
    const sender = getNativeSender(MAINNET_F1);
    const preparedBatch = prepareBatchExecution(
      [{ address: CALIBRATION_T1, amount: 1 }],
      'ATOMIC',
      getNetworkConfig('calibration'),
    );

    expect(() =>
      prepareNativeBatchMessage({
        sender,
        preparedBatch,
        nonce: 0,
      }),
    ).toThrow('Native sender network mainnet does not match prepared batch network calibration');
  });

  it('encodes InvokeEVM calldata as a CBOR byte string in Filecoin message params', () => {
    expect(bytesToHex(decodeCborByteString(encodeInvokeEvmParams('0x1234abcd')))).toBe(
      '0x1234abcd',
    );
  });
});
