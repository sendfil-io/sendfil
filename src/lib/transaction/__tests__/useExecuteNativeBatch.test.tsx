import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { FILSNAP_FILECOIN_PROVIDER_METADATA } from '../../senders';
import { NativeFilecoinSubmissionUncertainError } from '../../senders';
import { createNativeFilecoinConnectedSender } from '../../senders/senderModel';
import type { NativeFilecoinWalletProvider } from '../../senders/types';
import { createTestLockManager } from '../../senders/__tests__/testLockManager';
import {
  NATIVE_SUBMISSION_STORAGE_KEY,
  getNativeBatchSubmissionIdentity,
  readNativeSubmissionRecords,
  writeNativeSubmissionRecord,
  type NativeBatchSubmissionRecord,
} from '../../senders/nativeSubmissionStorage';
import type { FilecoinMessage, TransactionStatus } from '../../DataProvider/types';
import type { SendFilNetworkKey } from '../../networks';
import { toF4 } from '../../../utils/toF4';
import { BatchExecutionError } from '../errorHandling';
import type { BatchExecutionRecipient } from '../batchExecution';
import type { NativeBatchPreflightRpc } from '../nativeBatchPreflight';
import {
  useExecuteNativeBatch,
  type UseExecuteNativeBatchReturn,
} from '../useExecuteNativeBatch';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();
const OTHER_CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 120),
  CoinType.TEST,
).toString();
const RECIPIENT = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 80),
  CoinType.TEST,
).toString();
const CID = 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';

const recipients: BatchExecutionRecipient[] = [
  { address: RECIPIENT, amount: 1 },
];

class FailNthWriteStorage implements Storage {
  private readonly values = new Map<string, string>();
  private writeCount = 0;

  constructor(private readonly failingWrite: number) {}

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
    this.writeCount += 1;

    if (this.writeCount === this.failingWrite) {
      throw new Error('storage write failed');
    }

