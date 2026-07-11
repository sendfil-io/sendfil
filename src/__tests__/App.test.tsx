import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { getAddress } from 'viem';
import { CoinType, newActorAddress, newSecp256k1Address } from '@glif/filecoin-address';
import App from '../App';
import type {
  MultisigActorState,
  MultisigProposalOutcome,
  NativeMultisigAddress,
  useMultisigs,
} from '../lib/multisig';
import { getNetworkConfig } from '../lib/networks';
import type {
  ConnectedSenderState,
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
} from '../lib/senders';
import { BatchExecutionError } from '../lib/transaction/errorHandling';
import {
  validateRecipientRows,
  type RecipientValidationResult,
} from '../utils/recipientValidation';

type MockBatchExecutionState = 'idle' | 'building' | 'signing' | 'pending' | 'confirmed' | 'failed';

interface MockExecutionSnapshot {
  state: MockBatchExecutionState;
  txHash?: `0x${string}`;
  error?: BatchExecutionError;
}

const FEE_A = '0x1111111111111111111111111111111111111111';
const FEE_B = '0x2222222222222222222222222222222222222222';
const BASE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const HASH_A = `0x${'a'.repeat(64)}` as `0x${string}`;
const HASH_B = `0x${'b'.repeat(64)}` as `0x${string}`;
const NATIVE_SIGNER = newSecp256k1Address(
  Uint8Array.from({ length: 65 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();
const CALIBRATION_NATIVE_SIGNER = newSecp256k1Address(
  Uint8Array.from({ length: 65 }, (_, index) => index + 71),
  CoinType.TEST,
).toString();
const NATIVE_MULTISIG = newActorAddress(
  Uint8Array.from({ length: 20 }, (_, index) => index + 41),
  CoinType.MAIN,
).toString() as NativeMultisigAddress;

const listeners = new Set<() => void>();
const multisigListeners = new Set<() => void>();
let mockExecutionSnapshot: MockExecutionSnapshot = { state: 'idle' };
let mockConnectedSenderState: ConnectedSenderState | undefined;
let mockMultisigsSnapshot: ReturnType<typeof useMultisigs>;
let mockMultisigExecutionSnapshot: {
  state: MockBatchExecutionState;
  txHash?: string;
  error?: BatchExecutionError;
  proposalOutcome?: MultisigProposalOutcome;
} = { state: 'idle' };
let mockValidationResult: RecipientValidationResult = {
  validRecipients: [
    {
      address: getAddress(BASE_ADDRESS),
      amount: '1',
      lineNumber: 1,
    },
  ],
  errors: [],
  warnings: [],
  nonEmptyRowCount: 1,
};
const executeBatchMock = vi.fn();
const estimateBatchMock = vi.fn();
const executeMultisigBatchMock = vi.fn();
const estimateMultisigBatchMock = vi.fn();
const refreshSelectedMultisigMock = vi.fn();
const getNativeBalanceMock = vi.fn();
const getNativeProvidersMock = vi.fn();
const getCodeMock = vi.fn();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function setMockExecutionSnapshot(next: MockExecutionSnapshot) {
  mockExecutionSnapshot = next;
  listeners.forEach((listener) => listener());
}

function setMockMultisigExecutionSnapshot(next: typeof mockMultisigExecutionSnapshot) {
  mockMultisigExecutionSnapshot = next;
  multisigListeners.forEach((listener) => listener());
}

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: BASE_ADDRESS as `0x${string}`,
    isConnected: true,
  }),
  useBalance: () => ({
    data: {
      value: 1000n * 10n ** 18n,
      decimals: 18,
    },
  }),
  usePublicClient: () => ({
    getCode: getCodeMock,
  }),
  useChainId: () => 314,
}));

vi.mock('../components/CustomConnectButton', () => ({
  CustomConnectButton: ({
    disabled,
    nativeFilecoin,
  }: {
    disabled?: boolean;
    nativeFilecoin?: {
      providers: NativeFilecoinWalletProvider[];
      onConnect: (
        provider: NativeFilecoinWalletProvider,
        networkKey: 'mainnet' | 'calibration',
      ) => Promise<void>;
      onDisconnect: () => Promise<void>;
    };
  }) => (
    <div data-testid="mock-connect-button">
      <button
        type="button"
        data-testid="mock-native-wallet-switch"
        disabled={disabled}
        onClick={() => {
          const provider = nativeFilecoin?.providers[0];
          if (provider) {
            void nativeFilecoin?.onConnect(provider, 'calibration');
          }
        }}
      >
        Switch native network
      </button>
      <button
        type="button"
        data-testid="mock-native-wallet-disconnect"
        disabled={disabled}
        onClick={() => void nativeFilecoin?.onDisconnect()}
      >
        Disconnect native wallet
      </button>
    </div>
  ),
}));

