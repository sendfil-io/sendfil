import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { getAddress } from 'viem';
import App from '../App';
import type { RecipientValidationResult } from '../utils/recipientValidation';

const FEE_A = '0x1111111111111111111111111111111111111111';
const FEE_B = '0x2222222222222222222222222222222222222222';
const CONTRACT_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const NATIVE_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const getCodeMock = vi.fn();
const estimateGasMock = vi.fn();
const getGasPriceMock = vi.fn();
const sendTransactionAsyncMock = vi.fn();
let mockValidationResult: RecipientValidationResult = {
  validRecipients: [
    {
      address: NATIVE_F1,
      amount: '1',
      lineNumber: 1,
    },
  ],
  errors: [],
  warnings: [],
  nonEmptyRowCount: 1,
};

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
  useChainId: () => 314,
  usePublicClient: () => ({
    getCode: getCodeMock,
    estimateGas: estimateGasMock,
    getGasPrice: getGasPriceMock,
  }),
  useSendTransaction: () => ({
    sendTransactionAsync: sendTransactionAsyncMock,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: undefined,
  }),
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

describe('INV-RPC-001 contract recipient guard', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv('VITE_FEE_ADDR_A', FEE_A);
    vi.stubEnv('VITE_FEE_ADDR_B', FEE_B);
    vi.stubEnv('VITE_FEE_PERCENT', '1');
    vi.stubEnv('VITE_FEE_SPLIT', '0.5');

    getCodeMock.mockReset();
    estimateGasMock.mockReset();
    getGasPriceMock.mockReset();
    sendTransactionAsyncMock.mockReset();
    mockValidationResult = {
      validRecipients: [
        {
          address: NATIVE_F1,
          amount: '1',
          lineNumber: 1,
        },
      ],
      errors: [],
      warnings: [],
      nonEmptyRowCount: 1,
    };

    getCodeMock.mockResolvedValue('0x');
    estimateGasMock.mockResolvedValue(21_000n);
    getGasPriceMock.mockResolvedValue(1n);
    sendTransactionAsyncMock.mockResolvedValue(
      `0x${'a'.repeat(64)}` as `0x${string}`,
    );

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

  it('does not require getCode for native f1 recipients', async () => {
    await act(async () => {
      root.render(<App />);
    });

    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();

    click(getElementByTestId(container, 'send-batch-button'));
    await flushAsyncWork();

    expect(getCodeMock).not.toHaveBeenCalled();
    expect(sendTransactionAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('blocks send when an EVM recipient resolves to deployed bytecode', async () => {
    getCodeMock.mockResolvedValue('0x60016000');
    mockValidationResult = {
      validRecipients: [
        {
          address: getAddress(CONTRACT_RECIPIENT),
          amount: '1',
          lineNumber: 1,
        },
      ],
      errors: [],
      warnings: [],
      nonEmptyRowCount: 1,
    };

    await act(async () => {
      root.render(<App />);
    });

    click(getElementByTestId(container, 'review-batch-button'));
    await flushAsyncWork();

    const sendButton = getElementByTestId(
      container,
      'send-batch-button',
    ) as HTMLButtonElement;

    expect(getCodeMock).toHaveBeenCalled();
    expect(sendButton.disabled).toBe(true);

    click(sendButton);
    await flushAsyncWork();

    expect(sendTransactionAsyncMock).not.toHaveBeenCalled();
  });
});
