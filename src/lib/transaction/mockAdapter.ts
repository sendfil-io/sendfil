import type {
  BatchExecutionAdapter,
  BatchExecutionSubmission,
} from './useExecuteBatch';

interface MockBatchExecutionAdapterOptions {
  confirmationDelayMs?: number;
}

export function createMockBatchExecutionAdapter(
  options: MockBatchExecutionAdapterOptions = {},
): BatchExecutionAdapter {
  const confirmationDelayMs = options.confirmationDelayMs ?? 300;

  return {
    executeBatch: async (): Promise<BatchExecutionSubmission> => ({
      txHash: `0x${'a'.repeat(64)}` as `0x${string}`,
      confirmation: new Promise<void>((resolve) => {
        window.setTimeout(resolve, confirmationDelayMs);
      }),
    }),
  };
}
