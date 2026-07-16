import {
  CoinType,
  newActorAddress,
  newIDAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it } from 'vitest';
import { getNetworkConfig } from '../../networks';
import { prepareBatchExecution } from '../../transaction/batchExecution';
import { INVOKE_EVM_METHOD_NUMBER } from '../../transaction/nativeBatchMessage';
import { toF4 } from '../../../utils/toF4';
import {
  bytesToHex,
  bytesToParamsBase64,
  computeProposalHash,
  decodeApproveReturn,
  decodeCancelReturn,
  decodeExecReturn,
  decodeInvokeEvmParamsBase64,
  decodeProposeReturn,
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
const CALIBRATION_MULTICALL_F4 = 't410fzii33yczo6zwgelhakegfprkc44xnsqrqvzgngq';

// Golden actor-result fixtures are literal DAG-CBOR tuples, independent from the
// encoders in actorParams.ts.
const PROPOSE_QUEUED_RETURN = 'hAf0AEA='; // 84 07 f4 00 40
const PROPOSE_APPLIED_SUCCESS_RETURN = 'hAn1AELerQ=='; // 84 09 f5 00 42 de ad
const PROPOSE_APPLIED_FAILURE_RETURN = 'hAr1GCFCAQI='; // 84 0a f5 18 21 42 01 02
const APPROVE_QUEUED_RETURN = 'g/QAQA=='; // 83 f4 00 40
const APPROVE_APPLIED_SUCCESS_RETURN = 'g/UAQsr+'; // 83 f5 00 42 ca fe
const APPROVE_APPLIED_FAILURE_RETURN = 'g/UYIUA='; // 83 f5 18 21 40

function encodeTestByteString(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from([
    bytes.length < 24 ? 0x40 + bytes.length : 0x58,
    ...(bytes.length < 24 ? [] : [bytes.length]),
    ...bytes,
  ]);
}

function encodeTestExecReturn(idBytes: Uint8Array, robustBytes: Uint8Array): string {
  return bytesToParamsBase64(
    Uint8Array.from([0x82, ...encodeTestByteString(idBytes), ...encodeTestByteString(robustBytes)]),
  );
}

function readHeader(
  bytes: Uint8Array,
  offset: number,
): {
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

  const byteLength = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 8;
  let value = 0;

  for (let index = 0; index < byteLength; index += 1) {
    value = (value << 8) | bytes[nextOffset + index]!;
  }

  nextOffset += byteLength;
  return { major, value, offset: nextOffset };
}

function readByteString(
  bytes: Uint8Array,
  offset: number,
): {
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

    expect(bytesToHex(encoded)).toBe(
      '0x84825501b9fe2a7932fd627be0308090733fb958760000475501ab774520f82297c2402675efed163d0dd561010f020000',
    );
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

    expect(bytesToHex(encoded)).toBe(
      '0x82d82a5827000155a0e402203491724c1e9b85a5f3b1a046b85608f30358721435037ede635365a4a20d529e581b84815501b9fe2a7932fd627be0308090733fb95876000047010000',
    );
  });

  it('encodes ProposeParams byte-for-byte as the actor tuple', () => {
    const encoded = encodeProposeParams({
      to: CALIBRATION_MULTICALL_F4,
      valueAttoFil: 100n,
      method: INVOKE_EVM_METHOD_NUMBER,
      params: Uint8Array.from([0x44, 0x12, 0x34, 0xab, 0xcd]),
    });

    expect(bytesToHex(encoded)).toBe(
      '0x8456040aca11bde05977b3631167028862be2a173976ca114200641ae525aa1545441234abcd',
    );
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
      to: CALIBRATION_MULTICALL_F4,
      valueAttoFil: 100n,
      method: INVOKE_EVM_METHOD_NUMBER,
      params,
    });
    const hash = computeProposalHash({
      requesterIdAddress: PROPOSER_ID,
      to: CALIBRATION_MULTICALL_F4,
      valueAttoFil: 100n,
      method: INVOKE_EVM_METHOD_NUMBER,
      params,
    });
    const txnParams = encodeTxnIDParams({ id: 7, proposalHash: hash });

    expect(bytesToHex(hashData)).toBe(
      '0x854300e90756040aca11bde05977b3631167028862be2a173976ca114200641ae525aa1545441234abcd',
    );
    expect(bytesToHex(hash)).toBe(
      '0x5e827801a16f0c4624563977dfcb2341f2e30041f779b04764d7fcb7fd09bc29',
    );
    expect(bytesToHex(txnParams)).toBe(
      '0x820758205e827801a16f0c4624563977dfcb2341f2e30041f779b04764d7fcb7fd09bc29',
    );
  });
});

