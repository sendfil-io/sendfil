import { encodeFunctionData } from 'viem';
import {
  encodeFilecoinAddressToBytes,
  getAddressType,
  normalizeToEvmAddress,
  validateAddressForSending,
} from '../../utils/addressEncoder';
import type { BatchRecipient, ErrorMode } from './multicall';

export interface ThinBatchContractConfig {
  thinBatchAddress: `0x${string}`;
}

export const THINBATCH_PAYMENT_KIND = {
  EVM: 0,
  FILECOIN: 1,
} as const;

export const THINBATCH_ERROR_MODE = {
  PARTIAL: 0,
  ATOMIC: 1,
} as const satisfies Record<ErrorMode, 0 | 1>;

export const THINBATCH_MAX_PAYMENTS = 500;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export interface ThinBatchPayment {
  kind: (typeof THINBATCH_PAYMENT_KIND)[keyof typeof THINBATCH_PAYMENT_KIND];
  evmRecipient: `0x${string}`;
  filecoinRecipient: `0x${string}`;
  amount: bigint;
}

export interface ThinBatchBatchResult {
  executionMethod: 'THINBATCH';
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  payments: ThinBatchPayment[];
  recipientCount: number;
}

export const thinBatchAbi = [
  {
    name: 'payBatch',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'payments',
        type: 'tuple[]',
        components: [
          { name: 'kind', type: 'uint8' },
          { name: 'evmRecipient', type: 'address' },
          { name: 'filecoinRecipient', type: 'bytes' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'errorMode', type: 'uint8' },
    ],
    outputs: [
      { name: 'totalPaid', type: 'uint256' },
      { name: 'totalFailed', type: 'uint256' },
      { name: 'refundAmount', type: 'uint256' },
    ],
  },
] as const;

function buildThinBatchPayment(recipient: BatchRecipient): ThinBatchPayment {
  const { address, amount } = recipient;

  if (amount <= 0n) {
    throw new Error('ThinBatch payment amount must be greater than 0');
  }

  validateAddressForSending(address);

  const addressType = getAddressType(address);

  if (addressType === 'evm') {
    const evmRecipient = normalizeToEvmAddress(address);

    if (!evmRecipient) {
      throw new Error(`Failed to normalize address: ${address}`);
    }

    return {
      kind: THINBATCH_PAYMENT_KIND.EVM,
      evmRecipient,
      filecoinRecipient: '0x',
      amount,
    };
  }

  if (addressType === 'native') {
    return {
      kind: THINBATCH_PAYMENT_KIND.FILECOIN,
      evmRecipient: ZERO_ADDRESS,
      filecoinRecipient: encodeFilecoinAddressToBytes(address),
      amount,
    };
  }

  throw new Error(`Unsupported address type: ${address}`);
}

export function buildThinBatch(
  recipients: BatchRecipient[],
  errorMode: ErrorMode = 'PARTIAL',
  contracts: ThinBatchContractConfig,
): ThinBatchBatchResult {
  if (recipients.length === 0) {
    throw new Error('No recipients provided');
  }

  if (recipients.length > THINBATCH_MAX_PAYMENTS) {
    throw new Error(`ThinBatch supports at most ${THINBATCH_MAX_PAYMENTS} payments`);
  }

  const payments = recipients.map(buildThinBatchPayment);
  const totalValue = recipients.reduce(
    (sum, recipient) => sum + recipient.amount,
    0n,
  );

  const data = encodeFunctionData({
    abi: thinBatchAbi,
    functionName: 'payBatch',
    args: [
      payments.map((payment) => ({
        kind: payment.kind,
        evmRecipient: payment.evmRecipient,
        filecoinRecipient: payment.filecoinRecipient,
        amount: payment.amount,
      })),
      THINBATCH_ERROR_MODE[errorMode],
    ],
  });

  return {
    executionMethod: 'THINBATCH',
    to: contracts.thinBatchAddress,
    data,
    value: totalValue,
    payments,
    recipientCount: recipients.length,
  };
}
