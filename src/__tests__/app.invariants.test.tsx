import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { getAddress } from 'viem';
import App from '../App';
import type { RecipientValidationResult } from '../utils/recipientValidation';

const FEE_A = '0x1111111111111111111111111111111111111111';
const FEE_B = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

let mockChainId = 314;
let mockValidationResult: RecipientValidationResult = {
  validRecipients: [
    {
      address: getAddress(RECIPIENT),
      amount: '1',
      lineNumber: 1,
    },
  ],
  errors: [],
  warnings: [],
  nonEmptyRowCount: 1,
};
const estimateBatchMock = vi.fn();
const executeBatchMock = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x9999999999999999999999999999999999999999' as `0x${string}`,
    isConnected: true,
  }),
  useBalance: () => ({
    data: {
      value: 1_000n * 10n ** 18n,
      decimals: 18,
    },
  }),
  useChainId: () => mockChainId,
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

vi.mock('../lib/transaction/useExecuteBatch', () => ({
  useExecuteBatch: () => ({
    estimateBatch: estimateBatchMock,
    executeBatch: executeBatchMock,
    state: 'idle' as const,
    txHash: undefined,
    error: undefined,
    reset: vi.fn(),
  }),
}));

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

describe('INV-NET-001 wrong network gating', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv('VITE_FEE_ADDR_A', FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B', FEE_B);
    vi.stubEnv('VITE_FEE_PERCENT', '1');
    vi.stubEnv('VITE_FEE_SPLIT', '0.5');

    mockChainId = 314;
    mockValidationResult = {
      validRecipients: [
        {
          address: getAddress(RECIPIENT),
          amount: '1',
          lineNumber: 1,
        },
      ],
      errors: [],
      warnings: [],
      nonEmptyRowCount: 1,
    };
    estimateBatchMock.mockReset();
    executeBatchMock.mockReset();
    estimateBatchMock.mockResolvedValue({
      gasLimit: 1000n,
      gasFeeCap: 1n,
      gasPremium: 1n,
      estimatedFee: 1000n,
    });
    executeBatchMock.mockResolvedValue(`0x${'a'.repeat(64)}` as `0x${string}`);

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

  it('blocks review and send while the wallet is connected to an unsupported chain', async () => {
    mockChainId = 1;

    await act(async () => {
      root.render(<App />);
    });

    const reviewButton = getElementByTestId(
      container,
      'review-batch-button',
    ) as HTMLButtonElement;

    expect(container.textContent).toContain(
      'Switch to Filecoin Mainnet (chain 314) to review and send this batch.',
    );
    expect(reviewButton.textContent).toContain('Switch Network to Review');
    expect(reviewButton.disabled).toBe(true);

    click(reviewButton);
    await flushAsyncWork();

    expect(estimateBatchMock).not.toHaveBeenCalled();
    expect(executeBatchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Review Batch');
  });
});

describe('INV-EXEC-001 review and submit alignment', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv('VITE_FEE_ADDR_A', FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B', FEE_B);
    vi.stubEnv('VITE_FEE_PERCENT', '1');
    vi.stubEnv('VITE_FEE_SPLIT', '0.5');

    mockChainId = 314;
    mockValidationResult = {
      validRecipients: [
        {
          address: getAddress(RECIPIENT),
          amount: '1',
          lineNumber: 1,
        },
      ],
      errors: [],
      warnings: [],
      nonEmptyRowCount: 1,
    };
    estimateBatchMock.mockReset();
    executeBatchMock.mockReset();
    estimateBatchMock.mockResolvedValue({
      gasLimit: 1000n,
      gasFeeCap: 1n,
      gasPremium: 1n,
      estimatedFee: 1000n,
    });
    executeBatchMock.mockResolvedValue(`0x${'a'.repeat(64)}` as `0x${string}`);

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

  it('passes the same execution config to estimate and execute in the live app flow', async () => {
    await act(async () => {
      root.render(<App />);
    });

    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();

    expect(estimateBatchMock).toHaveBeenCalledTimes(1);

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(executeBatchMock).toHaveBeenCalledTimes(1);
    expect(executeBatchMock.mock.calls[0]?.[0]).toEqual(
      estimateBatchMock.mock.calls[0]?.[0],
    );
    expect(executeBatchMock.mock.calls[0]?.[1]).toBe(
      estimateBatchMock.mock.calls[0]?.[1],
    );
    expect(executeBatchMock.mock.calls[0]).toEqual(
      estimateBatchMock.mock.calls[0],
    );
    expect(estimateBatchMock.mock.calls[0]).toEqual([
      [
        { address: getAddress(RECIPIENT), amount: 1 },
        { address: FEE_A, amount: 0.005 },
        { address: FEE_B, amount: 0.005 },
      ],
      'PARTIAL',
    ]);
  });
});
