import {
  CoinType,
  ethAddressFromID,
  newDelegatedAddress,
  newIDAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { encodeFunctionData } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFilecoinAddressToBytes } from '../../../utils/addressEncoder';
import { toF4 } from '../../../utils/toF4';
import { getNetworkConfig } from '../../networks';
import {
  encodeInvokeEvmParams,
  INVOKE_EVM_METHOD_NUMBER,
} from '../../transaction/nativeBatchMessage';
import { buildMulticallBatch } from '../../transaction/multicall';
import { buildThinBatch, thinBatchAbi } from '../../transaction/thinBatch';
import { paramsBase64ToBytes } from '../actorParams';
import {
  filForwarderVerifierAbi,
  multicall3Aggregate3ValueAbi,
  validateDecodedBatchFeePolicy,
  verifyPendingSendFilProposal,
} from '../proposalVerifier';

const network = getNetworkConfig('calibration');
const NATIVE_RECIPIENT = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();
const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678' as const;
const SECOND_EVM_RECIPIENT = '0x234567890abcdef1234567890abcdef123456789' as const;

function wrapInvokeEvm(calldata: `0x${string}`): Uint8Array {
  return paramsBase64ToBytes(encodeInvokeEvmParams(calldata));
}

function verify(
  to: string,
  valueAttoFil: bigint,
  calldata: `0x${string}`,
  method = INVOKE_EVM_METHOD_NUMBER,
) {
  return verifyPendingSendFilProposal({
    to,
    valueAttoFil,
    method,
    paramsBytes: wrapInvokeEvm(calldata),
    network,
  });
}

