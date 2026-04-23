import type { ErrorMode } from './multicall';

export type BatchExecutionErrorCategory =
  | 'USER_REJECTED'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_RECIPIENT'
  | 'SIMULATION_REVERT'
  | 'ONCHAIN_REVERT_ATOMIC'
  | 'RPC_FAILURE'
  | 'UNKNOWN';

export type BatchExecutionStage = 'preflight' | 'execution' | 'confirmation';

export interface BatchExecutionErrorOptions {
  category: BatchExecutionErrorCategory;
  title: string;
  message: string;
  errorMode: ErrorMode;
  stage: BatchExecutionStage;
  recoverable: boolean;
  hint?: string;
  details?: string;
  cause?: unknown;
}

export interface BatchExecutionErrorContext {
  errorMode: ErrorMode;
  stage: BatchExecutionStage;
}

export interface ErrorModeCopy {
  reviewSummary: string;
  reviewDetail: string;
  failureSummary: string;
  retryHint: string;
}

export const ERROR_MODE_COPY: Record<ErrorMode, ErrorModeCopy> = {
  PARTIAL: {
    reviewSummary: 'Some transfers may succeed even if others fail.',
    reviewDetail:
      'Partial mode keeps successful internal calls and skips the ones that revert.',
    failureSummary:
      'Some transfers may already be finalized even when another call in the batch fails.',
    retryHint: 'Switch to Atomic if you need all-or-nothing delivery.',
  },
  ATOMIC: {
    reviewSummary: 'Any failing transfer reverts the whole batch.',
    reviewDetail:
      'Atomic mode requires every recipient call to succeed in the same aggregate transaction.',
    failureSummary: 'No transfers are finalized if any internal call fails.',
    retryHint:
      'Correct the failing recipient rows and try again, or switch to Partial for best-effort delivery.',
  },
};

export class BatchExecutionError extends Error {
  readonly category: BatchExecutionErrorCategory;
  readonly title: string;
  readonly errorMode: ErrorMode;
  readonly stage: BatchExecutionStage;
  readonly recoverable: boolean;
  readonly hint?: string;
  readonly details?: string;
  readonly cause?: unknown;

  constructor(options: BatchExecutionErrorOptions) {
    super(options.message);
    this.name = 'BatchExecutionError';
    this.category = options.category;
    this.title = options.title;
    this.errorMode = options.errorMode;
    this.stage = options.stage;
    this.recoverable = options.recoverable;
    this.hint = options.hint;
    this.details = options.details;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function includesAny(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase));
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const maybeCode = Reflect.get(error, 'code');

  return typeof maybeCode === 'number' ? maybeCode : undefined;
}

function collectErrorMessages(error: unknown): string[] {
  if (error instanceof Error) {
    const messages = [error.message];

    const shortMessage = Reflect.get(error, 'shortMessage');
    if (typeof shortMessage === 'string') {
      messages.push(shortMessage);
    }

    const details = Reflect.get(error, 'details');
    if (typeof details === 'string') {
      messages.push(details);
    }

    if ('cause' in error && error.cause) {
      messages.push(...collectErrorMessages(error.cause));
    }

    return messages.filter(Boolean);
  }

  if (typeof error === 'string') {
    return [error];
  }

  if (typeof error === 'object' && error !== null) {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string') {
      return [message];
    }
  }

  return ['Unknown error'];
}

