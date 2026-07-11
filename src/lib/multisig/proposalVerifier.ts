import {
  Address,
  Protocol,
  ethAddressFromDelegated,
  isEthIdMaskAddress,
  newFromString,
} from '@glif/filecoin-address';
import { decodeFunctionData, encodeFunctionData, getAddress, hexToBytes, zeroAddress } from 'viem';
import type { SendFilNetworkConfig } from '../networks';
import { calculateFeePaymentsAttoFil } from '../../utils/fee';
import { normalizeToEvmAddress } from '../../utils/addressEncoder';
import { INVOKE_EVM_METHOD_NUMBER } from '../transaction/nativeBatchMessage';
import { buildMulticallBatch, type BatchRecipient } from '../transaction/multicall';
import { buildThinBatch, thinBatchAbi, THINBATCH_MAX_PAYMENTS } from '../transaction/thinBatch';
import type { DecodedMultisigProposalBatch, DecodedMultisigProposalPayment } from './types';

export const multicall3Aggregate3ValueAbi = [
  {
    name: 'aggregate3Value',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

export const filForwarderVerifierAbi = [
  {
    name: 'forward',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'filecoinAddress', type: 'bytes' }],
    outputs: [],
  },
] as const;

export interface VerifyPendingProposalInput {
  to: string;
  valueAttoFil: bigint;
  method: number;
  paramsBytes: Uint8Array;
  network: SendFilNetworkConfig;
}

export type PendingProposalVerification =
  | {
      compatible: true;
      decodedBatch: DecodedMultisigProposalBatch;
    }
  | {
      compatible: false;
      reason: string;
    };

interface DecodedPaymentWithAmount extends DecodedMultisigProposalPayment {
  amount: bigint;
}

function incompatible(reason: string): PendingProposalVerification {
  return { compatible: false, reason };
}

function sameHex(left: `0x${string}`, right: `0x${string}`): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameEvmAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function readCanonicalByteStringLength(bytes: Uint8Array): {
  length: number;
  dataOffset: number;
} {
  const first = bytes[0];

  if (first === undefined || first >> 5 !== 2) {
    throw new Error('InvokeEVM params must be a CBOR byte string.');
  }

  const additional = first & 0x1f;

  if (additional < 24) {
    return { length: additional, dataOffset: 1 };
  }

  const byteLength = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 0;

  if (byteLength === 0 || bytes.length < byteLength + 1) {
    throw new Error('InvokeEVM params use an unsupported CBOR byte-string header.');
  }

  let length = 0;
  for (let index = 0; index < byteLength; index += 1) {
    length = length * 256 + bytes[index + 1]!;
  }

  const minimum = byteLength === 1 ? 24 : byteLength === 2 ? 256 : 65_536;
  if (length < minimum) {
    throw new Error('InvokeEVM params are not canonically CBOR encoded.');
  }

  return { length, dataOffset: byteLength + 1 };
}

