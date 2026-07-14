import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoinType,
  newActorAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import {
  upsertUncertainCreateAction,
  upsertUncertainProposalAction,
} from '../../multisig/actionStorage';
import type {
  MultisigCreateActionState,
  MultisigProposalActionState,
} from '../../multisig/useMultisigs';
import type { NativeMultisigAddress } from '../../multisig/types';
import {
  getMultisigProposalSubmissionIdentity,
  getNativeBatchSubmissionIdentity,
  writeNativeSubmissionRecord,
  type MultisigProposalSubmissionRecord,
  type NativeBatchSubmissionRecord,
} from '../nativeSubmissionStorage';
import {
  NativeSignerLockError,
  withNativeSignerLock,
} from '../nativeSignerLock';
import { createTestLockManager } from './testLockManager';

const CID = 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';
const SIGNER_A = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const SIGNER_B = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 80),
  CoinType.MAIN,
).toString();
const MULTISIG = newActorAddress(
  Uint8Array.from({ length: 20 }, (_, index) => index + 40),
  CoinType.TEST,
).toString() as NativeMultisigAddress;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createOptions(storage: Storage, lockManager: LockManager) {
  return {
    networkKey: 'calibration' as const,
    signerAddress: SIGNER_A,
    storage,
    lockManager,
  };
}

function createUncertainCreate(): MultisigCreateActionState {
  return {
    networkKey: 'calibration',
    chainId: 314159,
    networkLabel: 'Calibration Testnet',
    signerAddress: SIGNER_A,
    status: 'uncertain',
    cid: CID,
    warning: 'Create result is uncertain.',
  };
}

function createUncertainAction(
  action: 'approve' | 'cancel',
): MultisigProposalActionState {
  return {
    action,
    proposalId: 7,
    multisigAddress: MULTISIG,
    networkKey: 'calibration',
    chainId: 314159,
    networkLabel: 'Calibration Testnet',
    signerAddress: SIGNER_A,
    status: 'uncertain',
    cid: CID,
    error: `${action} result is uncertain.`,
  };
}

function createNativeBatch(): NativeBatchSubmissionRecord {
  return {
    kind: 'native-batch',
    identity: getNativeBatchSubmissionIdentity({
      networkKey: 'calibration',
      signerAddress: SIGNER_A,
    }),
    cid: CID,
    networkKey: 'calibration',
    signerAddress: SIGNER_A,
    providerId: 'test-wallet',
    errorMode: 'ATOMIC',
    executionMethod: 'STANDARD',
    recipientCount: 1,
    totalValueAttoFil: '1',
    createdAt: 1,
  };
}

function createMultisigProposal(): MultisigProposalSubmissionRecord {
  return {
    ...createNativeBatch(),
    kind: 'multisig-proposal',
    identity: getMultisigProposalSubmissionIdentity({
      networkKey: 'calibration',
      signerAddress: SIGNER_A,
      multisigAddress: MULTISIG,
    }),
    multisigAddress: MULTISIG,
  };
}

describe('native signer lock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes all native signing across tabs before either tab can sign', async () => {
    const storage = new MemoryStorage();
    const lockManager = createTestLockManager();
    const firstEntered = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const firstOperation = vi.fn(async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return 'first';
    });
    const secondOperation = vi.fn(async () => 'second');

    const first = withNativeSignerLock(createOptions(storage, lockManager), firstOperation);
    await firstEntered.promise;

    await expect(
      withNativeSignerLock(
        {
          networkKey: 'mainnet',
          signerAddress: SIGNER_B,
          storage,
          lockManager,
        },
        secondOperation,
      ),
    ).rejects.toMatchObject({ code: 'LOCK_BUSY' } satisfies Partial<NativeSignerLockError>);
    expect(secondOperation).not.toHaveBeenCalled();

    releaseFirst.resolve();
    await expect(first).resolves.toBe('first');
  });

  it('releases the browser lock after a deterministic pre-CID rejection', async () => {
    const storage = new MemoryStorage();
    const lockManager = createTestLockManager();
    const options = createOptions(storage, lockManager);

    await expect(
      withNativeSignerLock(options, async () => {
        throw new Error('User rejected the wallet request');
      }),
    ).rejects.toThrow('User rejected');
    await expect(withNativeSignerLock(options, async () => 'retry')).resolves.toBe('retry');
  });

  it.each([
    {
      label: 'native batch',
      seed: (storage: Storage) => writeNativeSubmissionRecord(createNativeBatch(), storage),
    },
    {
      label: 'multisig Propose',
      seed: (storage: Storage) => writeNativeSubmissionRecord(createMultisigProposal(), storage),
    },
    {
      label: 'multisig Create',
      seed: (storage: Storage) => upsertUncertainCreateAction(createUncertainCreate(), storage).error,
    },
    {
      label: 'multisig Approve',
      seed: (storage: Storage) =>
        upsertUncertainProposalAction(createUncertainAction('approve'), storage).error,
    },
    {
      label: 'multisig Cancel',
      seed: (storage: Storage) =>
        upsertUncertainProposalAction(createUncertainAction('cancel'), storage).error,
    },
  ])('blocks signing when a $label exact-CID record is unresolved', async ({ seed }) => {
    const storage = new MemoryStorage();
    const operation = vi.fn(async () => 'signed');

    expect(seed(storage)).toBeUndefined();
    await expect(
      withNativeSignerLock(createOptions(storage, createTestLockManager()), operation),
    ).rejects.toMatchObject({
      code: 'UNRESOLVED_SUBMISSION',
    } satisfies Partial<NativeSignerLockError>);
    expect(operation).not.toHaveBeenCalled();
  });

  it('fails closed before signing when Web Locks are unavailable', async () => {
    const operation = vi.fn(async () => 'signed');
    vi.stubGlobal('navigator', {});

    await expect(
      withNativeSignerLock(
        {
          networkKey: 'calibration',
          signerAddress: SIGNER_A,
          storage: new MemoryStorage(),
        },
        operation,
      ),
    ).rejects.toMatchObject({
      code: 'LOCK_UNAVAILABLE',
    } satisfies Partial<NativeSignerLockError>);
    expect(operation).not.toHaveBeenCalled();
  });

  it('fails closed before signing when either safety store is malformed', async () => {
    const storage = new MemoryStorage();
    const operation = vi.fn(async () => 'signed');
    storage.setItem('sendfil.multisig-uncertain-actions.v1', 'not-json');

    await expect(
      withNativeSignerLock(createOptions(storage, createTestLockManager()), operation),
    ).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    } satisfies Partial<NativeSignerLockError>);
    expect(operation).not.toHaveBeenCalled();
  });
});
