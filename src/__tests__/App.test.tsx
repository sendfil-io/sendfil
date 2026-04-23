import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { getAddress } from 'viem';
import App from '../App';
import { BatchExecutionError } from '../lib/transaction/errorHandling';
import type { RecipientValidationResult } from '../utils/recipientValidation';

type MockBatchExecutionState =
  | 'idle'
  | 'building'
  | 'signing'
  | 'pending'
  | 'confirmed'
  | 'failed';

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

const listeners = new Set<() => void>();
let mockExecutionSnapshot: MockExecutionSnapshot = { state: 'idle' };
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

function setMockExecutionSnapshot(next: MockExecutionSnapshot) {
  mockExecutionSnapshot = next;
  listeners.forEach((listener) => listener());
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
  useChainId: () => 314,
}));

vi.mock('../components/CustomConnectButton', () => ({
  CustomConnectButton: () => <div data-testid="mock-connect-button">Mock connect</div>,
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

vi.mock('../lib/transaction/mockAdapter', () => ({
  createMockBatchExecutionAdapter: () => undefined,
}));

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
        executeBatch: executeBatchMock,
        estimateBatch: estimateBatchMock,
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

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button with label "${label}"`);
  }

  return button;
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
    executeBatchMock.mockReset();
    estimateBatchMock.mockReset();
    estimateBatchMock.mockResolvedValue({
      gasLimit: 23_100n,
      gasFeeCap: 1_000_000_000n,
      gasPremium: 1_000_000_000n,
      estimatedFee: 23_100n * 1_000_000_000n,
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

  it('calls executeBatch with fee rows in partial mode', async () => {
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
      'PARTIAL',
    );
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
    const userRejectedError = new BatchExecutionError({
      category: 'USER_REJECTED',
      title: 'Transaction rejected',
      message: 'Transaction rejected by user',
      errorMode: 'PARTIAL',
      stage: 'execution',
      recoverable: true,
    });

    executeBatchMock
      .mockImplementationOnce(async () => {
        setMockExecutionSnapshot({
          state: 'failed',
          error: userRejectedError,
        });
        throw userRejectedError;
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

    expect(container.textContent).toContain('Transaction Failed');
    expect(container.textContent).toContain('Transaction rejected by user');

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
