import { act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoinType,
  newActorAddress,
  newIDAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { getNetworkConfig } from '../../networks';
import {
  FILSNAP_FILECOIN_PROVIDER_METADATA,
  NativeFilecoinSubmissionUncertainError,
  createNativeFilecoinConnectedSender,
  type NativeFilecoinConnectedSender,
  type NativeFilecoinWalletProvider,
} from '../../senders';
import type { FilecoinMessage, TransactionStatus } from '../../DataProvider/types';
import { createTestLockManager } from '../../senders/__tests__/testLockManager';
import type { MultisigActorState, MultisigPendingProposal, NativeMultisigAddress } from '../types';
import { bytesToParamsBase64 } from '../actorParams';
import { MULTISIG_STORAGE_KEY, readSavedMultisigs, saveMultisig } from '../storage';
import {
  MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY,
  readUncertainMultisigActions,
  removeUncertainCreateAction,
  writeUncertainMultisigActions,
} from '../actionStorage';
import {
  useMultisigs,
  type CreateMultisigResult,
  type MultisigCreateActionState,
  type MultisigProposalActionState,
  type UseMultisigsOptions,
  type UseMultisigsReturn,
} from '../useMultisigs';

const moduleMocks = vi.hoisted(() => ({
  getSnapshotTipSetKey: vi.fn(),
  loadActorState: vi.fn(),
  loadPendingProposals: vi.fn(),
  preflightCreateMultisig: vi.fn(),
  preflightProposalAction: vi.fn(),
}));

vi.mock('../rpc', async () => {
  const actual = await vi.importActual<typeof import('../rpc')>('../rpc');

  return {
    ...actual,
    getMultisigSnapshotTipSetKey: moduleMocks.getSnapshotTipSetKey,
    loadMultisigActorState: moduleMocks.loadActorState,
    loadMultisigPendingProposals: moduleMocks.loadPendingProposals,
  };
});

vi.mock('../preflight', async () => {
  const actual = await vi.importActual<typeof import('../preflight')>('../preflight');

  return {
    ...actual,
    preflightCreateMultisig: moduleMocks.preflightCreateMultisig,
    preflightProposalAction: moduleMocks.preflightProposalAction,
  };
});

const MULTISIG_A = newActorAddress(
  Uint8Array.from({ length: 16 }, (_, index) => index + 1),
  CoinType.TEST,
).toString() as NativeMultisigAddress;
const MULTISIG_B = newActorAddress(
  Uint8Array.from({ length: 16 }, (_, index) => index + 40),
  CoinType.TEST,
).toString() as NativeMultisigAddress;
const CID = 'bafy2bzacecltcibo6i2aewv7b3fz4f7cie26c5jminwhxs7iuttgzbtaptvui';
const SNAPSHOT_TIPSET_KEY = [{ '/': CID }] as const;
const REFRESH_SNAPSHOT_TIPSET_KEY = [
  { '/': 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo' },
] as const;
const SECOND_REFRESH_SNAPSHOT_TIPSET_KEY = [
  { '/': 'bafy2bzacebpekbxp7qyk4xx5r7es3t77sqcgdq5c7osfow4ayvbyyafwl4sxk' },
] as const;
const APPROVE_QUEUED_RETURN = 'g/QAQA==';
const APPROVE_APPLIED_FAILURE_RETURN = 'g/UYIUA=';
const SIGNER_A = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 10),
  CoinType.TEST,
).toString();
const SIGNER_B = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 60),
  CoinType.TEST,
).toString();
const SIGNER_C = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 100),
  CoinType.TEST,
).toString();
const CREATED_MULTISIG = newActorAddress(
  Uint8Array.from({ length: 16 }, (_, index) => index + 120),
  CoinType.TEST,
).toString() as NativeMultisigAddress;
const CREATED_MULTISIG_ID = newIDAddress(1234, CoinType.TEST).toString();

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
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

