import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { CoinType, newActorAddress, newSecp256k1Address } from '@glif/filecoin-address';
import { FILSNAP_FILECOIN_PROVIDER_METADATA } from '../../senders';
import { createNativeFilecoinConnectedSender } from '../../senders/senderModel';
import type { NativeFilecoinWalletProvider } from '../../senders/types';
import type { FilecoinMessage, TransactionStatus } from '../../DataProvider/types';
import type { SendFilNetworkKey } from '../../networks';
import { getNetworkConfig } from '../../networks';
import type { BatchExecutionRecipient, BatchGasEstimate } from '../../transaction/batchExecution';
import { BatchExecutionError } from '../../transaction/errorHandling';
import type { MultisigActorState } from '../types';
import type { MultisigPreflightRpc } from '../preflight';
import {
  useExecuteMultisigProposal,
  type UseExecuteMultisigProposalReturn,
} from '../useExecuteMultisigProposal';

const SIGNER_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();
const RECIPIENT_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 80),
  CoinType.TEST,
).toString();
const MULTISIG_T2 = newActorAddress(
  Uint8Array.from({ length: 20 }, (_, index) => index + 1),
  CoinType.TEST,
).toString() as `t2${string}`;
const MULTISIG_CODE = 'bafk2bzaceamultisigactorcode';
const CID = 'bafy2bzacedmultisigproposalcid';
const PROPOSE_QUEUED_RETURN = 'hAf0AEA=';
const PROPOSE_APPLIED_SUCCESS_RETURN = 'hAn1AELerQ==';
const PROPOSE_APPLIED_FAILURE_RETURN = 'hAr1GCFCAQI=';