    this.values.set(key, value);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function getNativeSender(address = CALIBRATION_T1) {
  const result = createNativeFilecoinConnectedSender({
    address,
    provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create native sender');
  }

  return result.sender;
}

function getStoredNativeBatch(
  signerAddress = CALIBRATION_T1,
): NativeBatchSubmissionRecord {
  return {
    kind: 'native-batch',
    identity: getNativeBatchSubmissionIdentity({
      networkKey: 'calibration',
      signerAddress,
    }),
    cid: CID,
    networkKey: 'calibration',
    signerAddress,
    providerId: 'filsnap',
    errorMode: 'ATOMIC',
    executionMethod: 'STANDARD',
    recipientCount: 1,
    totalValueAttoFil: '1000000000000000000',
    createdAt: 1,
  };
}

function getRpc(): Required<NativeBatchPreflightRpc> {
  return {
    getNonce: vi.fn(async (address: string, networkKey: SendFilNetworkKey) => {
      void address;
      void networkKey;

      return 11;
    }),
    estimateGas: vi.fn(async (message: FilecoinMessage, networkKey: SendFilNetworkKey) => {
      void networkKey;

      return {
        ...message,
        GasLimit: 12_345,
        GasFeeCap: '456',
        GasPremium: '7',
      };
    }),
  };
}

function getProvider(balance: bigint): NativeFilecoinWalletProvider {
  return {
    metadata: FILSNAP_FILECOIN_PROVIDER_METADATA,
    async connect() {
      return {
        address: CALIBRATION_T1,
        networkKey: 'calibration',
        nativePrefix: 't',
      };
    },
    async disconnect() {
      return undefined;
    },
    async getAccount() {
      return {
        address: CALIBRATION_T1,
        networkKey: 'calibration',
        nativePrefix: 't',
      };
    },
    getBalance: vi.fn(async () => balance),
    signAndSubmitMessage: vi.fn(async () => ({ cid: CID })),
  };
}

function getConfirmedStatus(): TransactionStatus {
  return {
    cid: CID,
    status: 'confirmed',
    receipt: {
      ExitCode: 0,
      Return: '',
      GasUsed: 100,
    },
  };
}

function HookHarness({
  onValue,
  options,
}: {
  onValue: (value: UseExecuteNativeBatchReturn) => void;
  options: Parameters<typeof useExecuteNativeBatch>[0];
}) {
  onValue(useExecuteNativeBatch(options));
  return null;
}

describe('useExecuteNativeBatch', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;
  let latestHook: UseExecuteNativeBatchReturn | undefined;

  beforeEach(() => {
    latestHook = undefined;
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
    });
    Object.defineProperty(dom.window.navigator, 'locks', {
      configurable: true,
      value: createTestLockManager(),
    });

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderHook(options: Parameters<typeof useExecuteNativeBatch>[0]) {
    await act(async () => {
      root.render(
        <HookHarness
          options={options}
          onValue={(value) => {
            latestHook = value;
          }}
        />,
      );
    });
  }

  it('signs and submits the estimated native batch message after submit-time balance recheck', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const rpc = getRpc();
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => getConfirmedStatus(),
    );

    await renderHook({
      sender,
      provider,
      rpc,
      pollMessageStatus,
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });

    expect(provider.getBalance).toHaveBeenCalledWith({
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        From: CALIBRATION_T1,
        Nonce: 11,
        GasLimit: 12_345,
        GasFeeCap: '456',
        GasPremium: '7',
      }),
      expect.objectContaining({ onCidComputed: expect.any(Function) }),
    );
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.state).toBe('confirmed');
  });

  it('signs a native InvokeEVM message targeting ThinBatch when ThinBatch is selected', async () => {
    const thinBatchAddress = '0x5555555555555555555555555555555555555555' as const;
    vi.stubEnv('VITE_THINBATCH_ADDRESS_CALIBRATION', thinBatchAddress);

    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);

    await renderHook({
      sender,
      provider,
      rpc: getRpc(),
      pollMessageStatus: vi.fn(
        async (): Promise<TransactionStatus> => getConfirmedStatus(),
      ),
    });

    await act(async () => {
      await expect(
        latestHook?.executeBatch(recipients, 'PARTIAL', 'THINBATCH'),
      ).resolves.toBe(CID);
    });

    expect(provider.signAndSubmitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        To: toF4(thinBatchAddress, 't'),
        From: CALIBRATION_T1,
        Value: '1000000000000000000',
        Method: 3_844_450_837,
      }),
      expect.objectContaining({ onCidComputed: expect.any(Function) }),
    );
  });

  it('blocks native signing when submit-time balance is insufficient', async () => {
    const sender = getNativeSender();
    const provider = getProvider(1n);

    await renderHook({
      sender,
      provider,
      rpc: getRpc(),
      pollMessageStatus: vi.fn(),
    });

    let capturedError: unknown;

    await act(async () => {
      try {
        await latestHook?.executeBatch(recipients, 'ATOMIC');
      } catch (error) {
        capturedError = error;
      }
    });

    expect(capturedError).toBeInstanceOf(BatchExecutionError);
    expect((capturedError as BatchExecutionError).category).toBe('INSUFFICIENT_FUNDS');
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
    expect(latestHook?.state).toBe('failed');
  });

  it('polls the deterministic CID and single-flights when MpoolPush acceptance is uncertain', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const confirmation = createDeferred<TransactionStatus>();
    const pollMessageStatus = vi.fn(() => confirmation.promise);
    const uncertainty = new NativeFilecoinSubmissionUncertainError({
      cid: CID,
      networkKey: 'calibration',
      cause: new Error('MpoolPush response was lost'),
    });
    vi.mocked(provider.signAndSubmitMessage!).mockRejectedValue(uncertainty);

    await renderHook({ sender, provider, rpc: getRpc(), pollMessageStatus });

    let first!: Promise<string>;
    await act(async () => {
      first = latestHook!.executeBatch(recipients, 'ATOMIC');
      await expect(first).resolves.toBe(CID);
    });

    expect(latestHook?.state).toBe('pending');
    expect(latestHook?.txHash).toBe(CID);
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');

    await act(async () => {
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirmation.resolve({
        cid: CID,
        status: 'failed',
        error: 'confirmation RPC timed out',
      });
      await confirmation.promise;
    });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.error).toMatchObject({
      title: 'Native batch confirmation is uncertain',
      recoverable: false,
    });

    await act(async () => {
      latestHook!.reset();
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('preserves an unresolved lock across wallet identity changes and reset attempts', async () => {
    const originalSender = getNativeSender();
    const otherSender = getNativeSender(OTHER_CALIBRATION_T1);
    const provider = getProvider(10n ** 30n);
    const confirmation = createDeferred<TransactionStatus>();
    const pollMessageStatus = vi.fn(() => confirmation.promise);
    vi.mocked(provider.signAndSubmitMessage!).mockRejectedValue(
      new NativeFilecoinSubmissionUncertainError({
        cid: CID,
        networkKey: 'calibration',
        cause: new Error('MpoolPush response was lost'),
      }),
    );

    await renderHook({
      sender: originalSender,
      provider,
      rpc: getRpc(),
      pollMessageStatus,
    });

    let originalExecution!: Promise<string>;
    await act(async () => {
      originalExecution = latestHook!.executeBatch(recipients, 'ATOMIC');
      await expect(originalExecution).resolves.toBe(CID);
    });

    await renderHook({
      sender: otherSender,
      provider,
      rpc: getRpc(),
      pollMessageStatus,
    });

    act(() => latestHook!.reset());
    await act(async () => {
      await expect(
        latestHook!.executeBatch(recipients, 'ATOMIC'),
      ).rejects.toMatchObject({
        title: 'Another native batch is still unresolved',
        recoverable: false,
      });
    });

    await renderHook({
      sender: originalSender,
      provider,
      rpc: getRpc(),
      pollMessageStatus,
    });

    expect(latestHook!.executeBatch(recipients, 'ATOMIC')).toBe(
      originalExecution,
    );
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('releases the single-flight lock after a pre-submission wallet rejection', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    vi.mocked(provider.signAndSubmitMessage!).mockRejectedValue(
      new Error('User rejected the signature request'),
    );

    await renderHook({
      sender,
      provider,
      rpc: getRpc(),
      pollMessageStatus: vi.fn(),
    });

    await act(async () => {
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).rejects.toMatchObject({
        category: 'USER_REJECTED',
        recoverable: true,
      });
    });
    await act(async () => {
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).rejects.toMatchObject({
        category: 'USER_REJECTED',
        recoverable: true,
      });
    });

    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed status with a zero-exit receipt locked as confirmation-uncertain', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'failed',
        receipt: {
          ExitCode: 0,
          Return: '',
          GasUsed: 100,
        },
        error: 'inconsistent provider status',
      }),
    );

    await renderHook({ sender, provider, rpc: getRpc(), pollMessageStatus });

    let first!: Promise<string>;
    await act(async () => {
      first = latestHook!.executeBatch(recipients, 'ATOMIC');
      await expect(first).resolves.toBe(CID);
      await Promise.resolve();
    });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.error).toMatchObject({ recoverable: false });
    expect(latestHook!.executeBatch(recipients, 'ATOMIC')).toBe(first);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('does not report confirmation or unlock when a confirmed status has no receipt', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
      }),
    );

    await renderHook({ sender, provider, rpc: getRpc(), pollMessageStatus });

    let first!: Promise<string>;
    await act(async () => {
      first = latestHook!.executeBatch(recipients, 'ATOMIC');
      await expect(first).resolves.toBe(CID);
      await Promise.resolve();
    });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.error).toMatchObject({
      title: 'Native batch confirmation is uncertain',
      recoverable: false,
    });
    expect(latestHook!.executeBatch(recipients, 'ATOMIC')).toBe(first);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('persists the computed CID before MpoolPush can hang and keeps wallet mutation unsafe', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const push = createDeferred<{ cid: string }>();
    const confirmation = createDeferred<TransactionStatus>();
    const storage = dom.window.localStorage;

    vi.mocked(provider.signAndSubmitMessage!).mockImplementation(
      async (_message, options) => {
        await options?.onCidComputed?.(CID);
        return push.promise;
      },
    );

    await renderHook({
      sender,
      provider,
      rpc: getRpc(),
      storage,
      pollMessageStatus: vi.fn(() => confirmation.promise),
    });

    let execution!: Promise<string>;
    await act(async () => {
      execution = latestHook!.executeBatch(recipients, 'ATOMIC');
      await vi.waitFor(() => {
        expect(readNativeSubmissionRecords(storage).records).toEqual([
          expect.objectContaining({ cid: CID, identity: getStoredNativeBatch().identity }),
        ]);
      });
    });

    expect(latestHook?.isWalletMutationUnsafe).toBe(true);
    expect(latestHook?.isIdentityLocked).toBe(true);

    await act(async () => {
      push.resolve({ cid: CID });
      await expect(execution).resolves.toBe(CID);
    });

    expect(latestHook?.isWalletMutationUnsafe).toBe(false);
    expect(latestHook?.isIdentityLocked).toBe(true);

    await act(async () => {
      confirmation.resolve({
        cid: CID,
        status: 'failed',
        error: 'confirmation is still unavailable',
      });
      await confirmation.promise;
    });
  });

  it('reconciles an exact durable CID after remount without signing again', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const storage = dom.window.localStorage;
    const stored = getStoredNativeBatch();
    const pollMessageStatus = vi.fn(async () => getConfirmedStatus());

    expect(writeNativeSubmissionRecord(stored, storage)).toBeUndefined();

    await renderHook({ sender, provider, rpc: getRpc(), storage, pollMessageStatus });

    await act(async () => {
      await vi.waitFor(() => expect(latestHook?.state).toBe('confirmed'));
    });

    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
    expect(readNativeSubmissionRecords(storage).records).toEqual([]);
    expect(latestHook?.submissionSnapshot).toMatchObject(stored);
    expect(latestHook?.isIdentityLocked).toBe(false);
  });

  it('globally blocks a different signer after remount while exposing the original CID context', async () => {
    const provider = getProvider(10n ** 30n);
    const storage = dom.window.localStorage;
    const stored = getStoredNativeBatch();
    const pollMessageStatus = vi.fn();

    expect(writeNativeSubmissionRecord(stored, storage)).toBeUndefined();

    await renderHook({
      sender: getNativeSender(OTHER_CALIBRATION_T1),
      provider,
      rpc: getRpc(),
      storage,
      pollMessageStatus,
    });

    expect(latestHook?.isIdentityLocked).toBe(true);
    expect(latestHook?.submissionSnapshot).toMatchObject(stored);
    await act(async () => {
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).rejects.toMatchObject({
        title: 'Another native batch is still unresolved',
        recoverable: false,
      });
    });
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
    expect(pollMessageStatus).not.toHaveBeenCalled();
  });

  it('removes a pre-push CID lock after a deterministic wallet rejection', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const storage = dom.window.localStorage;

    vi.mocked(provider.signAndSubmitMessage!).mockImplementation(
      async (_message, options) => {
        await options?.onCidComputed?.(CID);
        throw new Error('User rejected the signature request');
      },
    );

    await renderHook({
      sender,
      provider,
      rpc: getRpc(),
      storage,
      pollMessageStatus: vi.fn(),
    });

    await act(async () => {
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).rejects.toMatchObject({
        category: 'USER_REJECTED',
      });
    });

    expect(readNativeSubmissionRecords(storage).records).toEqual([]);
    expect(latestHook?.isIdentityLocked).toBe(false);
    expect(latestHook?.isWalletMutationUnsafe).toBe(false);
  });

  it('rechecks an in-memory CID when the post-Mpool fallback storage write failed', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 30n);
    const storage = new FailNthWriteStorage(4);
    const pollMessageStatus = vi
      .fn<() => Promise<TransactionStatus>>()
      .mockResolvedValueOnce({
        cid: CID,
        status: 'failed',
        error: 'first confirmation unavailable',
      })
      .mockResolvedValueOnce(getConfirmedStatus());

    await renderHook({ sender, provider, rpc: getRpc(), storage, pollMessageStatus });

    await act(async () => {
      await expect(latestHook!.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
      await Promise.resolve();
    });

    expect(readNativeSubmissionRecords(storage).records).toEqual([]);
    expect(latestHook?.submissionSnapshot).toMatchObject({ cid: CID });
    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.isIdentityLocked).toBe(true);

    await act(async () => {
      await expect(latestHook!.recheck()).resolves.toBeUndefined();
    });

    expect(pollMessageStatus).toHaveBeenCalledTimes(2);
    expect(latestHook?.state).toBe('confirmed');
    expect(latestHook?.isIdentityLocked).toBe(false);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('surfaces malformed safety storage before a wallet is connected', async () => {
    const storage = dom.window.localStorage;
    storage.setItem(NATIVE_SUBMISSION_STORAGE_KEY, '');

    await renderHook({ storage });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.isIdentityLocked).toBe(true);
    expect(latestHook?.error).toMatchObject({
      title: 'Native submission safety storage is unavailable',
      recoverable: false,
    });
  });
});