function createSender(address: string): NativeFilecoinConnectedSender {
  const result = createNativeFilecoinConnectedSender({
    address,
    provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
    expectedNetworkKey: 'calibration',
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create test sender.');
  }

  return result.sender;
}

function createActorState(
  address: NativeMultisigAddress,
  signerAddress = SIGNER_A,
  overrides: Partial<MultisigActorState> = {},
): MultisigActorState {
  return {
    address,
    networkKey: 'calibration',
    balanceAttoFil: 10n ** 20n,
    availableBalanceAttoFil: 10n ** 20n,
    threshold: 2,
    signers: [SIGNER_A, SIGNER_B],
    signerIdAddresses: ['t01001', 't01002'],
    signerIdentityStatusKnown: true,
    connectedSignerIdAddress: signerAddress === SIGNER_A ? 't01001' : 't01002',
    connectedSignerMembershipKnown: true,
    connectedSignerCanApprove: true,
    ...overrides,
  };
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function encodeCborByteString(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 24) {
    return concatBytes(Uint8Array.from([0x40 + bytes.length]), bytes);
  }

  return concatBytes(Uint8Array.from([0x58, bytes.length]), bytes);
}

function createExecReturnBase64(): string {
  const bytes = concatBytes(
    Uint8Array.from([0x82]),
    encodeCborByteString(newIDAddress(1234, CoinType.TEST).bytes),
    encodeCborByteString(
      newActorAddress(
        Uint8Array.from({ length: 16 }, (_, index) => index + 120),
        CoinType.TEST,
      ).bytes,
    ),
  );

  return bytesToParamsBase64(bytes);
}

function createProposal(id = 1): MultisigPendingProposal {
  return {
    id,
    proposer: 't01002',
    proposerIdAddress: 't01002',
    to: 't410fknownsendfiltarget',
    valueAttoFil: 1n,
    method: 3_844_450_837,
    paramsBase64: '',
    paramsBytes: new Uint8Array(),
    approvals: ['t01002'],
    approvalIdAddresses: ['t01002'],
    approvalStatusKnown: true,
    connectedSignerHasApproved: false,
    isSendFilCompatible: true,
    proposalHash: new Uint8Array(32),
    canApprove: true,
    canCancel: false,
  };
}

function createProvider(): NativeFilecoinWalletProvider {
  return {
    metadata: FILSNAP_FILECOIN_PROVIDER_METADATA,
    async connect() {
      return {
        address: SIGNER_A,
        networkKey: 'calibration',
        nativePrefix: 't',
      };
    },
    async disconnect() {
      return undefined;
    },
    async getAccount() {
      return {
        address: SIGNER_A,
        networkKey: 'calibration',
        nativePrefix: 't',
      };
    },
    getBalance: vi.fn(async () => 10n ** 20n),
    signAndSubmitMessage: vi.fn(async () => ({ cid: CID })),
  };
}

function seedStorage(storage: Storage, ...addresses: NativeMultisigAddress[]) {
  for (const address of addresses) {
    saveMultisig({ address, networkKey: 'calibration' }, storage);
  }
}

function createUncertainCreateState(signerAddress = SIGNER_A): MultisigCreateActionState {
  return {
    networkKey: 'calibration',
    chainId: 314159,
    networkLabel: 'Calibration Testnet',
    signerAddress,
    status: 'uncertain',
    cid: CID,
    warning: 'The submitted create still needs reconciliation.',
  };
}

function createUncertainProposalState(multisigAddress = MULTISIG_A): MultisigProposalActionState {
  return {
    action: 'cancel',
    proposalId: 7,
    multisigAddress,
    networkKey: 'calibration',
    chainId: 314159,
    networkLabel: 'Calibration Testnet',
    signerAddress: SIGNER_A,
    status: 'uncertain',
    cid: CID,
    error: 'The submitted cancellation still needs reconciliation.',
  };
}

function HookHarness({
  options,
  onValue,
}: {
  options: UseMultisigsOptions;
  onValue: (value: UseMultisigsReturn) => void;
}) {
  onValue(useMultisigs(options));
  return null;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useMultisigs selection lifecycle', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;
  let latestHook: UseMultisigsReturn | undefined;
  let currentOptions: UseMultisigsOptions;
  let storage: MemoryStorage;

  const renderHook = async (options: UseMultisigsOptions) => {
    currentOptions = options;
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
  };

  beforeEach(async () => {
    moduleMocks.getSnapshotTipSetKey.mockReset();
    moduleMocks.getSnapshotTipSetKey.mockResolvedValue(SNAPSHOT_TIPSET_KEY);
    moduleMocks.loadActorState.mockReset();
    moduleMocks.loadPendingProposals.mockReset();
    moduleMocks.preflightCreateMultisig.mockReset();
    moduleMocks.preflightProposalAction.mockReset();
    latestHook = undefined;
    storage = new MemoryStorage();
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
    seedStorage(storage, MULTISIG_A, MULTISIG_B);
    currentOptions = {
      sender: createSender(SIGNER_A),
      network: getNetworkConfig('calibration'),
      storage,
    };
    await renderHook(currentOptions);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('clears old actor and proposal state immediately when the selection changes', async () => {
    const pendingB = createDeferred<MultisigActorState>();
    seedStorage(storage, MULTISIG_A, MULTISIG_B);
    await renderHook(currentOptions);
    moduleMocks.loadActorState.mockImplementation(
      ({ address }: { address: NativeMultisigAddress }) =>
        address === MULTISIG_A ? Promise.resolve(createActorState(MULTISIG_A)) : pendingB.promise,
    );
    moduleMocks.loadPendingProposals.mockImplementation(
      ({ multisig }: { multisig: MultisigActorState }) =>
        Promise.resolve(multisig.address === MULTISIG_A ? [createProposal()] : []),
    );

    act(() => {
      latestHook!.selectMultisig(MULTISIG_A);
    });
    await flushAsyncWork();

    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_A);
    expect(latestHook?.pendingProposals).toHaveLength(1);

    act(() => {
      latestHook!.selectMultisig(MULTISIG_B);
    });

    expect(latestHook?.selectedAddress).toBe(MULTISIG_B);
    expect(latestHook?.selectedMultisig).toBeUndefined();
    expect(latestHook?.pendingProposals).toEqual([]);
    expect(latestHook?.isLoadingSelected).toBe(true);

    await act(async () => {
      pendingB.resolve(createActorState(MULTISIG_B));
      await pendingB.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_B);
  });

  it('shares one chain-head snapshot across selected actor and pending proposal reads', async () => {
    moduleMocks.getSnapshotTipSetKey.mockResolvedValue(SNAPSHOT_TIPSET_KEY);
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals.mockResolvedValue([createProposal()]);

    act(() => {
      latestHook!.selectMultisig(MULTISIG_A);
    });
    await flushAsyncWork();

    expect(moduleMocks.getSnapshotTipSetKey).toHaveBeenCalledTimes(1);
    expect(moduleMocks.loadActorState).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MULTISIG_A,
        tipSetKey: SNAPSHOT_TIPSET_KEY,
      }),
    );
    expect(moduleMocks.loadPendingProposals).toHaveBeenCalledWith(
      expect.objectContaining({
        multisig: expect.objectContaining({ address: MULTISIG_A }),
        tipSetKey: SNAPSHOT_TIPSET_KEY,
      }),
    );
  });

  it('acquires a fresh shared snapshot for every manual refresh', async () => {
    moduleMocks.getSnapshotTipSetKey
      .mockResolvedValueOnce(SNAPSHOT_TIPSET_KEY)
      .mockResolvedValueOnce(REFRESH_SNAPSHOT_TIPSET_KEY)
      .mockResolvedValueOnce(SECOND_REFRESH_SNAPSHOT_TIPSET_KEY);
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals.mockResolvedValue([createProposal()]);

    act(() => {
      latestHook!.selectMultisig(MULTISIG_A);
    });
    await flushAsyncWork();

    await act(async () => {
      await latestHook!.refreshSelected();
    });
    await act(async () => {
      await latestHook!.refreshSelected();
    });

    expect(moduleMocks.getSnapshotTipSetKey).toHaveBeenCalledTimes(3);
    expect(
      moduleMocks.loadActorState.mock.calls.map(([options]) => options.tipSetKey),
    ).toEqual([
      SNAPSHOT_TIPSET_KEY,
      REFRESH_SNAPSHOT_TIPSET_KEY,
      SECOND_REFRESH_SNAPSHOT_TIPSET_KEY,
    ]);
    expect(
      moduleMocks.loadPendingProposals.mock.calls.map(([options]) => options.tipSetKey),
    ).toEqual([
      SNAPSHOT_TIPSET_KEY,
      REFRESH_SNAPSHOT_TIPSET_KEY,
      SECOND_REFRESH_SNAPSHOT_TIPSET_KEY,
    ]);
  });

  it('does not let a late actor A response overwrite a loaded actor B', async () => {
    const pendingA = createDeferred<MultisigActorState>();
    const pendingB = createDeferred<MultisigActorState>();
    seedStorage(storage, MULTISIG_A, MULTISIG_B);
    await renderHook(currentOptions);
    moduleMocks.loadActorState.mockImplementation(
      ({ address }: { address: NativeMultisigAddress }) =>
        address === MULTISIG_A ? pendingA.promise : pendingB.promise,
    );
    moduleMocks.loadPendingProposals.mockResolvedValue([]);

    act(() => {
      latestHook!.selectMultisig(MULTISIG_A);
    });
    await flushAsyncWork();
    act(() => {
      latestHook!.selectMultisig(MULTISIG_B);
    });
    await flushAsyncWork();

    await act(async () => {
      pendingB.resolve(createActorState(MULTISIG_B));
      await pendingB.promise;
    });
    await flushAsyncWork();
    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_B);

    await act(async () => {
      pendingA.resolve(createActorState(MULTISIG_A));
      await pendingA.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.selectedAddress).toBe(MULTISIG_B);
    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_B);
  });

  it('identity-binds actor state to the current signer and network', async () => {
    const oldSignerResponse = createDeferred<MultisigActorState>();
    const newSignerResponse = createDeferred<MultisigActorState>();
    seedStorage(storage, MULTISIG_A);
    await renderHook(currentOptions);
    moduleMocks.loadActorState
      .mockImplementationOnce(() => oldSignerResponse.promise)
      .mockImplementationOnce(() => newSignerResponse.promise);
    moduleMocks.loadPendingProposals.mockResolvedValue([]);

    act(() => {
      latestHook!.selectMultisig(MULTISIG_A);
    });
    await flushAsyncWork();

    const signerBOptions = {
      ...currentOptions,
      sender: createSender(SIGNER_B),
    };
    await renderHook(signerBOptions);

    expect(latestHook?.selectedAddress).toBe(MULTISIG_A);
    expect(latestHook?.selectedMultisig).toBeUndefined();
    expect(latestHook?.isLoadingSelected).toBe(true);

    await act(async () => {
      newSignerResponse.resolve(createActorState(MULTISIG_A, SIGNER_B));
      await newSignerResponse.promise;
    });
    await flushAsyncWork();
    expect(latestHook?.selectedMultisig?.connectedSignerIdAddress).toBe('t01002');

    await act(async () => {
      oldSignerResponse.resolve(createActorState(MULTISIG_A, SIGNER_A));
      await oldSignerResponse.promise;
    });
    await flushAsyncWork();
    expect(latestHook?.selectedMultisig?.connectedSignerIdAddress).toBe('t01002');

    await renderHook({
      ...signerBOptions,
      network: getNetworkConfig('mainnet'),
      sender: undefined,
    });

    expect(latestHook?.selectedAddress).toBeUndefined();
    expect(latestHook?.selectedMultisig).toBeUndefined();
    expect(latestHook?.pendingProposals).toEqual([]);
  });

  it('loads and reconciles an uncertain proposal actor that is no longer saved', async () => {
    act(() => root.unmount());
    storage.clear();
    seedStorage(storage, MULTISIG_B);
    expect(
      writeUncertainMultisigActions([], [createUncertainProposalState()], storage),
    ).toBeUndefined();
    moduleMocks.loadActorState.mockImplementation(
      ({ address }: { address: NativeMultisigAddress }) =>
        Promise.resolve(createActorState(address)),
    );
    moduleMocks.loadPendingProposals.mockResolvedValue([]);
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
        receipt: { ExitCode: 0, Return: '', GasUsed: 1 },
      }),
    );
    root = createRoot(container);
    await renderHook({
      ...currentOptions,
      pollMessageStatus,
    });

    expect(latestHook?.savedMultisigs.map((item) => item.address)).toEqual([MULTISIG_B]);
    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'uncertain',
      multisigAddress: MULTISIG_A,
      cid: CID,
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();

    expect(latestHook?.selectedAddress).toBe(MULTISIG_A);
    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_A);

    await act(async () => {
      await latestHook!.recheckProposalAction();
    });

    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 1, 0, 'calibration');
    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'confirmed',
      outcome: 'cancelled',
      multisigAddress: MULTISIG_A,
      cid: CID,
    });
    expect(readUncertainMultisigActions(storage).proposals).toEqual([]);
  });

  it('exposes persisted proposal recovery guidance before the recorded signer reconnects', async () => {
    act(() => root.unmount());
    storage.clear();
    seedStorage(storage, MULTISIG_B);
    const uncertainProposal = createUncertainProposalState();
    expect(
      writeUncertainMultisigActions([], [uncertainProposal], storage),
    ).toBeUndefined();
    root = createRoot(container);

    await renderHook({
      network: getNetworkConfig('calibration'),
      storage,
    });

    expect(latestHook?.proposalActionState).toMatchObject(uncertainProposal);
    expect(latestHook?.isProposalRetryBlocked).toBe(false);
    expect(latestHook?.isCreateRetryBlocked).toBe(false);

    await renderHook({
      sender: createSender(SIGNER_B),
      network: getNetworkConfig('calibration'),
      storage,
    });

    expect(latestHook?.proposalActionState).toMatchObject(uncertainProposal);
    expect(latestHook?.isProposalRetryBlocked).toBe(false);

    await renderHook({
      sender: createSender(SIGNER_A),
      network: getNetworkConfig('calibration'),
      storage,
    });

    expect(latestHook?.proposalActionState).toMatchObject(uncertainProposal);
    expect(latestHook?.isProposalRetryBlocked).toBe(true);
    expect(latestHook?.isCreateRetryBlocked).toBe(true);
  });

  it('creates, confirms, persists, selects, and loads a multisig from ExecReturn', async () => {
    const provider = createProvider();
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: createExecReturnBase64(),
          GasUsed: 100,
        },
      }),
    );
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    moduleMocks.loadActorState.mockResolvedValue(
      createActorState(CREATED_MULTISIG, SIGNER_A, {
        idAddress: CREATED_MULTISIG_ID,
        threshold: 1,
        signers: [SIGNER_A],
        signerIdAddresses: ['t01001'],
      }),
    );
    moduleMocks.loadPendingProposals.mockResolvedValue([]);

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    let createdCid: string | undefined;
    let savedAddress: string | undefined;
    let createWarning: string | undefined;

    await act(async () => {
      const result = await latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });

      if (result.outcome !== 'confirmed') {
        throw new Error('Expected confirmed multisig creation');
      }

      createdCid = result.cid;
      savedAddress = result.savedMultisig?.address;
      createWarning = result.warning;
    });
    await flushAsyncWork();

    expect(moduleMocks.preflightCreateMultisig).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: currentOptions.sender,
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositAttoFil: 0n,
      }),
    );
    expect(provider.getBalance).toHaveBeenCalledWith({
      address: SIGNER_A,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(provider.getBalance).toHaveBeenCalledTimes(2);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledWith(
      { To: 't01' },
      expect.objectContaining({ onCidComputed: expect.any(Function) }),
    );
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
    expect(createdCid).toBe(CID);
    expect(savedAddress).toBe(CREATED_MULTISIG);
    expect(createWarning).toBeUndefined();
    expect(readSavedMultisigs('calibration', storage)).toEqual([
      expect.objectContaining({
        address: CREATED_MULTISIG,
        idAddress: CREATED_MULTISIG_ID,
      }),
      expect.anything(),
      expect.anything(),
    ]);
    expect(latestHook?.selectedAddress).toBe(CREATED_MULTISIG);
    expect(latestHook?.selectedMultisig?.address).toBe(CREATED_MULTISIG);
  });

  it.each([
    {
      balance: 0n,
      initialDepositFil: '0',
      expectedError: 'Connected signer has 0 FIL',
    },
    {
      balance: 500_000_000_000_000_000n,
      initialDepositFil: '0.5',
      expectedError: 'must be greater than the initial deposit',
    },
  ])(
    'blocks an unfunded creator before multisig preflight ($expectedError)',
    async ({ balance, initialDepositFil, expectedError }) => {
      const provider = createProvider();
      const pollMessageStatus = vi.fn();
      vi.mocked(provider.getBalance).mockResolvedValue(balance);

      await renderHook({
        ...currentOptions,
        provider,
        pollMessageStatus,
      });

      await act(async () => {
        await expect(
          latestHook!.createMultisig({
            signers: [SIGNER_A],
            threshold: 1,
            initialDepositFil,
          }),
        ).rejects.toThrow(expectedError);
      });

      expect(provider.getBalance).toHaveBeenCalledTimes(1);
      expect(moduleMocks.preflightCreateMultisig).not.toHaveBeenCalled();
      expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
      expect(pollMessageStatus).not.toHaveBeenCalled();
    },
  );

  it('single-flights direct create calls before the first balance read resolves', async () => {
    const initialBalance = createDeferred<bigint>();
    const provider = createProvider();
    vi.mocked(provider.getBalance).mockImplementationOnce(() => initialBalance.promise);

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    let firstCreate!: Promise<CreateMultisigResult>;
    act(() => {
      firstCreate = latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });

    expect(latestHook?.createActionState).toMatchObject({
      status: 'preparing',
      signerAddress: SIGNER_A,
      networkKey: 'calibration',
      chainId: 314159,
      networkLabel: 'Calibration Testnet',
    });
    expect(latestHook?.isCreateActionInFlight).toBe(true);

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('already in progress');
    });

    expect(provider.getBalance).toHaveBeenCalledTimes(1);
    expect(moduleMocks.preflightCreateMultisig).not.toHaveBeenCalled();

    await act(async () => {
      initialBalance.resolve(0n);
      await expect(firstCreate).rejects.toThrow('Connected signer has 0 FIL');
    });

    expect(latestHook?.createActionState).toMatchObject({
      status: 'failed',
      signerAddress: SIGNER_A,
      networkKey: 'calibration',
    });
    expect(latestHook?.isCreateActionInFlight).toBe(false);
  });

  it('rechecks the creator balance after gas estimation and immediately before signing', async () => {
    const provider = createProvider();
    vi.mocked(provider.getBalance)
      .mockResolvedValueOnce(2n * 10n ** 18n)
      .mockResolvedValueOnce(10n ** 18n);
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '1',
        }),
      ).rejects.toThrow('initial deposit plus creation gas');
    });

    expect(provider.getBalance).toHaveBeenCalledTimes(2);
    expect(moduleMocks.preflightCreateMultisig).toHaveBeenCalledTimes(1);
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
  });

  it('does not sign when the connected identity changes during create preflight', async () => {
    const balanceBeforeSigning = createDeferred<bigint>();
    const provider = createProvider();
    vi.mocked(provider.getBalance)
      .mockResolvedValueOnce(2n * 10n ** 18n)
      .mockImplementationOnce(() => balanceBeforeSigning.promise);
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    let createResult!: Promise<CreateMultisigResult>;
    act(() => {
      createResult = latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });
    await flushAsyncWork();

    await renderHook({
      ...currentOptions,
      sender: createSender(SIGNER_B),
      provider,
      pollMessageStatus: vi.fn(),
    });

    expect(latestHook?.isCreateActionInFlight).toBe(true);

    await act(async () => {
      balanceBeforeSigning.resolve(2n * 10n ** 18n);
      await expect(createResult).rejects.toThrow('signer or network changed');
    });

    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
    expect(latestHook?.createActionState).toBeUndefined();
    expect(latestHook?.isCreateActionInFlight).toBe(false);
  });

  it('returns the submitted CID as an uncertain outcome when confirmation polling fails', async () => {
    const provider = createProvider();
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'failed',
        error: 'Failed to fetch',
      }),
    );
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    let result: CreateMultisigResult | undefined;
    await act(async () => {
      result = await latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });

    expect(result).toMatchObject({
      cid: CID,
      outcome: 'uncertain',
      warning: expect.stringContaining('avoid creating a duplicate multisig'),
    });
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
    expect(latestHook?.createActionState).toMatchObject({
      status: 'uncertain',
      cid: CID,
      signerAddress: SIGNER_A,
      networkKey: 'calibration',
      chainId: 314159,
      networkLabel: 'Calibration Testnet',
    });
    expect(latestHook?.isCreateActionInFlight).toBe(false);
    expect(latestHook?.isCreateRetryBlocked).toBe(true);

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('still has an uncertain result');
    });

    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('reconciles a post-sign MpoolPush uncertainty by its deterministic CID', async () => {
    const provider = createProvider();
    const pollResult = createDeferred<TransactionStatus>();
    vi.mocked(provider.signAndSubmitMessage!).mockRejectedValue(
      new NativeFilecoinSubmissionUncertainError({
        cid: CID,
        networkKey: 'calibration',
        cause: new TypeError('Failed to fetch'),
      }),
    );
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    moduleMocks.loadActorState.mockResolvedValue(
      createActorState(CREATED_MULTISIG, SIGNER_A, {
        idAddress: CREATED_MULTISIG_ID,
        threshold: 1,
        signers: [SIGNER_A],
        signerIdAddresses: ['t01001'],
      }),
    );
    moduleMocks.loadPendingProposals.mockResolvedValue([]);

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(() => pollResult.promise),
    });

    let createResult!: Promise<CreateMultisigResult>;
    act(() => {
      createResult = latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });
    await flushAsyncWork();

    expect(latestHook?.createActionState).toMatchObject({
      status: 'pending',
      cid: CID,
      networkKey: 'calibration',
    });
    expect(latestHook?.isCreateActionInFlight).toBe(true);

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('already in progress');
    });

    await act(async () => {
      pollResult.resolve({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: createExecReturnBase64(),
          GasUsed: 100,
        },
      });
      await pollResult.promise;
      await expect(createResult).resolves.toMatchObject({
        outcome: 'confirmed',
        cid: CID,
        savedMultisig: expect.objectContaining({ address: CREATED_MULTISIG }),
      });
    });
    await flushAsyncWork();

    expect(latestHook?.createActionState).toMatchObject({
      status: 'confirmed',
      cid: CID,
      networkKey: 'calibration',
    });
    expect(latestHook?.isCreateActionInFlight).toBe(false);
    expect(latestHook?.isCreateRetryBlocked).toBe(false);
  });

  it.each([
    ['Error', () => new Error('wallet provider failed after broadcast')],
    ['TypeError', () => new TypeError('Failed to fetch after broadcast')],
  ])(
    'retains and reconciles a computed Create CID after a plain %s',
    async (_errorName, createError) => {
      const provider = createProvider();
      vi.mocked(provider.signAndSubmitMessage!).mockImplementation(async (_message, options) => {
        await options?.onCidComputed?.(CID);
        throw createError();
      });
      moduleMocks.preflightCreateMultisig.mockResolvedValue({
        estimatedMessage: { To: 't01' } as FilecoinMessage,
        gasEstimate: { estimatedFee: 1n },
      });
      const pollMessageStatus = vi.fn(
        async (): Promise<TransactionStatus> => ({
          cid: CID,
          status: 'failed',
          error: 'confirmation RPC timed out',
        }),
      );

      await renderHook({
        ...currentOptions,
        provider,
        pollMessageStatus,
      });

      let result!: CreateMultisigResult;
      await act(async () => {
        result = await latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        });
      });

      expect(result).toMatchObject({
        outcome: 'uncertain',
        cid: CID,
        warning: expect.stringContaining('after broadcast'),
      });
      expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
      expect(readUncertainMultisigActions(storage).creates).toMatchObject([
        { status: 'uncertain', cid: CID, signerAddress: SIGNER_A },
      ]);
      expect(latestHook?.isCreateRetryBlocked).toBe(true);

      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('still has an uncertain result');
      expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    },
  );

  it('retains the confirmed Create recovery lock when actor persistence fails', async () => {
    const provider = createProvider();
    const originalSetItem = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === MULTISIG_STORAGE_KEY) {
        throw new DOMException('simulated crash while saving actor', 'QuotaExceededError');
      }

      originalSetItem(key, value);
    });
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: createExecReturnBase64(),
          GasUsed: 100,
        },
      }),
    );

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    let result!: CreateMultisigResult;
    await act(async () => {
      result = await latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });

    expect(result).toMatchObject({
      outcome: 'confirmed',
      cid: CID,
      createdAddress: CREATED_MULTISIG,
      warning: expect.stringContaining('recovery lock was retained'),
    });
    if (result.outcome !== 'confirmed') {
      throw new Error('Expected confirmed multisig creation');
    }
    expect(result.savedMultisig).toBeUndefined();
    expect(readSavedMultisigs('calibration', storage).map((item) => item.address)).not.toContain(
      CREATED_MULTISIG,
    );
    expect(readUncertainMultisigActions(storage).creates).toMatchObject([
      { status: 'uncertain', cid: CID, signerAddress: SIGNER_A },
    ]);
    expect(latestHook?.isCreateRetryBlocked).toBe(true);

    await expect(
      latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      }),
    ).rejects.toThrow('still has an uncertain result');
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'a different signer',
      sender: () => createSender(SIGNER_B),
      expectedRecheckError: 'There is no uncertain multisig creation to recheck for this signer.',
    },
    {
      label: 'no connected signer',
      sender: () => undefined,
      expectedRecheckError: 'Reconnect the native Filecoin signer used for this creation first.',
    },
  ] as const)(
    'exposes global create recovery to $label without applying its identity lock',
    async ({ sender, expectedRecheckError }) => {
      act(() => root.unmount());
      expect(
        writeUncertainMultisigActions([createUncertainCreateState()], [], storage),
      ).toBeUndefined();
      const pollMessageStatus = vi.fn();
      root = createRoot(container);
      await renderHook({
        ...currentOptions,
        sender: sender(),
        pollMessageStatus,
      });

      expect(latestHook?.createActionState).toMatchObject({
        status: 'uncertain',
        signerAddress: SIGNER_A,
        networkKey: 'calibration',
        cid: CID,
      });
      expect(latestHook?.isCreateRetryBlocked).toBe(false);
      await expect(latestHook!.recheckCreateAction()).rejects.toThrow(expectedRecheckError);
      expect(pollMessageStatus).not.toHaveBeenCalled();
    },
  );

  it('restores a CID safety lock after remounting while create confirmation is pending', async () => {
    const provider = createProvider();
    const pendingPoll = createDeferred<TransactionStatus>();
    const pollMessageStatus = vi.fn(() => pendingPoll.promise);
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    act(() => {
      void latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });
    await flushAsyncWork();

    expect(latestHook?.createActionState).toMatchObject({
      status: 'pending',
      cid: CID,
    });
    expect(readUncertainMultisigActions(storage).creates).toMatchObject([
      { status: 'uncertain', cid: CID, signerAddress: SIGNER_A },
    ]);

    act(() => root.unmount());
    root = createRoot(container);
    const confirmedPoll = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: createExecReturnBase64(),
          GasUsed: 1,
        },
      }),
    );

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: confirmedPoll,
    });

    expect(latestHook?.isCreateRetryBlocked).toBe(true);
    expect(latestHook?.createActionState).toMatchObject({
      status: 'uncertain',
      cid: CID,
    });
    await expect(
      latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      }),
    ).rejects.toThrow('still has an uncertain result');

    await act(async () => {
      await latestHook!.recheckCreateAction();
    });

    expect(confirmedPoll).toHaveBeenCalledWith(CID, 1, 0, 'calibration');
    expect(latestHook?.createActionState).toMatchObject({
      status: 'confirmed',
      cid: CID,
      createdAddress: CREATED_MULTISIG,
    });
    expect(latestHook?.isCreateRetryBlocked).toBe(false);
    expect(readUncertainMultisigActions(storage).creates).toEqual([]);
  });

  it('persists the computed CID before MpoolPush settles and blocks a stale hook in another tab', async () => {
    const submitResult = createDeferred<{ cid: string }>();
    const provider = createProvider();
    vi.mocked(provider.signAndSubmitMessage!).mockImplementation(async (_message, options) => {
      await options?.onCidComputed?.(CID);
      return submitResult.promise;
    });
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    const secondContainer = document.createElement('div');
    document.body.appendChild(secondContainer);
    const secondRoot = createRoot(secondContainer);
    let submittingHook: UseMultisigsReturn | undefined;

    await act(async () => {
      secondRoot.render(
        <HookHarness
          options={{
            ...currentOptions,
            provider,
            pollMessageStatus: vi.fn(),
          }}
          onValue={(value) => {
            submittingHook = value;
          }}
        />,
      );
    });

    act(() => {
      void submittingHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });
    await flushAsyncWork();

    expect(submittingHook?.createActionState).toMatchObject({
      status: 'submitting',
      cid: CID,
    });
    expect(readUncertainMultisigActions(storage).creates).toMatchObject([
      { cid: CID, signerAddress: SIGNER_A },
    ]);
    await expect(
      latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      }),
    ).rejects.toThrow('still has an uncertain result');

    act(() => secondRoot.unmount());
    secondContainer.remove();
  });

  it('blocks before wallet signing when readable uncertainty storage is not writable', async () => {
    const provider = createProvider();
    const originalSetItem = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY) {
        throw new DOMException('storage full', 'QuotaExceededError');
      }

      originalSetItem(key, value);
    });
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('could not save the uncertainty safety lock');
    });

    expect(latestHook?.createActionState).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('could not save the uncertainty safety lock'),
    });
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
    expect(latestHook?.isCreateActionInFlight).toBe(false);
    expect(latestHook?.isCreateRetryBlocked).toBe(true);
  });

  it('aborts before MpoolPush when the post-sign CID lock write races into failure', async () => {
    const provider = createProvider();
    let pushAttempted = false;
    vi.mocked(provider.signAndSubmitMessage!).mockImplementation(async (_message, options) => {
      await options?.onCidComputed?.(CID);
      pushAttempted = true;
      return { cid: CID };
    });
    const originalSetItem = storage.setItem.bind(storage);
    let actionStorageWriteCount = 0;
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY) {
        actionStorageWriteCount += 1;

        if (actionStorageWriteCount === 2) {
          throw new DOMException('storage full', 'QuotaExceededError');
        }
      }

      originalSetItem(key, value);
    });
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('could not save the uncertainty safety lock');
    });

    expect(pushAttempted).toBe(false);
    expect(latestHook?.createActionState).toMatchObject({ status: 'failed' });
    expect(readUncertainMultisigActions(storage).creates).toEqual([]);
  });

  it('fails closed when the persisted uncertainty safety record cannot be parsed', async () => {
    storage.setItem(MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY, '{malformed');
    act(() => root.unmount());
    root = createRoot(container);
    const provider = createProvider();

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    expect(latestHook?.uncertaintyStorageError).toContain('could not safely read');
    expect(latestHook?.isCreateRetryBlocked).toBe(true);
    expect(latestHook?.isProposalRetryBlocked).toBe(true);
    await expect(
      latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      }),
    ).rejects.toThrow('could not safely read');
    expect(provider.getBalance).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'confirmed status with a nonzero receipt',
      status: {
        cid: CID,
        status: 'confirmed',
        receipt: { ExitCode: 17, Return: '', GasUsed: 100 },
      } satisfies TransactionStatus,
    },
    {
      label: 'failed status with a zero-exit receipt',
      status: {
        cid: CID,
        status: 'failed',
        receipt: { ExitCode: 0, Return: createExecReturnBase64(), GasUsed: 100 },
      } satisfies TransactionStatus,
    },
  ])('keeps create retry blocked for an inconclusive $label', async ({ status }) => {
    const provider = createProvider();
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(async () => status),
    });

    let result!: CreateMultisigResult;
    await act(async () => {
      result = await latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      });
    });

    expect(result.outcome).toBe('uncertain');
    expect(latestHook?.createActionState).toMatchObject({ status: 'uncertain', cid: CID });
    expect(latestHook?.isCreateRetryBlocked).toBe(true);
  });

  it('clears the create safety lock after a receipt proves terminal failure', async () => {
    const provider = createProvider();
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(
        async (): Promise<TransactionStatus> => ({
          cid: CID,
          status: 'failed',
          receipt: { ExitCode: 17, Return: '', GasUsed: 100 },
        }),
      ),
    });

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('outer exit code 17');
    });

    expect(latestHook?.createActionState).toMatchObject({ status: 'failed', cid: CID });
    expect(latestHook?.isCreateRetryBlocked).toBe(false);
    expect(readUncertainMultisigActions(storage).creates).toEqual([]);
  });

  it('does not persist or select a confirmed create with a missing or malformed ExecReturn', async () => {
    const provider = createProvider();
    const pollMessageStatus = vi
      .fn<() => Promise<TransactionStatus>>()
      .mockResolvedValueOnce({
        cid: CID,
        status: 'confirmed',
        receipt: { ExitCode: 0, Return: '', GasUsed: 100 },
      })
      .mockResolvedValueOnce({
        cid: CID,
        status: 'confirmed',
        receipt: { ExitCode: 0, Return: 'AA==', GasUsed: 100 },
      });
    moduleMocks.preflightCreateMultisig.mockResolvedValue({
      estimatedMessage: { To: 't01' } as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });

    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    const warnings: string[] = [];

    for (const signer of [SIGNER_A, SIGNER_B]) {
      await renderHook({
        ...currentOptions,
        sender: createSender(signer),
        provider,
        pollMessageStatus,
      });

      if (signer === SIGNER_B) {
        expect(latestHook?.isCreateRetryBlocked).toBe(false);
      }

      await act(async () => {
        const result = await latestHook!.createMultisig({
          signers: [signer],
          threshold: 1,
          initialDepositFil: '0',
        });

        if (result.outcome !== 'uncertain') {
          throw new Error('Expected uncertain multisig creation');
        }

        warnings.push(result.warning);
      });

      expect(latestHook?.isCreateRetryBlocked).toBe(true);

      if (signer === SIGNER_A) {
        const uncertainCreate = readUncertainMultisigActions(storage).creates.find(
          (state) => state.signerAddress === signer,
        );

        if (!uncertainCreate) {
          throw new Error('Expected the first uncertain create safety record');
        }

        expect(removeUncertainCreateAction(uncertainCreate, storage).error).toBeUndefined();
      }
    }

    await renderHook({
      ...currentOptions,
      sender: createSender(SIGNER_A),
      provider,
      pollMessageStatus,
    });

    expect(latestHook?.isCreateRetryBlocked).toBe(true);

    await act(async () => {
      await expect(
        latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        }),
      ).rejects.toThrow('still has an uncertain result');
    });

    expect(readSavedMultisigs('calibration', storage).map((item) => item.address)).toEqual([
      MULTISIG_B,
      MULTISIG_A,
    ]);
    expect(warnings).toEqual([
      expect.stringContaining('could not confirm the result'),
      expect.stringContaining('could not confirm the result'),
    ]);
    expect(warnings.every((warning) => warning?.includes(CID))).toBe(true);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(2);
    expect(pollMessageStatus).toHaveBeenCalledTimes(2);
    expect(latestHook?.selectedAddress).toBeUndefined();
    expect(moduleMocks.loadActorState).not.toHaveBeenCalled();
  });

  it('does not let delayed action polling refresh a superseded selection', async () => {
    const pollResult = createDeferred<TransactionStatus>();
    const proposal = createProposal();
    const provider = createProvider();
    seedStorage(storage, MULTISIG_A, MULTISIG_B);
    moduleMocks.loadActorState.mockImplementation(
      ({ address }: { address: NativeMultisigAddress }) =>
        Promise.resolve(createActorState(address)),
    );
    moduleMocks.loadPendingProposals.mockImplementation(
      ({ multisig }: { multisig: MultisigActorState }) =>
        Promise.resolve(multisig.address === MULTISIG_A ? [proposal] : []),
    );
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    const pollMessageStatus = vi.fn(() => pollResult.promise);
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    act(() => {
      latestHook!.selectMultisig(MULTISIG_A);
    });
    await flushAsyncWork();
    await act(async () => {
      await expect(latestHook!.approveProposal(proposal)).resolves.toBe(CID);
    });

    act(() => {
      latestHook!.selectMultisig(MULTISIG_B);
    });
    await flushAsyncWork();
    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_B);
    const actorLoadCountBeforePoll = moduleMocks.loadActorState.mock.calls.length;

    await act(async () => {
      pollResult.resolve({ cid: CID, status: 'confirmed' });
      await pollResult.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.selectedAddress).toBe(MULTISIG_B);
    expect(latestHook?.selectedMultisig?.address).toBe(MULTISIG_B);
    expect(moduleMocks.loadActorState).toHaveBeenCalledTimes(actorLoadCountBeforePoll);
  });

  it('single-flights approvals through confirmation and reports a queued outcome', async () => {
    const pollResult = createDeferred<TransactionStatus>();
    const proposal = createProposal();
    const refreshedProposal: MultisigPendingProposal = {
      ...proposal,
      approvals: ['t01002', 't01001'],
      approvalIdAddresses: ['t01002', 't01001'],
      connectedSignerHasApproved: true,
      canApprove: false,
    };
    const provider = createProvider();
    moduleMocks.getSnapshotTipSetKey
      .mockResolvedValueOnce(SNAPSHOT_TIPSET_KEY)
      .mockResolvedValueOnce(REFRESH_SNAPSHOT_TIPSET_KEY)
      .mockResolvedValueOnce(SECOND_REFRESH_SNAPSHOT_TIPSET_KEY);
    moduleMocks.loadActorState.mockResolvedValue(
      createActorState(MULTISIG_A, SIGNER_A, {
        threshold: 3,
        signers: [SIGNER_A, SIGNER_B, SIGNER_C],
        signerIdAddresses: ['t01001', 't01002', 't01003'],
      }),
    );
    moduleMocks.loadPendingProposals
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([refreshedProposal]);
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(() => pollResult.promise),
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();

    await act(async () => {
      await expect(latestHook!.approveProposal(proposal)).resolves.toBe(CID);
    });

    expect(latestHook?.proposalActionState).toMatchObject({
      action: 'approve',
      proposalId: proposal.id,
      status: 'pending',
      cid: CID,
    });
    await expect(latestHook!.approveProposal(proposal)).rejects.toThrow('still in progress');
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      pollResult.resolve({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: APPROVE_QUEUED_RETURN,
          GasUsed: 100,
        },
      });
      await pollResult.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'confirmed',
      outcome: 'queued',
      cid: CID,
    });
    expect(moduleMocks.loadActorState).toHaveBeenCalledTimes(3);
    expect(moduleMocks.loadPendingProposals).toHaveBeenCalledTimes(3);
    expect(
      moduleMocks.loadActorState.mock.calls.map(([options]) => options.tipSetKey),
    ).toEqual([
      SNAPSHOT_TIPSET_KEY,
      REFRESH_SNAPSHOT_TIPSET_KEY,
      SECOND_REFRESH_SNAPSHOT_TIPSET_KEY,
    ]);
    expect(
      moduleMocks.loadPendingProposals.mock.calls.map(([options]) => options.tipSetKey),
    ).toEqual([
      SNAPSHOT_TIPSET_KEY,
      REFRESH_SNAPSHOT_TIPSET_KEY,
      SECOND_REFRESH_SNAPSHOT_TIPSET_KEY,
    ]);
    expect(latestHook?.pendingProposals[0]).toMatchObject({
      id: proposal.id,
      connectedSignerHasApproved: true,
      canApprove: false,
    });
  });

  it('reconciles an approval MpoolPush response loss by CID and blocks duplicate actions', async () => {
    const firstPoll = createDeferred<TransactionStatus>();
    const proposal = createProposal();
    const provider = createProvider();
    vi.mocked(provider.signAndSubmitMessage!).mockRejectedValue(
      new NativeFilecoinSubmissionUncertainError({
        cid: CID,
        networkKey: 'calibration',
        cause: new Error('MpoolPush response was lost'),
      }),
    );
    moduleMocks.loadActorState.mockImplementation(
      ({ address }: { address: NativeMultisigAddress }) =>
        Promise.resolve(createActorState(address)),
    );
    moduleMocks.loadPendingProposals.mockResolvedValue([proposal]);
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    const pollMessageStatus = vi
      .fn<() => Promise<TransactionStatus>>()
      .mockImplementationOnce(() => firstPoll.promise)
      .mockResolvedValueOnce({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: APPROVE_QUEUED_RETURN,
          GasUsed: 100,
        },
      });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();

    await act(async () => {
      await expect(latestHook!.approveProposal(proposal)).resolves.toBe(CID);
    });

    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'pending',
      cid: CID,
    });
    expect(readUncertainMultisigActions(storage).proposals).toMatchObject([
      { action: 'approve', cid: CID, multisigAddress: MULTISIG_A },
    ]);
    await expect(latestHook!.cancelProposal(proposal)).rejects.toThrow('still in progress');

    await act(async () => {
      firstPoll.resolve({
        cid: CID,
        status: 'failed',
        error: 'confirmation RPC timed out',
      });
      await firstPoll.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'uncertain',
      cid: CID,
    });
    expect(latestHook?.isProposalRetryBlocked).toBe(true);
    await expect(latestHook!.approveProposal(proposal)).rejects.toThrow(
      'still has an uncertain result',
    );

    await act(async () => {
      await latestHook!.recheckProposalAction();
    });

    expect(pollMessageStatus).toHaveBeenLastCalledWith(CID, 1, 0, 'calibration');
    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'confirmed',
      outcome: 'queued',
      cid: CID,
    });
    expect(latestHook?.isProposalRetryBlocked).toBe(false);
    expect(readUncertainMultisigActions(storage).proposals).toEqual([]);
  });

  it.each([
    {
      action: 'approve' as const,
      createError: () => new Error('approval provider failed after broadcast'),
    },
    {
      action: 'cancel' as const,
      createError: () => new TypeError('cancellation fetch failed after broadcast'),
    },
  ])(
    'retains and reconciles a computed CID when $action throws a plain provider error',
    async ({ action, createError }) => {
      const proposal: MultisigPendingProposal =
        action === 'approve'
          ? createProposal()
          : {
              ...createProposal(),
              proposer: 't01001',
              proposerIdAddress: 't01001',
              approvals: ['t01001'],
              approvalIdAddresses: ['t01001'],
              connectedSignerHasApproved: true,
              canApprove: false,
              canCancel: true,
            };
      const provider = createProvider();
      vi.mocked(provider.signAndSubmitMessage!).mockImplementation(async (_message, options) => {
        await options?.onCidComputed?.(CID);
        throw createError();
      });
      moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
      moduleMocks.loadPendingProposals.mockResolvedValue([proposal]);
      moduleMocks.preflightProposalAction.mockResolvedValue({
        estimatedMessage: {} as FilecoinMessage,
        gasEstimate: { estimatedFee: 1n },
      });
      const pollMessageStatus = vi.fn(
        async (): Promise<TransactionStatus> => ({
          cid: CID,
          status: 'failed',
          error: 'confirmation RPC timed out',
        }),
      );

      await renderHook({
        ...currentOptions,
        provider,
        pollMessageStatus,
      });

      act(() => latestHook!.selectMultisig(MULTISIG_A));
      await flushAsyncWork();
      const submitAction = () =>
        action === 'approve'
          ? latestHook!.approveProposal(proposal)
          : latestHook!.cancelProposal(proposal);

      await act(async () => {
        await expect(submitAction()).resolves.toBe(CID);
      });
      await flushAsyncWork();

      expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
      expect(latestHook?.proposalActionState).toMatchObject({
        action,
        status: 'uncertain',
        cid: CID,
        error: expect.stringContaining('after broadcast'),
      });
      expect(readUncertainMultisigActions(storage).proposals).toMatchObject([
        { action, status: 'uncertain', cid: CID, multisigAddress: MULTISIG_A },
      ]);
      expect(latestHook?.isProposalRetryBlocked).toBe(true);

      await expect(submitAction()).rejects.toThrow('still has an uncertain result');
      expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks every multisig action for the signer while another actor has an uncertain CID', async () => {
    const proposal = createProposal();
    const provider = createProvider();
    vi.mocked(provider.signAndSubmitMessage!).mockRejectedValue(
      new NativeFilecoinSubmissionUncertainError({
        cid: CID,
        networkKey: 'calibration',
        cause: new Error('MpoolPush response was lost'),
      }),
    );
    seedStorage(storage, MULTISIG_A, MULTISIG_B);
    moduleMocks.loadActorState.mockImplementation(
      ({ address }: { address: NativeMultisigAddress }) =>
        Promise.resolve(createActorState(address)),
    );
    moduleMocks.loadPendingProposals.mockResolvedValue([proposal]);
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    const pollMessageStatus = vi.fn().mockResolvedValue({
      cid: CID,
      status: 'failed',
      error: 'confirmation RPC timed out',
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus,
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();
    await act(async () => {
      await expect(latestHook!.approveProposal(proposal)).resolves.toBe(CID);
    });
    await flushAsyncWork();

    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'uncertain',
      multisigAddress: MULTISIG_A,
      cid: CID,
    });

    act(() => latestHook!.selectMultisig(MULTISIG_B));
    await flushAsyncWork();

    expect(latestHook?.selectedAddress).toBe(MULTISIG_B);
    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'uncertain',
      multisigAddress: MULTISIG_A,
      cid: CID,
    });
    expect(latestHook?.isProposalRetryBlocked).toBe(true);
    expect(latestHook?.isCreateRetryBlocked).toBe(true);
    await expect(latestHook!.approveProposal(proposal)).rejects.toThrow(
      'still has an uncertain result',
    );
    await expect(
      latestHook!.createMultisig({
        signers: [SIGNER_A],
        threshold: 1,
        initialDepositFil: '0',
      }),
    ).rejects.toThrow('still has an uncertain result');
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('persists an approval CID before MpoolPush settles', async () => {
    const submitResult = createDeferred<{ cid: string }>();
    const proposal = createProposal();
    const provider = createProvider();
    vi.mocked(provider.signAndSubmitMessage!).mockImplementation(async (_message, options) => {
      await options?.onCidComputed?.(CID);
      return submitResult.promise;
    });
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals.mockResolvedValue([proposal]);
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();
    act(() => {
      void latestHook!.approveProposal(proposal);
    });
    await flushAsyncWork();

    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'submitting',
      cid: CID,
      action: 'approve',
    });
    expect(readUncertainMultisigActions(storage).proposals).toMatchObject([
      { cid: CID, multisigAddress: MULTISIG_A, action: 'approve' },
    ]);
    await expect(latestHook!.cancelProposal(proposal)).rejects.toThrow('still in progress');
  });

  it('confirms cancellation and positively refreshes actor and pending state', async () => {
    const pollResult = createDeferred<TransactionStatus>();
    const proposal: MultisigPendingProposal = {
      ...createProposal(),
      proposer: 't01001',
      proposerIdAddress: 't01001',
      approvals: ['t01001'],
      approvalIdAddresses: ['t01001'],
      connectedSignerHasApproved: true,
      canApprove: false,
      canCancel: true,
    };
    const provider = createProvider();
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([]);
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(() => pollResult.promise),
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();

    await act(async () => {
      await expect(latestHook!.cancelProposal(proposal)).resolves.toBe(CID);
    });

    expect(moduleMocks.preflightProposalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal,
        action: 'cancel',
      }),
    );
    expect(latestHook?.proposalActionState).toMatchObject({
      action: 'cancel',
      status: 'pending',
      cid: CID,
    });

    await act(async () => {
      pollResult.resolve({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: '',
          GasUsed: 100,
        },
      });
      await pollResult.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.proposalActionState).toMatchObject({
      action: 'cancel',
      status: 'confirmed',
      outcome: 'cancelled',
      cid: CID,
    });
    expect(moduleMocks.loadActorState).toHaveBeenCalledTimes(3);
    expect(moduleMocks.loadPendingProposals).toHaveBeenCalledTimes(3);
    expect(latestHook?.pendingProposals).toEqual([]);
  });

  it('surfaces an inner batch failure from the final approval', async () => {
    const pollResult = createDeferred<TransactionStatus>();
    const proposal = createProposal();
    const provider = createProvider();
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals.mockResolvedValue([proposal]);
    moduleMocks.preflightProposalAction.mockResolvedValue({
      estimatedMessage: {} as FilecoinMessage,
      gasEstimate: { estimatedFee: 1n },
    });
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(() => pollResult.promise),
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();
    await act(async () => {
      await latestHook!.approveProposal(proposal);
    });

    await act(async () => {
      pollResult.resolve({
        cid: CID,
        status: 'confirmed',
        receipt: {
          ExitCode: 0,
          Return: APPROVE_APPLIED_FAILURE_RETURN,
          GasUsed: 100,
        },
      });
      await pollResult.promise;
    });
    await flushAsyncWork();

    expect(latestHook?.proposalActionState).toMatchObject({
      status: 'failed',
      cid: CID,
      error: expect.stringContaining('inner exit code 33'),
    });
  });

  it('revalidates the actor and proposal policy immediately before signing', async () => {
    const proposal = createProposal();
    const provider = createProvider();
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([{ ...proposal, canApprove: false }]);
    await renderHook({
      ...currentOptions,
      provider,
      pollMessageStatus: vi.fn(),
    });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();

    await act(async () => {
      await expect(latestHook!.approveProposal(proposal)).rejects.toThrow(
        'no longer passes SendFIL approval checks',
      );
    });

    expect(moduleMocks.loadActorState).toHaveBeenCalledTimes(2);
    expect(moduleMocks.loadPendingProposals).toHaveBeenCalledTimes(2);
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
  });

  it('enforces duplicate-payment acknowledgment below the UI boundary', async () => {
    const proposal = createProposal();
    proposal.decodedBatch = {
      executionMethod: 'STANDARD',
      errorMode: 'ATOMIC',
      recipientCount: 2,
      totalValueAttoFil: '2',
      payments: [
        {
          index: 0,
          kind: 'FILECOIN',
          recipient: SIGNER_B,
          amountAttoFil: '1',
        },
        {
          index: 1,
          kind: 'FILECOIN',
          recipient: SIGNER_B,
          amountAttoFil: '1',
        },
      ],
    };
    const provider = createProvider();
    moduleMocks.loadActorState.mockResolvedValue(createActorState(MULTISIG_A));
    moduleMocks.loadPendingProposals.mockResolvedValue([proposal]);
    await renderHook({ ...currentOptions, provider, pollMessageStatus: vi.fn() });

    act(() => latestHook!.selectMultisig(MULTISIG_A));
    await flushAsyncWork();

    await act(async () => {
      await expect(latestHook!.approveProposal(proposal)).rejects.toThrow(
        'Acknowledge the duplicate proposal payments',
      );
    });

    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
  });
});