describe('pending SendFIL proposal verifier', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('decodes an exact Standard batch into display-safe payment details', () => {
    const batch = buildMulticallBatch(
      [
        { address: NATIVE_RECIPIENT, amount: 5n },
        { address: EVM_RECIPIENT, amount: 7n },
      ],
      'ATOMIC',
      {
        multicall3Address: network.multicall3Address,
        filForwarderAddress: network.filForwarderAddress,
      },
    );
    const result = verify(
      toF4(network.multicall3Address, network.nativePrefix),
      batch.value,
      batch.data,
    );

    expect(result.compatible).toBe(true);
    if (!result.compatible) return;

    expect(result.decodedBatch).toEqual({
      executionMethod: 'STANDARD',
      errorMode: 'ATOMIC',
      recipientCount: 2,
      totalValueAttoFil: '12',
      payments: [
        {
          index: 0,
          kind: 'FILECOIN',
          recipient: NATIVE_RECIPIENT,
          amountAttoFil: '5',
        },
        {
          index: 1,
          kind: 'EVM',
          recipient: '0x1234567890AbcdEF1234567890aBcdef12345678',
          amountAttoFil: '7',
        },
      ],
    });
  });

  it('decodes exact ThinBatch PARTIAL and ATOMIC payment shapes', () => {
    const partial = buildThinBatch(
      [
        { address: EVM_RECIPIENT, amount: 11n },
        { address: NATIVE_RECIPIENT, amount: 13n },
      ],
      'PARTIAL',
      { thinBatchAddress: network.thinBatchAddress! },
    );
    const atomic = buildThinBatch([{ address: EVM_RECIPIENT, amount: 17n }], 'ATOMIC', {
      thinBatchAddress: network.thinBatchAddress!,
    });

    const partialResult = verify(
      toF4(network.thinBatchAddress!, network.nativePrefix),
      partial.value,
      partial.data,
    );
    const atomicResult = verify(
      toF4(network.thinBatchAddress!, network.nativePrefix),
      atomic.value,
      atomic.data,
    );

    expect(partialResult.compatible && partialResult.decodedBatch.errorMode).toBe('PARTIAL');
    expect(atomicResult.compatible && atomicResult.decodedBatch.errorMode).toBe('ATOMIC');
  });

  it('rejects arbitrary selectors and arbitrary nested Multicall calls', () => {
    const arbitraryNested = encodeFunctionData({
      abi: multicall3Aggregate3ValueAbi,
      functionName: 'aggregate3Value',
      args: [
        [
          {
            target: EVM_RECIPIENT,
            allowFailure: false,
            value: 1n,
            callData: '0x1234',
          },
        ],
      ],
    });

    expect(verify(toF4(network.multicall3Address, 't'), 0n, '0x12345678').compatible).toBe(false);
    expect(verify(toF4(network.multicall3Address, 't'), 1n, arbitraryNested)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('FilForwarder'),
    });
  });

  it('rejects inconsistent value, partial Standard calls, and oversized batches', () => {
    const partialCall = encodeFunctionData({
      abi: multicall3Aggregate3ValueAbi,
      functionName: 'aggregate3Value',
      args: [
        [
          {
            target: EVM_RECIPIENT,
            allowFailure: true,
            value: 1n,
            callData: '0x',
          },
        ],
      ],
    });
    const oversized = encodeFunctionData({
      abi: multicall3Aggregate3ValueAbi,
      functionName: 'aggregate3Value',
      args: [
        Array.from({ length: 501 }, (_, index) => ({
          target: index % 2 === 0 ? EVM_RECIPIENT : SECOND_EVM_RECIPIENT,
          allowFailure: false,
          value: 1n,
          callData: '0x' as const,
        })),
      ],
    });
    const valid = buildMulticallBatch([{ address: EVM_RECIPIENT, amount: 1n }], 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });

    expect(verify(toF4(network.multicall3Address, 't'), 2n, valid.data)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('sum'),
    });
    expect(verify(toF4(network.multicall3Address, 't'), 1n, partialCall)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('allowFailure=false'),
    });
    expect(verify(toF4(network.multicall3Address, 't'), 501n, oversized)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('1-500'),
    });
  });

  it('rejects f0 targets encoded through FilForwarder or as masked-ID EVM addresses', () => {
    const idRecipient = newIDAddress(100, CoinType.TEST).toString();
    const forward = encodeFunctionData({
      abi: filForwarderVerifierAbi,
      functionName: 'forward',
      args: [encodeFilecoinAddressToBytes(idRecipient)],
    });
    const data = encodeFunctionData({
      abi: multicall3Aggregate3ValueAbi,
      functionName: 'aggregate3Value',
      args: [
        [
          {
            target: network.filForwarderAddress,
            allowFailure: false,
            value: 1n,
            callData: forward,
          },
        ],
      ],
    });

    expect(verify(toF4(network.multicall3Address, 't'), 1n, data)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('f0/t0'),
    });

    const maskedIdData = encodeFunctionData({
      abi: multicall3Aggregate3ValueAbi,
      functionName: 'aggregate3Value',
      args: [
        [
          {
            target: ethAddressFromID(idRecipient),
            allowFailure: false,
            value: 1n,
            callData: '0x',
          },
        ],
      ],
    });

    expect(verify(toF4(network.multicall3Address, 't'), 1n, maskedIdData)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('f0/t0'),
    });
  });

  it('rejects malformed ThinBatch tuples and unsupported error modes', () => {
    const malformedTuple = encodeFunctionData({
      abi: thinBatchAbi,
      functionName: 'payBatch',
      args: [
        [
          {
            kind: 0,
            evmRecipient: EVM_RECIPIENT,
            filecoinRecipient: '0x01',
            amount: 1n,
          },
        ],
        0,
      ],
    });
    const unsupportedMode = encodeFunctionData({
      abi: thinBatchAbi,
      functionName: 'payBatch',
      args: [
        [
          {
            kind: 0,
            evmRecipient: EVM_RECIPIENT,
            filecoinRecipient: '0x',
            amount: 1n,
          },
        ],
        2,
      ],
    });
    const target = toF4(network.thinBatchAddress!, 't');

    expect(verify(target, 1n, malformedTuple)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('tuple'),
    });
    expect(verify(target, 1n, unsupportedMode)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('error mode'),
    });
  });

  it('rejects unknown, f0, cross-network, and non-EVM delegated outer targets', () => {
    const batch = buildMulticallBatch([{ address: EVM_RECIPIENT, amount: 1n }], 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });
    const nonEvmDelegated = newDelegatedAddress(
      11,
      Uint8Array.from({ length: 20 }, (_, index) => index + 1),
      CoinType.TEST,
    ).toString();

    expect(verify(toF4(EVM_RECIPIENT, 't'), 1n, batch.data).compatible).toBe(false);
    expect(verify(newIDAddress(100, CoinType.TEST).toString(), 1n, batch.data)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('f0/t0'),
    });
    expect(verify(toF4(network.multicall3Address, 'f'), 1n, batch.data)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('different Filecoin network'),
    });
    expect(verify(nonEvmDelegated, 1n, batch.data)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('namespace-10'),
    });
  });

  it('rejects malformed CBOR wrapping and non-InvokeEVM methods', () => {
    const result = verifyPendingSendFilProposal({
      to: toF4(network.multicall3Address, 't'),
      valueAttoFil: 1n,
      method: INVOKE_EVM_METHOD_NUMBER,
      paramsBytes: Uint8Array.from([0x41, 0x00, 0x00]),
      network,
    });

    expect(result).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('truncated or trailing'),
    });
    expect(verify(toF4(network.multicall3Address, 't'), 1n, '0x12345678', 0)).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('InvokeEVM'),
    });
  });

  it('requires exact active fee recipients and values when fees are enabled', () => {
    const feeA = '0x1111111111111111111111111111111111111111';
    const feeB = '0x2222222222222222222222222222222222222222';
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', feeA);
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', feeB);
    vi.stubEnv('VITE_FEE_PERCENT_MAINNET', '1');
    vi.stubEnv('VITE_FEE_SPLIT_MAINNET', '0.5');
    const mainnet = getNetworkConfig('mainnet');
    const validBatch = {
      executionMethod: 'STANDARD' as const,
      errorMode: 'ATOMIC' as const,
      recipientCount: 3,
      totalValueAttoFil: '101000000000000000000',
      payments: [
        {
          index: 0,
          kind: 'EVM' as const,
          recipient: EVM_RECIPIENT,
          amountAttoFil: '100000000000000000000',
        },
        {
          index: 1,
          kind: 'EVM' as const,
          recipient: feeA,
          amountAttoFil: '500000000000000000',
        },
        {
          index: 2,
          kind: 'EVM' as const,
          recipient: feeB,
          amountAttoFil: '500000000000000000',
        },
      ],
    };

    expect(validateDecodedBatchFeePolicy(validBatch, mainnet)).toBeUndefined();
    expect(
      validateDecodedBatchFeePolicy(
        {
          ...validBatch,
          payments: validBatch.payments.map((payment, index) =>
            index === 2 ? { ...payment, amountAttoFil: '499999999999999999' } : payment,
          ),
        },
        mainnet,
      ),
    ).toContain('does not match');
    expect(
      validateDecodedBatchFeePolicy(
        {
          ...validBatch,
          recipientCount: 1,
          payments: validBatch.payments.slice(0, 1),
        },
        mainnet,
      ),
    ).toContain('does not match');

    const smallBatch = {
      ...validBatch,
      totalValueAttoFil: '606000000000000',
      payments: [
        { ...validBatch.payments[0]!, amountAttoFil: '600000000000000' },
        { ...validBatch.payments[1]!, amountAttoFil: '3000000000000' },
        { ...validBatch.payments[2]!, amountAttoFil: '3000000000000' },
      ],
    };
    expect(validateDecodedBatchFeePolicy(smallBatch, mainnet)).toBeUndefined();
    expect(
      validateDecodedBatchFeePolicy(
        {
          ...smallBatch,
          payments: smallBatch.payments.map((payment, index) =>
            index > 0 ? { ...payment, amountAttoFil: '2000000000000' } : payment,
          ),
        },
        mainnet,
      ),
    ).toContain('does not match');

    expect(
      validateDecodedBatchFeePolicy(
        {
          ...validBatch,
          recipientCount: 1,
          totalValueAttoFil: '100000000000000',
          payments: [{ ...validBatch.payments[0]!, amountAttoFil: '100000000000000' }],
        },
        mainnet,
      ),
    ).toBeUndefined();
  });

  it('accepts 500 Standard user payments plus two enabled fee payments', () => {
    const feeA = '0x1111111111111111111111111111111111111111';
    const feeB = '0x2222222222222222222222222222222222222222';
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', feeA);
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', feeB);
    const mainnet = getNetworkConfig('mainnet');
    const recipients = [
      ...Array.from({ length: 500 }, () => ({ address: EVM_RECIPIENT, amount: 10n ** 18n })),
      { address: feeA, amount: 25n * 10n ** 17n },
      { address: feeB, amount: 25n * 10n ** 17n },
    ];
    const batch = buildMulticallBatch(recipients, 'ATOMIC', {
      multicall3Address: mainnet.multicall3Address,
      filForwarderAddress: mainnet.filForwarderAddress,
    });
    const result = verifyPendingSendFilProposal({
      to: toF4(mainnet.multicall3Address, 'f'),
      valueAttoFil: batch.value,
      method: INVOKE_EVM_METHOD_NUMBER,
      paramsBytes: wrapInvokeEvm(batch.data),
      network: mainnet,
    });

    expect(result.compatible).toBe(true);
    expect(result.compatible && result.decodedBatch.recipientCount).toBe(502);
  });
});
