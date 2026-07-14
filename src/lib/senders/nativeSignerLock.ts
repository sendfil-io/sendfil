import type { SendFilNetworkKey } from '../networks';
import {
  readUncertainMultisigActions,
  verifyUncertainMultisigActionStorage,
} from '../multisig/actionStorage';
import {
  readNativeSubmissionRecords,
  verifyNativeSubmissionStorage,
} from './nativeSubmissionStorage';

const NATIVE_SIGNER_LOCK_NAME = 'sendfil.native-signer.v1';

export type NativeSignerLockErrorCode =
  | 'LOCK_UNAVAILABLE'
  | 'LOCK_BUSY'
  | 'STORAGE_UNAVAILABLE'
  | 'UNRESOLVED_SUBMISSION';

export class NativeSignerLockError extends Error {
  readonly code: NativeSignerLockErrorCode;

  constructor(code: NativeSignerLockErrorCode, message: string) {
    super(message);
    this.name = 'NativeSignerLockError';
    this.code = code;
  }
}

export interface NativeSignerLockOptions {
  networkKey: SendFilNetworkKey;
  signerAddress: string;
  storage?: Storage;
  lockManager?: LockManager;
}

export function getNativeSignerLockName(): string {
  return NATIVE_SIGNER_LOCK_NAME;
}

function getLockManager(override?: LockManager): LockManager | undefined {
  if (override) {
    return override;
  }

  if (typeof navigator === 'undefined') {
    return undefined;
  }

  try {
    return navigator.locks;
  } catch {
    return undefined;
  }
}

function assertSignerHasNoUnresolvedSubmission({
  storage,
}: NativeSignerLockOptions): void {
  const multisigStorageError = verifyUncertainMultisigActionStorage(storage);

  if (multisigStorageError) {
    throw new NativeSignerLockError(
      'STORAGE_UNAVAILABLE',
      `SendFIL could not verify its multisig action safety records. ${multisigStorageError}`,
    );
  }

  const nativeStorageError = verifyNativeSubmissionStorage(storage);

  if (nativeStorageError) {
    throw new NativeSignerLockError(
      'STORAGE_UNAVAILABLE',
      `SendFIL could not verify its native submission safety records. ${nativeStorageError}`,
    );
  }

  const multisigActions = readUncertainMultisigActions(storage);

  if (multisigActions.error) {
    throw new NativeSignerLockError('STORAGE_UNAVAILABLE', multisigActions.error);
  }

  const nativeSubmissions = readNativeSubmissionRecords(storage);

  if (nativeSubmissions.error) {
    throw new NativeSignerLockError('STORAGE_UNAVAILABLE', nativeSubmissions.error);
  }

  const hasUnresolvedMultisigAction =
    multisigActions.creates.length > 0 || multisigActions.proposals.length > 0;
  const hasUnresolvedNativeSubmission = nativeSubmissions.records.length > 0;

  if (hasUnresolvedMultisigAction || hasUnresolvedNativeSubmission) {
    throw new NativeSignerLockError(
      'UNRESOLVED_SUBMISSION',
      'Another native Filecoin message already has an unresolved submitted result. ' +
        'Reconcile its exact CID before signing another native message from SendFIL.',
    );
  }
}

export async function withNativeSignerLock<T>(
  options: NativeSignerLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const lockManager = getLockManager(options.lockManager);

  if (!lockManager || typeof lockManager.request !== 'function') {
    throw new NativeSignerLockError(
      'LOCK_UNAVAILABLE',
      'This browser cannot safely coordinate native Filecoin signing across tabs. ' +
        'Use a browser with Web Locks support, then try again.',
    );
  }

  return lockManager.request(
    getNativeSignerLockName(),
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) {
        throw new NativeSignerLockError(
          'LOCK_BUSY',
          'Another SendFIL tab is currently signing a native Filecoin message. ' +
            'Finish or cancel that wallet request before trying again.',
        );
      }

      assertSignerHasNoUnresolvedSubmission(options);
      return operation();
    },
  );
}
