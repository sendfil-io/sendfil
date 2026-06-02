import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { FILSNAP_FILECOIN_PROVIDER_METADATA } from '../../senders';
import { createNativeFilecoinConnectedSender } from '../../senders/senderModel';
import type { NativeFilecoinWalletProvider } from '../../senders/types';
import type { FilecoinMessage, TransactionStatus } from '../../DataProvider/types';
import type { SendFilNetworkKey } from '../../networks';
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
const RECIPIENT = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 80),
  CoinType.TEST,
).toString();
const CID = 'bafy2bzacednativebatchcid';

const recipients: BatchExecutionRecipient[] = [
  { address: RECIPIENT, amount: 1 },
];

function getNativeSender() {
  const result = createNativeFilecoinConnectedSender({
    address: CALIBRATION_T1,
    provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  });

  if (!result.sender) {
    throw new Error(result.error ?? 'Failed to create native sender');
  }

  return result.sender;
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
      async (): Promise<TransactionStatus> => ({
        cid: CID,
        status: 'confirmed',
      }),
    );

    await renderHook({
      sender,
      provider,
      rpc,
      pollMessageStatus,
    });

    await act(async () => {
      await expect(latestHook?.executeBatch(recipients, 'PARTIAL')).resolves.toBe(CID);
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
    );
    expect(pollMessageStatus).toHaveBeenCalledWith(CID, 60, 5000, 'calibration');
    expect(latestHook?.txHash).toBe(CID);
    expect(latestHook?.state).toBe('confirmed');
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
        await latestHook?.executeBatch(recipients, 'PARTIAL');
      } catch (error) {
        capturedError = error;
      }
    });

    expect(capturedError).toBeInstanceOf(BatchExecutionError);
    expect((capturedError as BatchExecutionError).category).toBe('INSUFFICIENT_FUNDS');
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
    expect(latestHook?.state).toBe('failed');
  });
});
