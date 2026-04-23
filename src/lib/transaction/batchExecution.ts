import {
  buildMulticallBatch,
  convertRecipientsToBatch,
  type ErrorMode,
  type MulticallBatchResult,
} from './multicall';

export interface BatchExecutionRecipient {
  address: string;
  amount: number;
}

export interface PreparedBatchExecution {
  batch: MulticallBatchResult;
  errorMode: ErrorMode;
  recipients: BatchExecutionRecipient[];
  recipientCount: number;
  totalValueAttoFil: bigint;
}

export interface BatchGasEstimate {
  gasLimit: bigint;
  gasFeeCap: bigint;
  gasPremium: bigint;
  estimatedFee: bigint;
}

export interface BatchExecutionSubmission {
  txHash: `0x${string}`;
  confirmation?: Promise<void>;
}

export interface BatchExecutionAdapter {
  estimate: (prepared: PreparedBatchExecution) => Promise<BatchGasEstimate>;
  execute: (prepared: PreparedBatchExecution) => Promise<BatchExecutionSubmission>;
}

export function prepareBatchExecution(
  recipients: BatchExecutionRecipient[],
  errorMode: ErrorMode,
): PreparedBatchExecution {
  if (recipients.length === 0) {
    throw new Error('No recipients provided');
  }

  const batchRecipients = convertRecipientsToBatch(recipients);
  const batch = buildMulticallBatch(batchRecipients, errorMode);

  return {
    batch,
    errorMode,
    recipients,
    recipientCount: recipients.length,
    totalValueAttoFil: batch.value,
  };
}

export function applyGasBuffer(gasEstimate: bigint): bigint {
  return (gasEstimate * 110n) / 100n;
}

export function buildBatchGasEstimate(
  gasLimit: bigint,
  gasPrice: bigint,
): BatchGasEstimate {
  return {
    gasLimit,
    gasFeeCap: gasPrice,
    gasPremium: gasPrice,
    estimatedFee: gasLimit * gasPrice,
  };
}

export function attoFilBigIntToFil(value: bigint): number {
  return Number(value) / 1e18;
}
