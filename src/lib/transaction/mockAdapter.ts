import {
  BatchExecutionError,
  ERROR_MODE_COPY,
} from './errorHandling';
import {
  applyGasBuffer,
  buildBatchGasEstimate,
  type BatchExecutionAdapter,
  type PreparedBatchExecution,
} from './batchExecution';

export const E2E_ATOMIC_REVERT_ADDRESS =
  '0x000000000000000000000000000000000000dEaD' as const;

interface MockBatchExecutionAdapterOptions {
  confirmationDelayMs?: number;
}

function shouldFailAtomicPreflight(prepared: PreparedBatchExecution): boolean {
  if (prepared.errorMode !== 'ATOMIC') {
    return false;
  }

  return prepared.recipients.some(
    (recipient) =>
      recipient.address.toLowerCase() === E2E_ATOMIC_REVERT_ADDRESS.toLowerCase(),
  );
}

export function createMockBatchExecutionAdapter(
  options: MockBatchExecutionAdapterOptions = {},
): BatchExecutionAdapter {
  const confirmationDelayMs = options.confirmationDelayMs ?? 300;

  return {
    estimate: async (prepared) => {
      if (shouldFailAtomicPreflight(prepared)) {
        throw new BatchExecutionError({
          category: 'SIMULATION_REVERT',
          title: 'Atomic batch would revert',
          message:
            'At least one recipient call would fail. Because Atomic mode is all-or-nothing, the whole batch is blocked before submission.',
          errorMode: prepared.errorMode,
          stage: 'preflight',
          recoverable: true,
          hint: ERROR_MODE_COPY.ATOMIC.retryHint,
          details: `Mock atomic revert triggered by ${E2E_ATOMIC_REVERT_ADDRESS}`,
        });
      }

      const baseGasLimit = 21_000n * BigInt(prepared.recipientCount + 1);

      return buildBatchGasEstimate(
        applyGasBuffer(baseGasLimit),
        1_000_000_000n,
      );
    },
    execute: async () => ({
      txHash: `0x${'a'.repeat(64)}` as `0x${string}`,
      confirmation: new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, confirmationDelayMs);
      }),
    }),
  };
}