vi.mock('../components/CSVUpload', () => ({
  default: () => <div data-testid="mock-csv-upload">Mock CSV upload</div>,
}));

vi.mock('../components/UnavailableCapabilityModal', () => ({
  default: () => null,
}));

vi.mock('../utils/recipientValidation', async () => {
  const actual = await vi.importActual<typeof import('../utils/recipientValidation')>(
    '../utils/recipientValidation',
  );

  return {
    ...actual,
    validateRecipientRows: vi.fn(() => mockValidationResult),
  };
});

vi.mock('../lib/transaction/useExecuteBatch', async () => {
  const React = await import('react');

  return {
    useExecuteBatch: () => {
      const [, forceRender] = React.useState(0);

      React.useEffect(() => {
        const listener = () => forceRender((value: number) => value + 1);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, []);

      return {
        estimateBatch: estimateBatchMock,
        executeBatch: executeBatchMock,
        state: mockExecutionSnapshot.state,
        txHash: mockExecutionSnapshot.txHash,
        error: mockExecutionSnapshot.error,
        reset: () =>
          setMockExecutionSnapshot({
            state: 'idle',
            txHash: undefined,
            error: undefined,
          }),
      };
    },
  };
});

vi.mock('../lib/senders', async () => {
  const actual = await vi.importActual<typeof import('../lib/senders')>('../lib/senders');

  return {
    ...actual,
    getNativeFilecoinWalletProviders: () => getNativeProvidersMock(),
    getNativeFilecoinSenderBalanceAttoFil: (
      ...args: Parameters<typeof actual.getNativeFilecoinSenderBalanceAttoFil>
    ) => getNativeBalanceMock(...args),
    useConnectedSender: (
      options: Parameters<typeof actual.useConnectedSender>[0],
    ): ConnectedSenderState => {
      const actualState = actual.useConnectedSender(options);
      return mockConnectedSenderState ?? actualState;
    },
  };
});

vi.mock('../lib/multisig', async () => {
  const React = await import('react');
  const actual = await vi.importActual<typeof import('../lib/multisig')>('../lib/multisig');

  return {
    ...actual,
    useMultisigs: () => mockMultisigsSnapshot,
    useExecuteMultisigProposal: () => {
      const [, forceRender] = React.useState(0);

      React.useEffect(() => {
        const listener = () => forceRender((value: number) => value + 1);
        multisigListeners.add(listener);
        return () => {
          multisigListeners.delete(listener);
        };
      }, []);

      return {
        estimateBatch: estimateMultisigBatchMock,
        executeBatch: executeMultisigBatchMock,
        state: mockMultisigExecutionSnapshot.state,
        txHash: mockMultisigExecutionSnapshot.txHash,
        error: mockMultisigExecutionSnapshot.error,
        proposalOutcome: mockMultisigExecutionSnapshot.proposalOutcome,
        reset: () => setMockMultisigExecutionSnapshot({ state: 'idle' }),
      };
    },
  };
});

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getElementByTestId(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Could not find element with test id "${testId}"`);
  }

  return element;
}

function openTransactionConfiguration(container: HTMLElement) {
  const button = container.querySelector('button[aria-expanded]');

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Could not find transaction configuration toggle');
  }

  click(button);
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button with label "${label}"`);
  }

  return button;
}

function createEmptyMultisigsSnapshot(): ReturnType<typeof useMultisigs> {
  return {
    savedMultisigs: [],
    selectedAddress: undefined,
    selectedMultisig: undefined,
    pendingProposals: [],
    isLoadingSelected: false,
    selectedError: undefined,
    proposalActionState: undefined,
    selectMultisig: vi.fn(),
    addMultisig: vi.fn(),
    removeMultisig: vi.fn(),
    refreshSelected: refreshSelectedMultisigMock,
    createMultisig: vi.fn(),
    approveProposal: vi.fn(),
    cancelProposal: vi.fn(),
  } as ReturnType<typeof useMultisigs>;
}

