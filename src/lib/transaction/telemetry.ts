import type { BatchExecutionErrorCategory } from './errorHandling';
import type { ErrorMode } from './multicall';
import type { SendFilNetworkKey, SupportedChainId } from '../networks';

export type BatchTelemetryEventName =
  | 'batch_preflight_succeeded'
  | 'batch_preflight_failed'
  | 'batch_submission_requested'
  | 'batch_submitted'
  | 'batch_confirmed'
  | 'batch_failed';

export interface BatchTelemetryEvent {
  event: BatchTelemetryEventName;
  errorMode: ErrorMode;
  recipientCount: number;
  totalValueAttoFil: string;
  networkKey?: SendFilNetworkKey;
  chainId?: SupportedChainId;
  simulationResult?: 'passed' | 'failed' | 'skipped';
  gasLimit?: string;
  estimatedFeeAttoFil?: string;
  txHash?: string;
  errorCategory?: BatchExecutionErrorCategory;
  errorMessage?: string;
}

const BATCH_TELEMETRY_EVENT_NAME = 'sendfil:batch-telemetry';

export function emitBatchExecutionTelemetry(event: BatchTelemetryEvent): void {
  const payload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  console.info('[sendfil:batch-telemetry]', payload);

  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof CustomEvent !== 'undefined'
  ) {
    window.dispatchEvent(
      new CustomEvent(BATCH_TELEMETRY_EVENT_NAME, {
        detail: payload,
      }),
    );
  }
}
