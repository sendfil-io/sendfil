import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { describe, expect, it } from 'vitest';
import { getNetworkConfig } from '../../networks';
import { prepareBatchExecution } from '../../transaction/batchExecution';
import { INVOKE_EVM_METHOD_NUMBER } from '../../transaction/nativeBatchMessage';
import { toF4 } from '../../../utils/toF4';
import {
  bytesToHex,
  computeProposalHash,
  decodeInvokeEvmParamsBase64,
  encodeConstructorParams,
  encodeInitExecParams,
  encodeProposeParams,
  encodeProposalHashData,
  encodeTxnIDParams,
  paramsBase64ToBytes,
} from '../actorParams';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();
const CALIBRATION_T1_SECOND = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 80),
  CoinType.TEST,
).toString();
const PROPOSER_ID = 't01001';

function readHeader(bytes: Uint8Array, offset: number): {
  major: number;
  value: number;
  offset: number;
} {
  const first = bytes[offset];

  if (first === undefined) {
    throw new Error('Unexpected end of CBOR data');
  }

  const major = first >> 5;
  const additional = first & 0x1f;
  let nextOffset = offset + 1;

  if (additional < 24) {
    return { major, value: additional, offset: nextOffset };
  }

  const byteLength =
    additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 8;
  let value = 0;

  for (let index = 0; index < byteLength; index += 1) {
    value = (value << 8) | bytes[nextOffset + index]!;
  }

  nextOffset += byteLength;
  return { major, value, offset: nextOffset };
}

function readByteString(bytes: Uint8Array, offset: number): {
  value: Uint8Array;
  offset: number;
} {
  const header = readHeader(bytes, offset);

  expect(header.major).toBe(2);
  return {
    value: bytes.slice(header.offset, header.offset + header.value),
    offset: header.offset + header.value,
  };
}

describe('multisig actor parameter encoding', () => {
  it('encodes ConstructorParams as a four-field actor tuple', () => {
    const encoded = encodeConstructorParams({
      signers: [CALIBRATION_T1, CALIBRATION_T1_SECOND],
      threshold: 2,
      unlockDuration: 0,
      startEpoch: 0,
    });

    expect(encoded[0]).toBe(0x84);
    expect(encoded[1]).toBe(0x82);
    expect(encoded[encoded.length - 3]).toBe(0x02);
    expect(encoded[encoded.length - 2]).toBe(0x00);
    expect(encoded[encoded.length - 1]).toBe(0x00);
  });

  it('encodes InitActor ExecParams with a CID tag and constructor byte string', () => {
    const constructorParams = encodeConstructorParams({
      signers: [CALIBRATION_T1],
      threshold: 1,
    });
    const encoded = encodeInitExecParams({
      codeCid: 'bafk2bzacea2jc4smd2nyljptwgqenocwbdzqgwdscq2qg7w6mnjwljfcbvjj4',
      constructorParams,
    });

    expect(encoded[0]).toBe(0x82);
    expect(encoded[1]).toBe(0xd8);
    expect(encoded[2]).toBe(0x2a);

    const cidBytes = readByteString(encoded, 3);
    expect(cidBytes.value[0]).toBe(0);

    const constructorBytes = readByteString(encoded, cidBytes.offset);
    expect(bytesToHex(constructorBytes.value)).toBe(bytesToHex(constructorParams));
  });

  it('encodes ProposeParams with decoded InvokeEVM params bytes, not the base64 string or raw calldata', () => {
    const network = getNetworkConfig('calibration');
    const preparedBatch = prepareBatchExecution(
      [{ address: CALIBRATION_T1, amount: 1 }],
      'ATOMIC',
      network,
      'STANDARD',
    );
    const invokeParamsBytes = decodeInvokeEvmParamsBase64(preparedBatch.batch.data);
    const encoded = encodeProposeParams({
      to: toF4(preparedBatch.batch.to, 't'),
      valueAttoFil: preparedBatch.totalValueAttoFil,
      method: INVOKE_EVM_METHOD_NUMBER,
      params: invokeParamsBytes,
    });
    let offset = 1;
    offset = readByteString(encoded, offset).offset;
    offset = readByteString(encoded, offset).offset;
    offset = readHeader(encoded, offset).offset;
    const params = readByteString(encoded, offset).value;

    expect(bytesToHex(params)).toBe(bytesToHex(invokeParamsBytes));
    expect(bytesToHex(params)).not.toBe(preparedBatch.batch.data);
    expect(() => paramsBase64ToBytes(new TextDecoder().decode(params))).toThrow();
  });

  it('computes proposal hash from the actor ProposalHashData tuple', () => {
    const params = Uint8Array.from([0x44, 0x12, 0x34, 0xab, 0xcd]);
    const hashData = encodeProposalHashData({
      requesterIdAddress: PROPOSER_ID,
      to: toF4(getNetworkConfig('calibration').multicall3Address, 't'),
      valueAttoFil: 100n,
      method: INVOKE_EVM_METHOD_NUMBER,
      params,
    });
    const hash = computeProposalHash({
      requesterIdAddress: PROPOSER_ID,
      to: toF4(getNetworkConfig('calibration').multicall3Address, 't'),
      valueAttoFil: 100n,
      method: INVOKE_EVM_METHOD_NUMBER,
      params,
    });
    const txnParams = encodeTxnIDParams({ id: 7, proposalHash: hash });

    expect(hashData[0]).toBe(0x85);
    expect(hash).toHaveLength(32);
    expect(txnParams[0]).toBe(0x82);
    expect(txnParams[1]).toBe(0x07);
    expect(txnParams[2]).toBe(0x58);
    expect(txnParams[3]).toBe(0x20);
  });
});