describe('App confirm flow', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv('VITE_FEE_ADDR_A', FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B', FEE_B);
    vi.stubEnv('VITE_FEE_PERCENT', '1');
    vi.stubEnv('VITE_FEE_SPLIT', '0.5');

    mockExecutionSnapshot = { state: 'idle' };
    mockMultisigExecutionSnapshot = { state: 'idle' };
    mockConnectedSenderState = undefined;
    mockMultisigsSnapshot = createEmptyMultisigsSnapshot();
    mockValidationResult = {
      validRecipients: [
        {
          address: getAddress(BASE_ADDRESS),
          amount: '1',
          lineNumber: 1,
        },
      ],
      errors: [],
      warnings: [],
      nonEmptyRowCount: 1,
    };
    listeners.clear();
    multisigListeners.clear();
    executeBatchMock.mockReset();
    estimateBatchMock.mockReset();
    executeMultisigBatchMock.mockReset();
    estimateMultisigBatchMock.mockReset();
    refreshSelectedMultisigMock.mockReset();
    getNativeBalanceMock.mockReset();
    getNativeBalanceMock.mockResolvedValue(1000n * 10n ** 18n);
    getNativeProvidersMock.mockReset();
    getNativeProvidersMock.mockReturnValue([]);
    getCodeMock.mockReset();
    getCodeMock.mockResolvedValue('0x');
    estimateBatchMock.mockResolvedValue({
      gasLimit: 1000n,
      gasFeeCap: 1n,
      gasPremium: 1n,
      estimatedFee: 1000n,
    });
    estimateMultisigBatchMock.mockResolvedValue({
      gasLimit: 2000n,
      gasFeeCap: 2n,
      gasPremium: 1n,
      estimatedFee: 4000n,
    });

    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
    });

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('HTMLButtonElement', dom.window.HTMLButtonElement);
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderAndOpenReview() {
    await act(async () => {
      root.render(<App />);
    });

    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();
  }

  it('cycles manual address placeholders by row and restarts for added rows', async () => {
    await act(async () => {
      root.render(<App />);
    });

    expect(getElementByTestId(container, 'recipient-address-0')).toHaveProperty(
      'placeholder',
      'f1...',
    );
    expect(getElementByTestId(container, 'recipient-address-1')).toHaveProperty(
      'placeholder',
      'f4...',
    );
    expect(getElementByTestId(container, 'recipient-address-2')).toHaveProperty(
      'placeholder',
      '0x...',
    );

    click(getButton(container, '+ Add recipient'));

    expect(getElementByTestId(container, 'recipient-address-3')).toHaveProperty(
      'placeholder',
      'f1...',
    );
  });

  it('shows the multisig panel only after selecting the multisig sender type', async () => {
    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).not.toContain('Native multisig');

    click(getElementByTestId(container, 'sender-wallet-multi-sig'));

    expect(
      getElementByTestId(container, 'sender-wallet-multi-sig').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(container.textContent).toContain('Native multisig');
    expect(container.textContent).toContain(
      'Connect FilSnap or Ledger Filecoin to create, approve, or send.',
    );
    expect(container.textContent).toContain('Add multisig');
    expect(container.textContent).toContain('Create');
  });

  it('refreshes, reviews, submits, and reconciles a native multisig proposal', async () => {
    const network = getNetworkConfig('mainnet');
    const provider = {
      id: 'app-test-native-wallet',
      name: 'App test native wallet',
      kind: 'native-filecoin-wallet' as const,
      status: 'available' as const,
      capabilities: {
        canConnect: true,
        canDisconnect: true,
        canDetectNetwork: true,
        canReadBalance: true,
        canSignBatch: true,
        canSubmit: true,
        oneApprovalPerBatch: true,
      },
    };
    const walletTransition = createDeferred<{
      address: string;
      networkKey: 'calibration';
      nativePrefix: 't';
    }>();
    const transitionProvider: NativeFilecoinWalletProvider = {
      metadata: provider,
      connect: vi.fn(() => walletTransition.promise),
      disconnect: vi.fn(async () => undefined),
      getAccount: vi.fn(async () => null),
      getBalance: vi.fn(async () => 1000n * 10n ** 18n),
    };
    getNativeProvidersMock.mockReturnValue([transitionProvider]);
    const nativeSender: NativeFilecoinConnectedSender = {
      kind: 'native-filecoin',
      address: NATIVE_SIGNER,
      chainId: network.chainId,
      networkKey: network.key,
      nativePrefix: network.nativePrefix,
      network,
      networkStatus: 'supported',
      canSignBatch: true,
      provider,
    };
    const actorState: MultisigActorState = {
      address: NATIVE_MULTISIG,
      networkKey: network.key,
      balanceAttoFil: 1000n * 10n ** 18n,
      availableBalanceAttoFil: 1000n * 10n ** 18n,
      threshold: 2,
      signers: [NATIVE_SIGNER, 'f01001'],
      signerIdAddresses: ['f01000', 'f01001'],
      connectedSignerIdAddress: 'f01000',
      connectedSignerCanApprove: true,
    };
    const proposalCid = 'bafy2bzaceappmultisigproposal';

    const mainnetConnectedState: ConnectedSenderState = {
      connectedSender: nativeSender,
      isConnected: true,
      address: nativeSender.address,
      chainId: nativeSender.chainId,
      connectedNetwork: network,
      networkStatus: 'supported',
      hasSupportedConnectedNetwork: true,
      isUnsupportedConnectedNetwork: false,
      expectedNetworkPrefix: 'f',
      canUseLiveSendPath: true,
      balanceSource: {
        kind: 'native-filecoin-lotus',
        enabled: true,
        address: nativeSender.address,
        networkKey: network.key,
      },
      nativeFilecoin: {
        status: 'available',
        providers: [provider],
        hasConnectableProvider: true,
        hasSignableProvider: true,
      },
    };
    mockConnectedSenderState = mainnetConnectedState;
    mockMultisigsSnapshot = {
      ...createEmptyMultisigsSnapshot(),
      savedMultisigs: [
        {
          address: NATIVE_MULTISIG,
          networkKey: network.key,
          label: 'Treasury multisig',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      selectedAddress: NATIVE_MULTISIG,
      selectedMultisig: actorState,
      refreshSelected: refreshSelectedMultisigMock,
    };
    refreshSelectedMultisigMock.mockResolvedValue(actorState);
    executeMultisigBatchMock.mockImplementation(async () => {
      setMockMultisigExecutionSnapshot({
        state: 'pending',
        txHash: proposalCid,
      });
      return proposalCid;
    });

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(getNativeProvidersMock).toHaveReturnedWith([transitionProvider]);
    click(getElementByTestId(container, 'sender-wallet-multi-sig'));
    click(getElementByTestId(container, 'mock-native-wallet-switch'));
    await flushAsyncWork();

    expect(transitionProvider.connect).toHaveBeenCalledWith({ networkKey: 'calibration' });
    expect(
      (getElementByTestId(container, 'review-batch-button') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(container.textContent).toContain('Wallet Update In Progress');

    await act(async () => {
      walletTransition.resolve({
        address: CALIBRATION_NATIVE_SIGNER,
        networkKey: 'calibration',
        nativePrefix: 't',
      });
      await walletTransition.promise;
    });
    await flushAsyncWork();

    expect(
      (getElementByTestId(container, 'review-batch-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();
    await flushAsyncWork();

    expect(refreshSelectedMultisigMock).toHaveBeenCalledTimes(1);
    expect(estimateMultisigBatchMock).toHaveBeenCalledWith(
      [
        { address: getAddress(BASE_ADDRESS), amount: 1 },
        { address: FEE_A, amount: 0.005 },
        { address: FEE_B, amount: 0.005 },
      ],
      'ATOMIC',
      'STANDARD',
    );
    expect(getElementByTestId(container, 'multisig-review-identity').textContent).toContain(
      NATIVE_MULTISIG,
    );
    expect(getElementByTestId(container, 'multisig-review-identity').textContent).toContain(
      NATIVE_SIGNER,
    );
    expect(getElementByTestId(container, 'multisig-review-identity').textContent).toContain(
      '2 of 2 signers',
    );

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(executeMultisigBatchMock).toHaveBeenCalledWith(
      [
        { address: getAddress(BASE_ADDRESS), amount: 1 },
        { address: FEE_A, amount: 0.005 },
        { address: FEE_B, amount: 0.005 },
      ],
      'ATOMIC',
      'STANDARD',
    );
    expect(container.textContent).toContain('Proposal Pending');
    expect(
      (getElementByTestId(container, 'sender-wallet-single-sig') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (
        container.querySelector(
          'button[aria-label="Select multisig Treasury multisig"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (getElementByTestId(container, 'mock-native-wallet-switch') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (getElementByTestId(container, 'mock-native-wallet-disconnect') as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    click(getButton(container, 'Close'));

    const calibration = getNetworkConfig('calibration');
    const calibrationSender: NativeFilecoinConnectedSender = {
      ...nativeSender,
      chainId: calibration.chainId,
      networkKey: calibration.key,
      nativePrefix: calibration.nativePrefix,
      network: calibration,
    };
    mockConnectedSenderState = {
      ...mainnetConnectedState,
      connectedSender: calibrationSender,
      address: calibrationSender.address,
      chainId: calibration.chainId,
      connectedNetwork: calibration,
      expectedNetworkPrefix: 't',
      balanceSource: {
        kind: 'native-filecoin-lotus',
        enabled: true,
        address: calibrationSender.address,
        networkKey: calibration.key,
      },
    };
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(getButton(container, 'View Pending Proposal')).toBeDefined();
    click(getButton(container, 'View Pending Proposal'));
    expect(container.textContent).toContain('Proposal Pending');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Filecoin Mainnet');
    const pendingFilfoxLink = Array.from(container.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('View on Filfox'),
    );
    expect(pendingFilfoxLink?.getAttribute('href')).toContain(
      `https://filfox.info/en/message/${proposalCid}`,
    );
    expect(pendingFilfoxLink?.getAttribute('href')).not.toContain('calibration');
    expect(refreshSelectedMultisigMock).toHaveBeenCalledTimes(1);

    mockConnectedSenderState = mainnetConnectedState;
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    act(() => {
      setMockMultisigExecutionSnapshot({
        state: 'confirmed',
        txHash: proposalCid,
        proposalOutcome: {
          kind: 'queued',
          applied: false,
          code: 0,
          cid: proposalCid,
          txnId: 7,
          returnData: new Uint8Array(),
          receipt: {
            ExitCode: 0,
            Return: '',
            GasUsed: 123,
          },
        },
      });
    });

    expect(container.textContent).toContain('Proposal Confirmed');
    expect(container.textContent).toContain(
      'Proposal #7 is confirmed and awaiting additional approvals.',
    );
    expect(
      (getElementByTestId(container, 'sender-wallet-single-sig') as HTMLButtonElement).disabled,
    ).toBe(false);

    click(getButton(container, 'Done'));
    expect(refreshSelectedMultisigMock).toHaveBeenCalledTimes(2);
  });

  it('reserves two internal fee rows from the ThinBatch payment cap', async () => {
    await act(async () => {
      root.render(<App />);
    });

    openTransactionConfiguration(container);
    click(getElementByTestId(container, 'execution-method-thinbatch'));

    const validationCalls = vi.mocked(validateRecipientRows).mock.calls;
    expect(validationCalls.some(([, options]) => options.maxRecipients === 498)).toBe(true);
  });

  it('calls executeBatch with fee rows in default Standard Atomic mode', async () => {
    executeBatchMock.mockImplementation(async () => {
      setMockExecutionSnapshot({
        state: 'pending',
        txHash: HASH_A,
      });
      return HASH_A;
    });

    await renderAndOpenReview();

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(executeBatchMock).toHaveBeenCalledTimes(1);
    expect(executeBatchMock).toHaveBeenCalledWith(
      [
        { address: getAddress(BASE_ADDRESS), amount: 1 },
        { address: FEE_A, amount: 0.005 },
        { address: FEE_B, amount: 0.005 },
      ],
      'ATOMIC',
      'STANDARD',
    );
  });

  it('calls estimateBatch and executeBatch with fee rows in atomic mode when selected', async () => {
    executeBatchMock.mockImplementation(async () => {
      setMockExecutionSnapshot({
        state: 'pending',
        txHash: HASH_A,
      });
      return HASH_A;
    });

    await act(async () => {
      root.render(<App />);
    });

    openTransactionConfiguration(container);
    click(getElementByTestId(container, 'error-handling-atomic'));
    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();

    expect(container.textContent).toContain('Atomic');
    expect(container.textContent).toContain('Any failing transfer reverts the whole batch.');
    expect(estimateBatchMock).toHaveBeenCalledWith(
      [
        { address: getAddress(BASE_ADDRESS), amount: 1 },
        { address: FEE_A, amount: 0.005 },
        { address: FEE_B, amount: 0.005 },
      ],
      'ATOMIC',
      'STANDARD',
    );

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(executeBatchMock).toHaveBeenCalledTimes(1);
    expect(executeBatchMock).toHaveBeenCalledWith(
      [
        { address: getAddress(BASE_ADDRESS), amount: 1 },
        { address: FEE_A, amount: 0.005 },
        { address: FEE_B, amount: 0.005 },
      ],
      'ATOMIC',
      'STANDARD',
    );
  });

  it('ignores a gas estimate from a closed and superseded review', async () => {
    const firstEstimate = createDeferred<{
      gasLimit: bigint;
      gasFeeCap: bigint;
      gasPremium: bigint;
      estimatedFee: bigint;
    }>();
    const secondEstimate = createDeferred<{
      gasLimit: bigint;
      gasFeeCap: bigint;
      gasPremium: bigint;
      estimatedFee: bigint;
    }>();

    estimateBatchMock
      .mockImplementationOnce(() => firstEstimate.promise)
      .mockImplementationOnce(() => secondEstimate.promise);

    await renderAndOpenReview();
    expect(container.textContent).toContain('Estimating...');

    click(getButton(container, 'Cancel'));
    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();

    await act(async () => {
      secondEstimate.resolve({
        gasLimit: 2_000n,
        gasFeeCap: 2n,
        gasPremium: 1n,
        estimatedFee: 4_000n,
      });
      await secondEstimate.promise;
    });

    expect(container.textContent).not.toContain('Estimating...');
    click(getButton(container, 'View gas details ▼'));
    expect(container.textContent).toContain('2,000 units');

    await act(async () => {
      firstEstimate.resolve({
        gasLimit: 1_000n,
        gasFeeCap: 9n,
        gasPremium: 9n,
        estimatedFee: 9_000n,
      });
      await firstEstimate.promise;
    });

    expect(container.textContent).toContain('2,000 units');
    expect(container.textContent).not.toContain('1,000 units');
  });

  it('shows pending then confirmed state with the returned transaction hash', async () => {
    executeBatchMock.mockImplementation(async () => {
      setMockExecutionSnapshot({
        state: 'pending',
        txHash: HASH_A,
      });
      return HASH_A;
    });

    await renderAndOpenReview();

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(container.textContent).toContain('Processing');
    expect(container.textContent).toContain('Transaction Pending');

    act(() => {
      setMockExecutionSnapshot({
        state: 'confirmed',
        txHash: HASH_A,
      });
    });

    expect(container.textContent).toContain('Transaction Confirmed');

    const filfoxLink = Array.from(container.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('View on Filfox'),
    );

    expect(filfoxLink?.getAttribute('href')).toContain(HASH_A);
  });

  it('shows failure details and retries through executeBatch again', async () => {
    const rejectedError = new BatchExecutionError({
      category: 'USER_REJECTED',
      title: 'Transaction rejected',
      message: 'The batch was not submitted because the wallet signature request was rejected.',
      errorMode: 'ATOMIC',
      stage: 'execution',
      recoverable: true,
      hint: 'Review the batch and retry when you are ready to sign.',
    });

    executeBatchMock
      .mockImplementationOnce(async () => {
        setMockExecutionSnapshot({
          state: 'failed',
          error: rejectedError,
        });
        throw rejectedError;
      })
      .mockImplementationOnce(async () => {
        setMockExecutionSnapshot({
          state: 'pending',
          txHash: HASH_B,
        });
        return HASH_B;
      });

    await renderAndOpenReview();

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(container.textContent).toContain('Transaction rejected');
    expect(container.textContent).toContain(
      'The batch was not submitted because the wallet signature request was rejected.',
    );

    click(getButton(container, 'Try Again'));
    await flushAsyncWork();

    expect(executeBatchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Transaction Pending');

    act(() => {
      setMockExecutionSnapshot({
        state: 'confirmed',
        txHash: HASH_B,
      });
    });

    expect(container.textContent).toContain('Transaction Confirmed');
  });
});
