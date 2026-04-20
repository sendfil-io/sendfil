export type SenderWalletType = 'SINGLE_SIG' | 'MULTI_SIG';
export type ExecutionMethod = 'STANDARD' | 'THINBATCH';
export type ErrorHandlingPreference = 'PARTIAL' | 'ATOMIC';

export interface BatchConfiguration {
  senderWalletType: SenderWalletType;
  executionMethod: ExecutionMethod;
  errorHandling: ErrorHandlingPreference;
}

export const DEFAULT_BATCH_CONFIGURATION: BatchConfiguration = {
  senderWalletType: 'SINGLE_SIG',
  executionMethod: 'STANDARD',
  errorHandling: 'PARTIAL',
};

export function getSenderWalletTypeLabel(value: SenderWalletType): string {
  return value === 'SINGLE_SIG' ? 'Single-signer' : 'Multi-sig';
}

export function getExecutionMethodLabel(value: ExecutionMethod): string {
  return value === 'STANDARD' ? 'Standard' : 'ThinBatch';
}

export function getErrorHandlingLabel(value: ErrorHandlingPreference): string {
  return value === 'PARTIAL' ? 'Partial' : 'Atomic';
}