function createBatchExecutionError(
  category: BatchExecutionErrorCategory,
  context: BatchExecutionErrorContext,
  details: string,
  cause: unknown,
): BatchExecutionError {
  switch (category) {
    case 'USER_REJECTED':
      return new BatchExecutionError({
        category,
        title: 'Transaction rejected',
        message: 'The batch was not submitted because the wallet signature request was rejected.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint: 'Review the batch and retry when you are ready to sign.',
        details,
        cause,
      });
    case 'INSUFFICIENT_FUNDS':
      return new BatchExecutionError({
        category,
        title: 'Insufficient funds',
        message:
          'Your wallet does not have enough FIL to cover the batch total and network fees.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint: 'Reduce the batch size or fund the wallet before retrying.',
        details,
        cause,
      });
    case 'INVALID_RECIPIENT':
      return new BatchExecutionError({
        category,
        title: 'Recipient data needs attention',
        message:
          'At least one recipient could not be prepared for execution. Check the address format and amount for every row.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint: 'Fix the invalid recipient rows, reopen review, and try again.',
        details,
        cause,
      });
    case 'SIMULATION_REVERT':
      return new BatchExecutionError({
        category,
        title:
          context.errorMode === 'ATOMIC'
            ? 'Atomic batch would revert'
            : 'Batch simulation failed',
        message:
          context.errorMode === 'ATOMIC'
            ? 'At least one recipient call would fail. Because Atomic mode is all-or-nothing, the whole batch is blocked before submission.'
            : 'The batch could not be simulated with the current inputs.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint:
          context.errorMode === 'ATOMIC'
            ? ERROR_MODE_COPY.ATOMIC.retryHint
            : 'Review the recipient rows and retry the estimate.',
        details,
        cause,
      });
    case 'ONCHAIN_REVERT_ATOMIC':
      return new BatchExecutionError({
        category,
        title: 'Atomic batch reverted',
        message:
          'The transaction reached on-chain execution, but one internal call failed and reverted the entire batch. No transfers were finalized.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint: ERROR_MODE_COPY.ATOMIC.retryHint,
        details,
        cause,
      });
    case 'RPC_FAILURE':
      return new BatchExecutionError({
        category,
        title: 'RPC connection failed',
        message:
          'SendFIL could not reach the configured RPC provider while estimating or sending this batch.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint: 'Retry in a moment. If the problem persists, verify the configured RPC endpoint.',
        details,
        cause,
      });
    case 'UNKNOWN':
    default:
      return new BatchExecutionError({
        category: 'UNKNOWN',
        title: 'Batch execution failed',
        message:
          context.errorMode === 'ATOMIC'
            ? `The batch failed unexpectedly. ${ERROR_MODE_COPY.ATOMIC.failureSummary}`
            : 'The wallet or RPC returned an unexpected error while processing the batch.',
        errorMode: context.errorMode,
        stage: context.stage,
        recoverable: true,
        hint:
          context.errorMode === 'ATOMIC'
            ? ERROR_MODE_COPY.ATOMIC.retryHint
            : 'Retry the batch or switch to Atomic if you need stronger delivery guarantees.',
        details,
        cause,
      });
  }
}

export function mapBatchExecutionError(
  error: unknown,
  context: BatchExecutionErrorContext,
): BatchExecutionError {
  if (error instanceof BatchExecutionError) {
    return error;
  }

  const details = collectErrorMessages(error).join(' | ');
  const lowerDetails = details.toLowerCase();
  const code = getErrorCode(error);

  if (
    code === 4001 ||
    includesAny(lowerDetails, [
      'user rejected',
      'user denied',
      'rejected the request',
      'denied transaction signature',
    ])
  ) {
    return createBatchExecutionError('USER_REJECTED', context, details, error);
  }

  if (
    includesAny(lowerDetails, [
      'insufficient funds',
      'not enough funds',
      'exceeds balance',
    ])
  ) {
    return createBatchExecutionError('INSUFFICIENT_FUNDS', context, details, error);
  }

  if (
    includesAny(lowerDetails, [
      'invalid address',
      'unsupported address',
      'failed to normalize address',
      'id addresses are not supported',
      'no recipients provided',
      'recipient',
    ]) &&
    includesAny(lowerDetails, ['address', 'recipient', 'amount', 'provided'])
  ) {
    return createBatchExecutionError('INVALID_RECIPIENT', context, details, error);
  }

  if (
    context.stage === 'preflight' &&
    includesAny(lowerDetails, ['revert', 'reverted', 'execution reverted', 'simulate'])
  ) {
    return createBatchExecutionError('SIMULATION_REVERT', context, details, error);
  }

  if (
    context.errorMode === 'ATOMIC' &&
    context.stage !== 'preflight' &&
    includesAny(lowerDetails, ['revert', 'reverted', 'execution reverted'])
  ) {
    return createBatchExecutionError('ONCHAIN_REVERT_ATOMIC', context, details, error);
  }

  if (
    includesAny(lowerDetails, [
      'rpc',
      'json-rpc',
      'fetch failed',
      'failed to fetch',
      'timeout',
      'network error',
      'public client not available',
      'connector not connected',
      '503',
      '502',
      '500',
    ])
  ) {
    return createBatchExecutionError('RPC_FAILURE', context, details, error);
  }

  return createBatchExecutionError('UNKNOWN', context, details, error);
}