export function decodeInvokeEvmCalldata(paramsBytes: Uint8Array): `0x${string}` {
  const { length, dataOffset } = readCanonicalByteStringLength(paramsBytes);

  if (dataOffset + length !== paramsBytes.length) {
    throw new Error('InvokeEVM params contain truncated or trailing bytes.');
  }

  const calldata = paramsBytes.slice(dataOffset);
  return `0x${Array.from(calldata, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function normalizeOuterTarget(target: string, network: SendFilNetworkConfig): `0x${string}` {
  const trimmed = target.trim();

  if (trimmed.startsWith('0x')) {
    return getAddress(trimmed);
  }

  const parsed = newFromString(trimmed);

  if (parsed.protocol() === Protocol.ID) {
    throw new Error('f0/t0 ID targets are not supported.');
  }

  if (parsed.protocol() !== Protocol.DELEGATED) {
    throw new Error('The proposal target is not an EVM delegated address.');
  }

  if (parsed.coinType() !== network.coinType) {
    throw new Error('The proposal target belongs to a different Filecoin network.');
  }

  if (parsed.namespace !== 10) {
    throw new Error('Only namespace-10 EVM delegated targets are supported.');
  }

  return getAddress(ethAddressFromDelegated(trimmed));
}

function decodeNativeRecipient(
  encodedAddress: `0x${string}`,
  network: SendFilNetworkConfig,
): string {
  const address = new Address(hexToBytes(encodedAddress), network.coinType);
  const protocol = address.protocol();

  if (protocol === Protocol.ID) {
    throw new Error('f0/t0 ID recipients are not supported.');
  }

  if (protocol !== Protocol.SECP256K1 && protocol !== Protocol.ACTOR && protocol !== Protocol.BLS) {
    throw new Error('Only native f1/f2/f3 or t1/t2/t3 recipients are supported.');
  }

  const recipient = address.toString();
  const roundTrip = newFromString(recipient).bytes;

  if (
    roundTrip.length !== address.bytes.length ||
    roundTrip.some((byte, index) => byte !== address.bytes[index])
  ) {
    throw new Error('Filecoin recipient bytes are not canonically encoded.');
  }

  return recipient;
}

function getKnownContractAddresses(network: SendFilNetworkConfig): string[] {
  return [network.multicall3Address, network.filForwarderAddress, network.thinBatchAddress]
    .filter((address): address is `0x${string}` => Boolean(address))
    .map((address) => address.toLowerCase());
}

function assertDirectEvmRecipientAllowed(
  recipient: `0x${string}`,
  network: SendFilNetworkConfig,
): void {
  if (isEthIdMaskAddress(recipient)) {
    throw new Error('f0/t0 ID recipients are not supported.');
  }

  if (getKnownContractAddresses(network).includes(recipient.toLowerCase())) {
    throw new Error('Direct payments to SendFIL contract addresses are not supported.');
  }
}

function buildDecodedBatch(
  executionMethod: 'STANDARD' | 'THINBATCH',
  errorMode: 'ATOMIC' | 'PARTIAL',
  valueAttoFil: bigint,
  payments: DecodedPaymentWithAmount[],
): DecodedMultisigProposalBatch {
  return {
    executionMethod,
    errorMode,
    recipientCount: payments.length,
    totalValueAttoFil: valueAttoFil.toString(),
    payments: payments.map(({ index, kind, recipient, amountAttoFil }) => ({
      index,
      kind,
      recipient,
      amountAttoFil,
    })),
  };
}

function recipientIdentity(address: string): string {
  return normalizeToEvmAddress(address)?.toLowerCase() ?? address;
}

export function validateDecodedBatchFeePolicy(
  batch: DecodedMultisigProposalBatch,
  network: SendFilNetworkConfig,
): string | undefined {
  if (!network.feePolicy.enabled) {
    return undefined;
  }

  try {
    for (let feePaymentCount = 0; feePaymentCount <= 2; feePaymentCount += 1) {
      const userPaymentCount = batch.payments.length - feePaymentCount;

      if (userPaymentCount < 1) {
        continue;
      }

      const userPayments = batch.payments.slice(0, userPaymentCount);
      const feeRecipientIdentities = new Set(
        [network.feePolicy.recipientA, network.feePolicy.recipientB]
          .filter((address): address is string => Boolean(address))
          .map(recipientIdentity),
      );

      if (
        userPayments.some((payment) =>
          feeRecipientIdentities.has(recipientIdentity(payment.recipient)),
        )
      ) {
        continue;
      }

      const userTotalAttoFil = userPayments.reduce(
        (sum, payment) => sum + BigInt(payment.amountAttoFil),
        0n,
      );
      const expectedFeePayments = calculateFeePaymentsAttoFil(userTotalAttoFil, network);

      if (expectedFeePayments.length !== feePaymentCount) {
        continue;
      }

      const actualFeePayments = batch.payments.slice(userPaymentCount);
      const matches = expectedFeePayments.every((expected, index) => {
        const actual = actualFeePayments[index];

        return Boolean(
          actual &&
          recipientIdentity(expected.address) === recipientIdentity(actual.recipient) &&
          expected.amountAttoFil === BigInt(actual.amountAttoFil),
        );
      });

      if (matches) {
        return undefined;
      }
    }
  } catch (error) {
    return error instanceof Error
      ? `The proposal fee policy could not be verified: ${error.message}`
      : 'The proposal fee policy could not be verified.';
  }

  return 'The proposal does not match the active SendFIL fee policy.';
}

function verifyStandardBatch(
  calldata: `0x${string}`,
  valueAttoFil: bigint,
  network: SendFilNetworkConfig,
): PendingProposalVerification {
  let decoded: ReturnType<typeof decodeFunctionData<typeof multicall3Aggregate3ValueAbi>>;

  try {
    decoded = decodeFunctionData({
      abi: multicall3Aggregate3ValueAbi,
      data: calldata,
    });
  } catch {
    return incompatible('Standard proposal calldata is not aggregate3Value.');
  }

  if (decoded.functionName !== 'aggregate3Value' || !decoded.args) {
    return incompatible('Standard proposal calldata is not aggregate3Value.');
  }

  const [calls] = decoded.args;
  const maxStandardPayments = THINBATCH_MAX_PAYMENTS + (network.feePolicy.enabled ? 2 : 0);
  if (calls.length === 0 || calls.length > maxStandardPayments) {
    return incompatible(`SendFIL proposals must contain 1-${maxStandardPayments} payments.`);
  }

  const payments: DecodedPaymentWithAmount[] = [];
  const batchRecipients: BatchRecipient[] = [];

  try {
    for (const [index, call] of calls.entries()) {
      if (call.allowFailure) {
        throw new Error('Standard proposals must use Atomic allowFailure=false calls.');
      }

      if (call.value <= 0n) {
        throw new Error('Every SendFIL payment amount must be greater than zero.');
      }

      if (call.callData === '0x') {
        const recipient = getAddress(call.target);
        assertDirectEvmRecipientAllowed(recipient, network);
        payments.push({
          index,
          kind: 'EVM',
          recipient,
          amountAttoFil: call.value.toString(),
          amount: call.value,
        });
        batchRecipients.push({ address: recipient, amount: call.value });
        continue;
      }

      if (!sameEvmAddress(call.target, network.filForwarderAddress)) {
        throw new Error('Standard proposals may only call FilForwarder for native recipients.');
      }

      const forward = decodeFunctionData({
        abi: filForwarderVerifierAbi,
        data: call.callData,
      });

      if (forward.functionName !== 'forward' || !forward.args) {
        throw new Error('FilForwarder calldata is malformed.');
      }

      const [encodedAddress] = forward.args;
      const canonicalForward = encodeFunctionData({
        abi: filForwarderVerifierAbi,
        functionName: 'forward',
        args: [encodedAddress],
      });

      if (!sameHex(canonicalForward, call.callData)) {
        throw new Error('FilForwarder calldata is not canonically encoded.');
      }

      const recipient = decodeNativeRecipient(encodedAddress, network);
      payments.push({
        index,
        kind: 'FILECOIN',
        recipient,
        amountAttoFil: call.value.toString(),
        amount: call.value,
      });
      batchRecipients.push({ address: recipient, amount: call.value });
    }
  } catch (error) {
    return incompatible(error instanceof Error ? error.message : 'Standard proposal is malformed.');
  }

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0n);
  if (total !== valueAttoFil) {
    return incompatible('Proposal value does not equal the sum of Standard payments.');
  }

  let canonical: ReturnType<typeof buildMulticallBatch>;

  try {
    canonical = buildMulticallBatch(batchRecipients, 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });
  } catch {
    return incompatible('Standard proposal cannot be reconstructed safely.');
  }

  if (!sameHex(canonical.data, calldata)) {
    return incompatible('Standard proposal does not match SendFIL canonical calldata.');
  }

  return {
    compatible: true,
    decodedBatch: buildDecodedBatch('STANDARD', 'ATOMIC', valueAttoFil, payments),
  };
}

function verifyThinBatch(
  calldata: `0x${string}`,
  valueAttoFil: bigint,
  network: SendFilNetworkConfig,
): PendingProposalVerification {
  let decoded: ReturnType<typeof decodeFunctionData<typeof thinBatchAbi>>;

  try {
    decoded = decodeFunctionData({ abi: thinBatchAbi, data: calldata });
  } catch {
    return incompatible('ThinBatch proposal calldata is not payBatch.');
  }

  if (decoded.functionName !== 'payBatch' || !decoded.args) {
    return incompatible('ThinBatch proposal calldata is not payBatch.');
  }

  const [rawPayments, rawErrorMode] = decoded.args;
  if (rawPayments.length === 0 || rawPayments.length > THINBATCH_MAX_PAYMENTS) {
    return incompatible(`SendFIL proposals must contain 1-${THINBATCH_MAX_PAYMENTS} payments.`);
  }

  if (rawErrorMode !== 0 && rawErrorMode !== 1) {
    return incompatible('ThinBatch error mode must be PARTIAL or ATOMIC.');
  }

  const errorMode = rawErrorMode === 0 ? 'PARTIAL' : 'ATOMIC';
  const payments: DecodedPaymentWithAmount[] = [];
  const batchRecipients: BatchRecipient[] = [];

  try {
    for (const [index, payment] of rawPayments.entries()) {
      if (payment.amount <= 0n) {
        throw new Error('Every SendFIL payment amount must be greater than zero.');
      }

      if (payment.kind === 0) {
        if (
          payment.filecoinRecipient !== '0x' ||
          sameEvmAddress(payment.evmRecipient, zeroAddress)
        ) {
          throw new Error('ThinBatch EVM payment tuple is malformed.');
        }

        const recipient = getAddress(payment.evmRecipient);
        assertDirectEvmRecipientAllowed(recipient, network);
        payments.push({
          index,
          kind: 'EVM',
          recipient,
          amountAttoFil: payment.amount.toString(),
          amount: payment.amount,
        });
        batchRecipients.push({ address: recipient, amount: payment.amount });
        continue;
      }

      if (payment.kind !== 1 || !sameEvmAddress(payment.evmRecipient, zeroAddress)) {
        throw new Error('ThinBatch Filecoin payment tuple is malformed.');
      }

      const recipient = decodeNativeRecipient(payment.filecoinRecipient, network);
      payments.push({
        index,
        kind: 'FILECOIN',
        recipient,
        amountAttoFil: payment.amount.toString(),
        amount: payment.amount,
      });
      batchRecipients.push({ address: recipient, amount: payment.amount });
    }
  } catch (error) {
    return incompatible(
      error instanceof Error ? error.message : 'ThinBatch proposal is malformed.',
    );
  }

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0n);
  if (total !== valueAttoFil) {
    return incompatible('Proposal value does not equal the sum of ThinBatch payments.');
  }

  let canonical: ReturnType<typeof buildThinBatch>;

  try {
    canonical = buildThinBatch(batchRecipients, errorMode, {
      thinBatchAddress: network.thinBatchAddress!,
    });
  } catch {
    return incompatible('ThinBatch proposal cannot be reconstructed safely.');
  }

  if (!sameHex(canonical.data, calldata)) {
    return incompatible('ThinBatch proposal does not match SendFIL canonical calldata.');
  }

  return {
    compatible: true,
    decodedBatch: buildDecodedBatch('THINBATCH', errorMode, valueAttoFil, payments),
  };
}

export function verifyPendingSendFilProposal({
  to,
  valueAttoFil,
  method,
  paramsBytes,
  network,
}: VerifyPendingProposalInput): PendingProposalVerification {
  if (method !== INVOKE_EVM_METHOD_NUMBER) {
    return incompatible('Proposal method is not InvokeEVM.');
  }

  if (valueAttoFil < 0n) {
    return incompatible('Proposal value cannot be negative.');
  }

  let target: `0x${string}`;
  let calldata: `0x${string}`;

  try {
    target = normalizeOuterTarget(to, network);
    calldata = decodeInvokeEvmCalldata(paramsBytes);
  } catch (error) {
    return incompatible(
      error instanceof Error ? error.message : 'Proposal target or params are malformed.',
    );
  }

  if (sameEvmAddress(target, network.multicall3Address)) {
    return verifyStandardBatch(calldata, valueAttoFil, network);
  }

  if (network.thinBatchAddress && sameEvmAddress(target, network.thinBatchAddress)) {
    return verifyThinBatch(calldata, valueAttoFil, network);
  }

  return incompatible("Proposal does not target this network's SendFIL contracts.");
}
