import {
  buildMulticallBatch,
  convertRecipientsToBatch,
  type MulticallContractConfig,
  type ErrorMode,
  type MulticallBatchResult,
} from './multicall';
import {
  buildThinBatch,
  type ThinBatchBatchResult,
} from './thinBatch';
import type { ExecutionMethod } from '../batchConfiguration';
import { type SendFilNetworkConfig } from '../networks';

export interface BatchExecutionRecipient {
  address: string;
  amount: string;
}

export type PreparedBatchTransaction = MulticallBatchResult | ThinBatchBatchResult;

type BatchExecutionNetwork = Pick<
  SendFilNetworkConfig,
  | 'key'
  | 'chainId'
  | 'chainName'
  | 'multicall3Address'
  | 'filForwarderAddress'
  | 'thinBatchAddress'
>;

export interface PreparedBatchExecution<
  TBatch extends PreparedBatchTransaction = PreparedBatchTransaction,
> {
  batch: TBatch;
  executionMethod: ExecutionMethod;
  errorMode: ErrorMode;
  recipients: BatchExecutionRecipient[];
  recipientCount: number;
  totalValueAttoFil: bigint;
  networkKey: SendFilNetworkConfig['key'];
  chainId: SendFilNetworkConfig['chainId'];
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

type PreparedBatchForExecutionMethod<TExecutionMethod extends ExecutionMethod> =
  TExecutionMethod extends 'THINBATCH'
    ? PreparedBatchExecution<ThinBatchBatchResult>
    : PreparedBatchExecution<MulticallBatchResult>;

export function prepareBatchExecution<
  TExecutionMethod extends ExecutionMethod = 'STANDARD',
>(
  recipients: BatchExecutionRecipient[],
  errorMode: ErrorMode,
  network: BatchExecutionNetwork,
  executionMethod?: TExecutionMethod,
): PreparedBatchForExecutionMethod<TExecutionMethod> {
  if (recipients.length === 0) {
    throw new Error('No recipients provided');
  }

  const selectedExecutionMethod = (executionMethod ?? 'STANDARD') as TExecutionMethod;
  const batchRecipients = convertRecipientsToBatch(recipients);
  const batch =
    selectedExecutionMethod === 'THINBATCH'
      ? prepareThinBatch(batchRecipients, errorMode, network)
      : prepareStandardBatch(batchRecipients, errorMode, network);

  return {
    batch,
    executionMethod: selectedExecutionMethod,
    errorMode,
    recipients,
    recipientCount: recipients.length,
    totalValueAttoFil: batch.value,
    networkKey: network.key,
    chainId: network.chainId,
  } as PreparedBatchForExecutionMethod<TExecutionMethod>;
}

function prepareStandardBatch(
  batchRecipients: ReturnType<typeof convertRecipientsToBatch>,
  errorMode: ErrorMode,
  network: BatchExecutionNetwork,
): MulticallBatchResult {
  const contracts: MulticallContractConfig = {
    multicall3Address: network.multicall3Address,
    filForwarderAddress: network.filForwarderAddress,
  };

  return buildMulticallBatch(batchRecipients, errorMode, contracts);
}

function prepareThinBatch(
  batchRecipients: ReturnType<typeof convertRecipientsToBatch>,
  errorMode: ErrorMode,
  network: BatchExecutionNetwork,
): ThinBatchBatchResult {
  if (!network.thinBatchAddress) {
    throw new Error(
      `ThinBatch is not configured for ${network.chainName}. Set ${
        network.key === 'mainnet'
          ? 'VITE_THINBATCH_ADDRESS_MAINNET'
          : 'VITE_THINBATCH_ADDRESS_CALIBRATION'
      } before using this execution method.`,
    );
  }

  return buildThinBatch(batchRecipients, errorMode, {
    thinBatchAddress: network.thinBatchAddress,
  });
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
