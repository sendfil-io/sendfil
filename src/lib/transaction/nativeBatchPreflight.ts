import {
  estimateGas as estimateLotusGas,
  getNonce as getNativeNonce,
} from '../DataProvider';
import type { FilecoinMessage } from '../DataProvider/types';
import type {
  SendFilNetworkConfig,
  SendFilNetworkKey,
} from '../networks';
import type { ExecutionMethod } from '../batchConfiguration';
import type { NativeFilecoinConnectedSender } from '../senders';
import {
  prepareBatchExecution,
  type BatchExecutionRecipient,
  type BatchGasEstimate,
  type PreparedBatchExecution,
} from './batchExecution';
import type { ErrorMode } from './multicall';
import {
  prepareNativeBatchMessage,
  type PreparedNativeBatchMessage,
} from './nativeBatchMessage';

export type NativeBatchPreflightNetwork = Pick<
  SendFilNetworkConfig,
  | 'key'
  | 'chainId'
  | 'chainName'
  | 'multicall3Address'
  | 'filForwarderAddress'
  | 'thinBatchAddress'
>;

export interface NativeBatchPreflightRpc {
  getNonce?: (
    address: string,
    networkKey: SendFilNetworkKey,
  ) => Promise<number>;
  estimateGas?: (
    message: FilecoinMessage,
    networkKey: SendFilNetworkKey,
  ) => Promise<FilecoinMessage>;
}

export interface NativeBatchPreflightRequest {
  sender: NativeFilecoinConnectedSender;
  recipients: BatchExecutionRecipient[];
  errorMode: ErrorMode;
  executionMethod?: ExecutionMethod;
  network: NativeBatchPreflightNetwork;
  rpc?: NativeBatchPreflightRpc;
}

export interface PreparedNativeBatchPreflight {
  sender: NativeFilecoinConnectedSender;
  preparedBatch: PreparedBatchExecution;
  nonce: number;
  draftNativeMessage: PreparedNativeBatchMessage;
  estimatedNativeMessage: PreparedNativeBatchMessage;
  gasEstimate: BatchGasEstimate;
}

function buildNativeBatchGasEstimate(message: FilecoinMessage): BatchGasEstimate {
  const gasLimit = BigInt(message.GasLimit);
  const gasFeeCap = BigInt(message.GasFeeCap);
  const gasPremium = BigInt(message.GasPremium);

  return {
    gasLimit,
    gasFeeCap,
    gasPremium,
    estimatedFee: gasLimit * gasFeeCap,
  };
}

function assertNativeSenderMatchesNetwork(
  sender: NativeFilecoinConnectedSender,
  network: NativeBatchPreflightNetwork,
): void {
  if (sender.networkKey !== network.key || sender.chainId !== network.chainId) {
    throw new Error(
      `Native sender network ${sender.networkKey} does not match requested batch network ${network.key}.`,
    );
  }
}

export async function preflightNativeBatch({
  sender,
  recipients,
  errorMode,
  executionMethod = 'STANDARD',
  network,
  rpc,
}: NativeBatchPreflightRequest): Promise<PreparedNativeBatchPreflight> {
  assertNativeSenderMatchesNetwork(sender, network);

  const readNonce = rpc?.getNonce ?? getNativeNonce;
  const estimateGas =
    rpc?.estimateGas ??
    ((message: FilecoinMessage, networkKey: SendFilNetworkKey) =>
      estimateLotusGas(message, undefined, networkKey));

  const preparedBatch = prepareBatchExecution(
    recipients,
    errorMode,
    network,
    executionMethod,
  );
  const nonce = await readNonce(sender.address, sender.networkKey);
  const draftNativeMessage = prepareNativeBatchMessage({
    sender,
    preparedBatch,
    nonce,
  });
  const estimatedMessage = await estimateGas(
    draftNativeMessage.message,
    sender.networkKey,
  );
  const estimatedNativeMessage = prepareNativeBatchMessage({
    sender,
    preparedBatch,
    nonce,
    gas: {
      gasLimit: estimatedMessage.GasLimit,
      gasFeeCap: estimatedMessage.GasFeeCap,
      gasPremium: estimatedMessage.GasPremium,
    },
  });

  return {
    sender,
    preparedBatch,
    nonce,
    draftNativeMessage,
    estimatedNativeMessage,
    gasEstimate: buildNativeBatchGasEstimate(estimatedNativeMessage.message),
  };
}
