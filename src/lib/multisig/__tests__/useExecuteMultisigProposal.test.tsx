import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { FILSNAP_FILECOIN_PROVIDER_METADATA } from '../../senders';
import { createNativeFilecoinConnectedSender } from '../../senders/senderModel';
import type { NativeFilecoinWalletProvider } from '../../senders/types';
import type { FilecoinMessage, TransactionStatus } from '../../DataProvider/types';
import type { SendFilNetworkKey } from '../../networks';
import { getNetworkConfig } from '../../networks';
import type { BatchExecutionRecipient } from '../../transaction/batchExecution';
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
const MULTISIG_T2 = 't2robustmultisigaddress' as const;
const CID = 'bafy2bzacedmultisigproposalcid';

const recipients: BatchExecutionRecipient[] = [
  { address: RECIPIENT_T1, amount: 1 },
];

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
    pendingProposalCount: 0,
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
      getActor: vi.fn(),
      readState: vi.fn(),
      lookupID: vi.fn(),
      lookupRobustAddress: vi.fn(),
      getBalance: vi.fn(),
      getAvailableBalance: vi.fn(async () => availableBalance),
      getVestingSchedule: vi.fn(),
      getPending: vi.fn(),
      getNetworkVersion: vi.fn(),
      getActorCodeCids: vi.fn(),
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

  it('signs a multisig Propose message after rechecking multisig and signer balances', async () => {
    const sender = getNativeSender();
    const provider = getProvider(10n ** 21n);
    const rpc = getRpc();
    const pollMessageStatus = vi.fn(
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
      }),
    );

    await renderHook({
      sender,
      provider,
      multisig: getMultisig(),
      network: getNetworkConfig('calibration'),
      rpc,
      pollMessageStatus,
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'ATOMIC')).resolves.toBe(CID);
    });

    expect(rpc.multisig?.getAvailableBalance).toHaveBeenCalledWith(
      MULTISIG_T2,
      'calibration',
    );
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
      }),
    );
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
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
});

