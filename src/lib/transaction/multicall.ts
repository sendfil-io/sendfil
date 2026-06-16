import { encodeFunctionData, parseAbi } from 'viem';
import {
  getAddressType,
  normalizeToEvmAddress,
  encodeFilecoinAddressToBytes,
  validateAddressForSending,
} from '../../utils/addressEncoder';
import { filDecimalToAttoFil } from '../../utils/filAmount';
import { getDefaultNetworkConfig } from '../networks';

export interface MulticallContractConfig {
  multicall3Address: `0x${string}`;
  filForwarderAddress: `0x${string}`;
}

// ABIs
const filForwarderAbi = parseAbi([
  'function forward(bytes filecoinAddress) external payable',
]);

// Multicall3 Call3Value struct
export interface Call3Value {
  target: `0x${string}`;
  allowFailure: boolean;
  value: bigint;
  callData: `0x${string}`;
}

// Multicall3 Result struct
export interface MulticallResult {
  success: boolean;
  returnData: `0x${string}`;
}

export interface BatchRecipient {
  address: string; // Can be 0x, f1, f2, f3, f4, t1, t2, t3, t4
  amount: bigint; // in attoFIL (wei)
}

export interface MulticallBatchResult {
  executionMethod: 'STANDARD';
  to: `0x${string}`; // Multicall3 address
  data: `0x${string}`; // Encoded aggregate3Value call
  value: bigint; // Total value (sum of all amounts)
  calls: Call3Value[]; // For debugging/logging
  recipientCount: number;
}

export type ErrorMode = 'ATOMIC' | 'PARTIAL';

export const STANDARD_PARTIAL_UNSAFE_MESSAGE =
  'Standard Partial execution is disabled because Multicall3 aggregate3Value does not refund value for failed allowed subcalls. Use Atomic with Standard, or use ThinBatch for Partial execution.';

/**
 * Build a single Call3Value for a recipient.
 */
function buildCall(
  recipient: BatchRecipient,
  allowFailure: boolean,
  contracts: MulticallContractConfig,
): Call3Value {
  const { address, amount } = recipient;

  // Validate the address
  validateAddressForSending(address);

  const addressType = getAddressType(address);

  if (addressType === 'evm') {
    // Direct EVM transfer (0x or f4/t4)
    const evmAddress = normalizeToEvmAddress(address);
    if (!evmAddress) {
      throw new Error(`Failed to normalize address: ${address}`);
    }

    return {
      target: evmAddress,
      allowFailure,
      value: amount,
      callData: '0x' as `0x${string}`, // Empty calldata = simple value transfer
    };
  }

  if (addressType === 'native') {
    // Native Filecoin address (f1/f2/f3) - route via FilForwarder
    const encodedAddress = encodeFilecoinAddressToBytes(address);

    return {
      target: contracts.filForwarderAddress,
      allowFailure,
      value: amount,
      callData: encodeFunctionData({
        abi: filForwarderAbi,
        functionName: 'forward',
        args: [encodedAddress],
      }),
    };
  }

  throw new Error(`Unsupported address type: ${address}`);
}

/**
 * Build a Multicall3 batch transaction for multiple recipients.
 *
 * @param recipients - Array of recipients with addresses and amounts (in attoFIL)
 * @param errorMode - 'ATOMIC' only. ThinBatch owns PARTIAL refund-safe execution.
 * @returns Transaction data ready to be sent via wagmi
 */
export function buildMulticallBatch(
  recipients: BatchRecipient[],
  errorMode: ErrorMode = 'ATOMIC',
  contracts: MulticallContractConfig = {
    multicall3Address: getDefaultNetworkConfig().multicall3Address,
    filForwarderAddress: getDefaultNetworkConfig().filForwarderAddress,
  },
): MulticallBatchResult {
  if (recipients.length === 0) {
    throw new Error('No recipients provided');
  }

  if (errorMode === 'PARTIAL') {
    throw new Error(STANDARD_PARTIAL_UNSAFE_MESSAGE);
  }

  // Validate all addresses first
  for (const recipient of recipients) {
    validateAddressForSending(recipient.address);
  }

  const allowFailure = false;

  // Build Call3Value array
  const calls: Call3Value[] = recipients.map((recipient) =>
    buildCall(recipient, allowFailure, contracts),
  );

  // Calculate total value
  const totalValue = recipients.reduce(
    (sum, recipient) => sum + recipient.amount,
    0n,
  );

  // Encode the aggregate3Value call
  // Note: viem doesn't have built-in support for structs in parseAbi,
  // so we need to encode manually using the tuple format
  const data = encodeFunctionData({
    abi: [
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
    ],
    functionName: 'aggregate3Value',
    args: [
      calls.map((call) => ({
        target: call.target,
        allowFailure: call.allowFailure,
        value: call.value,
        callData: call.callData,
      })),
    ],
  });

  return {
    executionMethod: 'STANDARD',
    to: contracts.multicall3Address,
    data,
    value: totalValue,
    calls,
    recipientCount: recipients.length,
  };
}

/**
 * Convert FIL amount to attoFIL (wei) as bigint.
 * 1 FIL = 10^18 attoFIL
 */
export function filToAttoFilBigInt(fil: string): bigint {
  return filDecimalToAttoFil(fil);
}

/**
 * Convert recipient array from App format to BatchRecipient format.
 */
export function convertRecipientsToBatch(
  recipients: Array<{ address: string; amount: string }>,
): BatchRecipient[] {
  return recipients.map((r) => ({
    address: r.address,
    amount: filToAttoFilBigInt(r.amount),
  }));
}
