import type { Address } from 'viem';
import type { ErrorMode } from './multicall';
import { BatchExecutionError } from './errorHandling';
import {
  getSupportedNetworkListLabel,
  type SendFilNetworkConfig,
  type SupportedChainId,
} from '../networks';

type SubmitBalanceNetwork = Pick<
  SendFilNetworkConfig,
  'key' | 'chainId' | 'walletLabel'
>;

export type SubmitBalanceSender =
  | {
      kind: 'evm';
      address: Address;
      chainId: number;
    }
  | {
      kind: 'native';
      address: string;
      networkKey: SendFilNetworkConfig['key'];
    };

export type SubmitBalanceCheckFailureReason =
  | 'INSUFFICIENT_BALANCE'
  | 'UNSUPPORTED_NETWORK'
  | 'UNSUPPORTED_SENDER'
  | 'BALANCE_UNAVAILABLE';

interface SubmitBalanceCheckBase {
  transferTotalAttoFil: bigint;
  estimatedNetworkFeeAttoFil: bigint;
  requiredAttoFil: bigint;
}

export interface SubmitBalanceCheckSuccess extends SubmitBalanceCheckBase {
  ok: true;
  availableAttoFil: bigint;
}

export interface SubmitBalanceCheckFailure extends SubmitBalanceCheckBase {
  ok: false;
  reason: SubmitBalanceCheckFailureReason;
  availableAttoFil?: bigint;
  details?: string;
}

export type SubmitBalanceCheckResult =
  | SubmitBalanceCheckSuccess
  | SubmitBalanceCheckFailure;

export interface SubmitBalanceCheckRequest {
  sender: SubmitBalanceSender;
  network?: SubmitBalanceNetwork;
  transferTotalAttoFil: bigint;
  estimatedNetworkFeeAttoFil: bigint;
  readEvmBalance?: (params: {
    address: Address;
    chainId: SupportedChainId;
  }) => Promise<bigint>;
  readNativeBalance?: (params: {
    address: string;
    networkKey: SendFilNetworkConfig['key'];
  }) => Promise<bigint>;
}

function createBaseResult(
  request: Pick<
    SubmitBalanceCheckRequest,
    'transferTotalAttoFil' | 'estimatedNetworkFeeAttoFil'
  >,
): SubmitBalanceCheckBase {
  return {
    transferTotalAttoFil: request.transferTotalAttoFil,
    estimatedNetworkFeeAttoFil: request.estimatedNetworkFeeAttoFil,
    requiredAttoFil:
      request.transferTotalAttoFil + request.estimatedNetworkFeeAttoFil,
  };
}

function createFailure(
  request: Pick<
    SubmitBalanceCheckRequest,
    'transferTotalAttoFil' | 'estimatedNetworkFeeAttoFil'
  >,
  reason: SubmitBalanceCheckFailureReason,
  options: Pick<SubmitBalanceCheckFailure, 'availableAttoFil' | 'details'> = {},
): SubmitBalanceCheckFailure {
  return {
    ok: false,
    ...createBaseResult(request),
    reason,
    ...options,
  };
}

function createSuccess(
  request: Pick<
    SubmitBalanceCheckRequest,
    'transferTotalAttoFil' | 'estimatedNetworkFeeAttoFil'
  >,
  availableAttoFil: bigint,
): SubmitBalanceCheckSuccess {
  return {
    ok: true,
    ...createBaseResult(request),
    availableAttoFil,
  };
}

export async function recheckSubmitBalance(
  request: SubmitBalanceCheckRequest,
): Promise<SubmitBalanceCheckResult> {
  const { sender, network } = request;

  if (!network) {
    return createFailure(request, 'UNSUPPORTED_NETWORK', {
      details: `Connect to ${getSupportedNetworkListLabel()} before submitting a batch.`,
    });
  }

  if (sender.kind === 'evm') {
    if (sender.chainId !== network.chainId) {
      return createFailure(request, 'UNSUPPORTED_NETWORK', {
        details: `Wallet is connected to chain ${sender.chainId}, but the active SendFIL network is ${network.walletLabel}.`,
      });
    }

    if (!request.readEvmBalance) {
      return createFailure(request, 'BALANCE_UNAVAILABLE', {
        details: 'No EVM balance reader is available for the connected wallet.',
      });
    }

    try {
      const availableAttoFil = await request.readEvmBalance({
        address: sender.address,
        chainId: network.chainId,
      });
      const base = createBaseResult(request);

      if (availableAttoFil < base.requiredAttoFil) {
        return {
          ok: false,
          ...base,
          reason: 'INSUFFICIENT_BALANCE',
          availableAttoFil,
        };
      }

      return createSuccess(request, availableAttoFil);
    } catch (error) {
      return createFailure(request, 'BALANCE_UNAVAILABLE', {
        details: error instanceof Error ? error.message : 'Unknown balance read failure',
      });
    }
  }

  if (!request.readNativeBalance) {
    return createFailure(request, 'UNSUPPORTED_SENDER', {
      details:
        'Submit-time balance checks for native Filecoin senders are not implemented yet.',
    });
  }

  try {
    const availableAttoFil = await request.readNativeBalance({
      address: sender.address,
      networkKey: sender.networkKey,
    });
    const base = createBaseResult(request);

    if (availableAttoFil < base.requiredAttoFil) {
      return {
        ok: false,
        ...base,
        reason: 'INSUFFICIENT_BALANCE',
        availableAttoFil,
      };
    }

    return createSuccess(request, availableAttoFil);
  } catch (error) {
    return createFailure(request, 'BALANCE_UNAVAILABLE', {
      details: error instanceof Error ? error.message : 'Unknown balance read failure',
    });
  }
}

export function createSubmitBalanceCheckError(
  result: SubmitBalanceCheckFailure,
  errorMode: ErrorMode,
): BatchExecutionError {
  switch (result.reason) {
    case 'INSUFFICIENT_BALANCE':
      return new BatchExecutionError({
        category: 'INSUFFICIENT_FUNDS',
        title: 'Balance changed',
        message: 'Balance changed. Please review again.',
        errorMode,
        stage: 'execution',
        recoverable: true,
        hint:
          'Your current balance is below the batch total plus the latest estimated network fee.',
        details: `Required ${result.requiredAttoFil.toString()} attoFIL; available ${result.availableAttoFil?.toString() ?? 'unknown'} attoFIL.`,
      });
    case 'UNSUPPORTED_NETWORK':
      return new BatchExecutionError({
        category: 'UNSUPPORTED_NETWORK',
        title: 'Unsupported network',
        message: `Connect to ${getSupportedNetworkListLabel()} before submitting this batch.`,
        errorMode,
        stage: 'execution',
        recoverable: true,
        hint: 'Switch networks in your wallet, then review the batch again.',
        details: result.details,
      });
    case 'UNSUPPORTED_SENDER':
      return new BatchExecutionError({
        category: 'UNSUPPORTED_SENDER',
        title: 'Sender type not supported',
        message:
          'Submit-time balance checks are not implemented for this sender type yet.',
        errorMode,
        stage: 'execution',
        recoverable: true,
        hint:
          'Use an EVM wallet for this batch until native Filecoin sender support is wired in.',
        details: result.details,
      });
    case 'BALANCE_UNAVAILABLE':
    default:
      return new BatchExecutionError({
        category: 'RPC_FAILURE',
        title: 'Balance check unavailable',
        message:
          'SendFIL could not verify your balance on the active network before submitting.',
        errorMode,
        stage: 'execution',
        recoverable: true,
        hint: 'Retry in a moment. SendFIL will not submit until the balance check succeeds.',
        details: result.details,
      });
  }
}