const recipients: BatchExecutionRecipient[] = [{ address: RECIPIENT_T1, amount: 1 }];

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function getNativeSender() {
  const result = createNativeFilecoinConnectedSender({
    address: SIGNER_T1,
    provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create native sender');
  }

  return result.sender;
}

function getMultisig(overrides: Partial<MultisigActorState> = {}): MultisigActorState {
  return {
    address: MULTISIG_T2,
    networkKey: 'calibration',
    balanceAttoFil: 10n ** 21n,
    availableBalanceAttoFil: 10n ** 21n,
    threshold: 2,
    signers: ['t01001'],
    signerIdAddresses: ['t01001'],
    connectedSignerIdAddress: 't01001',
    connectedSignerCanApprove: true,
    ...overrides,
  };
}

function getRpc(availableBalance = 10n ** 21n): MultisigPreflightRpc {
  return {
    getNonce: vi.fn(async (address: string, networkKey: SendFilNetworkKey) => {
      void address;
      void networkKey;

      return 5;
    }),
    estimateGas: vi.fn(async (message: FilecoinMessage, networkKey: SendFilNetworkKey) => {
      void networkKey;

      return {
        ...message,
        GasLimit: 10_000,
        GasFeeCap: '1000',
        GasPremium: '10',
      };
    }),
    multisig: {
      getActor: vi.fn(async () => ({
        Code: { '/': MULTISIG_CODE },
        Head: { '/': 'bafyhead' },
        Nonce: 0,
        Balance: availableBalance.toString(),
      })),
      readState: vi.fn(async () => ({
        Balance: availableBalance.toString(),
        State: {
          Signers: [SIGNER_T1],
          NumApprovalsThreshold: 1,
        },
      })),
      lookupID: vi.fn(async (address: string) => (address === SIGNER_T1 ? 't01001' : 't01002')),
      lookupRobustAddress: vi.fn(async () => MULTISIG_T2),
      getBalance: vi.fn(async () => availableBalance),
      getAvailableBalance: vi.fn(async () => availableBalance),
      getVestingSchedule: vi.fn(async () => undefined),
      getPending: vi.fn(),
      getNetworkVersion: vi.fn(async () => 25),
      getActorCodeCids: vi.fn(async () => ({
        multisig: { '/': MULTISIG_CODE },
      })),
      estimateGas: vi.fn(),
    },
  };
}

function getProvider(balance: bigint): NativeFilecoinWalletProvider {
  return {
    metadata: FILSNAP_FILECOIN_PROVIDER_METADATA,
    async connect() {
      return {
        address: SIGNER_T1,
        networkKey: 'calibration',
        nativePrefix: 't',
      };
    },
    async disconnect() {
      return undefined;
    },
    async getAccount() {
      return {
        address: SIGNER_T1,
        networkKey: 'calibration',
        nativePrefix: 't',
      };
    },
    getBalance: vi.fn(async () => balance),
    signAndSubmitMessage: vi.fn(async () => ({ cid: CID })),
  };
}

function getConfirmedStatus(returnValue: string): TransactionStatus {
  return {
    cid: CID,
    status: 'confirmed',
    receipt: {
      ExitCode: 0,
      Return: returnValue,
      GasUsed: 4321,
    },
  };
}

function HookHarness({
  onValue,
  options,
}: {
  onValue: (value: UseExecuteMultisigProposalReturn) => void;
  options: Parameters<typeof useExecuteMultisigProposal>[0];
}) {
  onValue(useExecuteMultisigProposal(options));
  return null;
}

describe('useExecuteMultisigProposal', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;
  let latestHook: UseExecuteMultisigProposalReturn | undefined;

  beforeEach(() => {
    latestHook = undefined;
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderHook(options: Parameters<typeof useExecuteMultisigProposal>[0]) {
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

  it('reports applied success when a threshold-1 proposal executes its batch', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);
    const rpc = getRpc();
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => getConfirmedStatus(PROPOSE_APPLIED_SUCCESS_RETURN),
    );

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ threshold: 1 }),
      network: getNetworkConfig('calibration'),
      rpc,
      pollMessageStatus,
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });

    expect(rpc.multisig?.getAvailableBalance).toHaveBeenCalledWith(MULTISIG_T2, 'calibration');
    expect(provider.getBalance).toHaveBeenCalledWith({
      address: SIGNER_T1,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(provider.signAndSubmitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        To: MULTISIG_T2,
        From: SIGNER_T1,
        Value: '0',
        Method: 2,
        GasLimit: 10_000,
        GasFeeCap: '1000',
        GasPremium: '10',
      }),
    );
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
    expect(latestHook?.state).toBe('confirmed');
    expect(latestHook?.proposalOutcome).toEqual(
      expect.objectContaining({
        kind: 'applied-success',
        cid: CID,
        txnId: 9,
        applied: true,
        code: 0,
        returnData: Uint8Array.from([0xde, 0xad]),
      }),
    );
  });

  it('keeps a below-threshold proposal queued without reporting batch execution', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ threshold: 2 }),
      network: getNetworkConfig('calibration'),
      rpc: getRpc(),
      pollMessageStatus: vi.fn(async () => getConfirmedStatus(PROPOSE_QUEUED_RETURN)),
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });

    expect(latestHook?.state).toBe('confirmed');
    expect(latestHook?.error).toBeUndefined();
    expect(latestHook?.proposalOutcome).toEqual(
      expect.objectContaining({
        kind: 'queued',
        cid: CID,
        txnId: 7,
        applied: false,
        code: 0,
        returnData: new Uint8Array(),
      }),
    );
  });

  it('reports failure when a threshold-1 proposal applies but the inner batch exits nonzero', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ threshold: 1 }),
      network: getNetworkConfig('calibration'),
      rpc: getRpc(),
      pollMessageStatus: vi.fn(async () => getConfirmedStatus(PROPOSE_APPLIED_FAILURE_RETURN)),
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.proposalOutcome).toEqual(
      expect.objectContaining({
        kind: 'applied-failure',
        cid: CID,
        txnId: 10,
        applied: true,
        code: 33,
        returnData: Uint8Array.from([0x01, 0x02]),
      }),
    );
    expect(latestHook?.error).toMatchObject({
      category: 'ONCHAIN_REVERT_ATOMIC',
      stage: 'confirmation',
      recoverable: true,
    });
    expect(latestHook?.error?.details).toContain(`CID: ${CID}`);
    expect(latestHook?.error?.details).toContain('outer exit code: 0');
    expect(latestHook?.error?.details).toContain('gas used: 4321');
    expect(latestHook?.error?.details).toContain('inner exit code: 33');
    expect(latestHook?.error?.details).toContain('inner return: 0x0102');
  });

  it('fails safely with CID and receipt diagnostics when ProposeReturn is malformed', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ threshold: 1 }),
      network: getNetworkConfig('calibration'),
      rpc: getRpc(),
      pollMessageStatus: vi.fn(async () => getConfirmedStatus('gwf0AA==')),
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.proposalOutcome).toBeUndefined();
    expect(latestHook?.error).toMatchObject({
      category: 'UNKNOWN',
      stage: 'confirmation',
      recoverable: false,
    });
    expect(latestHook?.error?.details).toContain(`CID: ${CID}`);
    expect(latestHook?.error?.details).toContain('outer return: gwf0AA==');
    expect(latestHook?.error?.details).toContain('Expected CBOR array with 4 fields');

    const repeated = latestHook!.executeBatch(recipients, 'ATOMIC');
    await expect(repeated).resolves.toBe(CID);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps the submission locked when confirmation times out without a receipt', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'failed',
        error: 'Transaction timeout - still pending after maximum wait time',
      }),
    );

    await renderHook({
      sender,
      provider,
      multisig: getMultisig(),
      network: getNetworkConfig('calibration'),
      rpc: getRpc(),
      pollMessageStatus,
    });

    let first!: Promise<string>;
    await act(async () => {
      first = latestHook!.executeBatch(recipients, 'ATOMIC');
      await expect(first).resolves.toBe(CID);
      await Promise.resolve();
    });

    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.error).toMatchObject({
      title: 'Multisig proposal confirmation is uncertain',
      recoverable: false,
      stage: 'confirmation',
    });
    expect(latestHook?.error?.message).toContain('could duplicate payments');

    act(() => latestHook!.reset());
    expect(latestHook?.state).toBe('failed');

    const repeated = latestHook!.executeBatch(recipients, 'ATOMIC');
    expect(repeated).toBe(first);
    await expect(repeated).resolves.toBe(CID);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    expect(pollMessageStatus).toHaveBeenCalledTimes(1);
  });

  it('uses RPC GasPremium for review while retaining GasLimit times GasFeeCap as max fee', async () => {
    const sender = getNativeSender();

    await renderHook({
      sender,
      provider: getProvider(10n ** 21n),
      multisig: getMultisig(),
      network: getNetworkConfig('calibration'),
      rpc: getRpc(),
      pollMessageStatus: vi.fn(),
    });

    let estimate: BatchGasEstimate | undefined;
    await act(async () => {
      estimate = await latestHook?.estimateBatch(recipients, 'ATOMIC');
    });

    expect(estimate).toEqual({
      gasLimit: 10_000n,
      gasFeeCap: 1000n,
      gasPremium: 10n,
      estimatedFee: 10_000_000n,
    });
  });

  it('coalesces concurrent execute calls into one proposal submission', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);
    const rpc = getRpc();
    const pollMessageStatus = vi.fn(async () => getConfirmedStatus(PROPOSE_APPLIED_SUCCESS_RETURN));

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ threshold: 1 }),
      network: getNetworkConfig('calibration'),
      rpc,
      pollMessageStatus,
    });

    await act(async () => {
      const first = latestHook!.executeBatch(recipients, 'ATOMIC');
      const second = latestHook!.executeBatch(recipients, 'ATOMIC');

      expect(second).toBe(first);
      await expect(Promise.all([first, second])).resolves.toEqual([CID, CID]);
    });

    expect(rpc.getNonce).toHaveBeenCalledTimes(1);
    expect(rpc.estimateGas).toHaveBeenCalledTimes(1);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    expect(pollMessageStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps proposal submission single-flight until confirmation completes', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);
    const rpc = getRpc();
    const confirmation = createDeferred<TransactionStatus>();
    const pollMessageStatus = vi.fn(() => confirmation.promise);

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ threshold: 1 }),
      network: getNetworkConfig('calibration'),
      rpc,
      pollMessageStatus,
    });

    let first!: Promise<string>;
    await act(async () => {
      first = latestHook!.executeBatch(recipients, 'ATOMIC');
      await expect(first).resolves.toBe(CID);
    });

    expect(latestHook?.state).toBe('pending');

    act(() => {
      latestHook!.reset();
    });
    expect(latestHook?.state).toBe('pending');

    const repeated = latestHook!.executeBatch(recipients, 'ATOMIC');
    expect(repeated).toBe(first);
    await expect(repeated).resolves.toBe(CID);
    expect(provider.signAndSubmitMessage).toHaveBeenCalledTimes(1);
    expect(pollMessageStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirmation.resolve(getConfirmedStatus(PROPOSE_APPLIED_SUCCESS_RETURN));
      await confirmation.promise;
      await Promise.resolve();
    });

    expect(latestHook?.state).toBe('confirmed');
  });

  it('blocks signing when multisig spendable balance is insufficient', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);

    await renderHook({
      sender,
      provider,
      multisig: getMultisig({ availableBalanceAttoFil: 1n }),
      network: getNetworkConfig('calibration'),
      rpc: getRpc(1n),
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
  });

  it('blocks signing when the connected signer cannot cover proposal gas', async () => {
    const sender = getNativeSender();
    const provider = getProvider(1n);

    await renderHook({
      sender,
      provider,
      multisig: getMultisig(),
      network: getNetworkConfig('calibration'),
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
  });

  it('rechecks signer membership immediately before proposal submission', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);
    const rpc = getRpc();

    if (!rpc.multisig) {
      throw new Error('Expected multisig RPC mock');
    }

    vi.mocked(rpc.multisig.readState).mockResolvedValueOnce({
      Balance: (10n ** 21n).toString(),
      State: {
        Signers: [RECIPIENT_T1],
        NumApprovalsThreshold: 1,
      },
    });

    await renderHook({
      sender,
      provider,
      multisig: getMultisig(),
      network: getNetworkConfig('calibration'),
      rpc,
      pollMessageStatus: vi.fn(),
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).rejects.toBeInstanceOf(
        BatchExecutionError,
      );
    });

    expect(latestHook?.error?.message).toContain('no longer a signer');
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
  });
});
