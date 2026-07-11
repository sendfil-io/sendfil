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
  createNativeFilecoinConnectedSender,
  type NativeFilecoinConnectedSender,
  type NativeFilecoinWalletProvider,
} from '../../senders';
import type { FilecoinMessage, TransactionStatus } from '../../DataProvider/types';
import type { MultisigActorState, MultisigPendingProposal, NativeMultisigAddress } from '../types';
import { bytesToParamsBase64 } from '../actorParams';
import { readSavedMultisigs, saveMultisig } from '../storage';
import { useMultisigs, type UseMultisigsOptions, type UseMultisigsReturn } from '../useMultisigs';

const moduleMocks = vi.hoisted(() => ({
  loadActorState: vi.fn(),
  loadPendingProposals: vi.fn(),
  preflightCreateMultisig: vi.fn(),
  preflightProposalAction: vi.fn(),
}));

vi.mock('../rpc', async () => {
  const actual = await vi.importActual<typeof import('../rpc')>('../rpc');

  return {
    ...actual,
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

const MULTISIG_A = 't2multisig-a' as NativeMultisigAddress;
const MULTISIG_B = 't2multisig-b' as NativeMultisigAddress;
const CID = 'bafy2bzacedactioncid';
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
    connectedSignerIdAddress: signerAddress === SIGNER_A ? 't01001' : 't01002',
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
    moduleMocks.loadActorState.mockReset();
    moduleMocks.loadPendingProposals.mockReset();
    moduleMocks.preflightCreateMultisig.mockReset();
    moduleMocks.preflightProposalAction.mockReset();
    latestHook = undefined;
    storage = new MemoryStorage();
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
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
    expect(provider.signAndSubmitMessage).toHaveBeenCalledWith({ To: 't01' });
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

    const warnings: Array<string | undefined> = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let savedAddress: string | undefined;

      await act(async () => {
        const result = await latestHook!.createMultisig({
          signers: [SIGNER_A],
          threshold: 1,
          initialDepositFil: '0',
        });
        savedAddress = result.savedMultisig?.address;
        warnings.push(result.warning);
      });

      expect(savedAddress).toBeUndefined();
    }

    expect(readSavedMultisigs('calibration', storage).map((item) => item.address)).toEqual([
      MULTISIG_B,
      MULTISIG_A,
    ]);
    expect(warnings).toEqual([
      expect.stringContaining('could not verify the new multisig address'),
      expect.stringContaining('could not verify the new multisig address'),
    ]);
    expect(warnings.every((warning) => warning?.includes(CID))).toBe(true);
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
    expect(latestHook?.pendingProposals[0]).toMatchObject({
      id: proposal.id,
      connectedSignerHasApproved: true,
      canApprove: false,
    });
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