describe('multisig actor return decoding', () => {
  it('decodes independent ProposeReturn golden vectors for queued, success, and inner failure', () => {
    expect(decodeProposeReturn(PROPOSE_QUEUED_RETURN)).toEqual({
      txnId: 7,
      applied: false,
      code: 0,
      ret: new Uint8Array(),
    });
    expect(decodeProposeReturn(PROPOSE_APPLIED_SUCCESS_RETURN)).toEqual({
      txnId: 9,
      applied: true,
      code: 0,
      ret: Uint8Array.from([0xde, 0xad]),
    });
    expect(decodeProposeReturn(PROPOSE_APPLIED_FAILURE_RETURN)).toEqual({
      txnId: 10,
      applied: true,
      code: 33,
      ret: Uint8Array.from([0x01, 0x02]),
    });
  });

  it('decodes independent ApproveReturn golden vectors', () => {
    expect(decodeApproveReturn(APPROVE_QUEUED_RETURN)).toEqual({
      applied: false,
      code: 0,
      ret: new Uint8Array(),
    });
    expect(decodeApproveReturn(APPROVE_APPLIED_SUCCESS_RETURN)).toEqual({
      applied: true,
      code: 0,
      ret: Uint8Array.from([0xca, 0xfe]),
    });
    expect(decodeApproveReturn(APPROVE_APPLIED_FAILURE_RETURN)).toEqual({
      applied: true,
      code: 33,
      ret: new Uint8Array(),
    });
  });

  it('accepts only the actor-defined empty CancelReturn', () => {
    expect(decodeCancelReturn('')).toBeUndefined();
    expect(() => decodeCancelReturn('AA==')).toThrow('CancelReturn must be empty');
  });

  it('requires ExecReturn to contain an ID address followed by an actor address', () => {
    const id = newIDAddress(1001, CoinType.TEST);
    const actor = newActorAddress(
      Uint8Array.from({ length: 20 }, (_, index) => index + 1),
      CoinType.TEST,
    );
    const signer = newSecp256k1Address(
      Uint8Array.from({ length: 33 }, (_, index) => index + 1),
      CoinType.TEST,
    );

    expect(decodeExecReturn(encodeTestExecReturn(id.bytes, actor.bytes), 'calibration')).toEqual({
      idAddress: id.toString(),
      robustAddress: actor.toString(),
    });
    expect(() =>
      decodeExecReturn(encodeTestExecReturn(actor.bytes, actor.bytes), 'calibration'),
    ).toThrow('ID address');
    expect(() =>
      decodeExecReturn(encodeTestExecReturn(id.bytes, signer.bytes), 'calibration'),
    ).toThrow('actor address');
  });

  it.each([
    ['', 'ProposeReturn is empty'],
    ['gwf0AA==', 'Expected CBOR array with 4 fields'],
    ['hAcAAEA=', 'Expected ProposeReturn applied flag'],
    ['hCD0AEA=', 'transaction ID must be a nonnegative safe integer'],
    ['hAf1IEA=', 'exit code must be an unsigned 32-bit integer'],
    ['hAf0AEAA', 'ProposeReturn has trailing CBOR data'],
    ['hAf0AEA', 'ProposeReturn is not canonical base64'],
  ])('rejects malformed ProposeReturn fixture %s', (fixture, message) => {
    expect(() => decodeProposeReturn(fixture)).toThrow(message);
  });

  it.each([
    ['', 'ApproveReturn is empty'],
    ['gfQ=', 'Expected CBOR array with 3 fields'],
    ['gwAAQA==', 'Expected ApproveReturn applied flag'],
    ['g/UYIQA=', 'Expected CBOR byte string'],
    ['g/UAQAA=', 'ApproveReturn has trailing CBOR data'],
  ])('rejects malformed ApproveReturn fixture %s', (fixture, message) => {
    expect(() => decodeApproveReturn(fixture)).toThrow(message);
  });
});
