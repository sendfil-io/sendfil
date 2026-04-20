import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import ReviewTransactionModal, {
  type ReviewTransactionModalProps,
} from '../ReviewTransactionModal';
import { DEFAULT_BATCH_CONFIGURATION } from '../../lib/batchConfiguration';

vi.mock('wagmi', () => ({
  useChainId: () => 314,
}));

function getBaseProps(): ReviewTransactionModalProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    recipients: [{ address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za', amount: 1 }],
    validationErrors: [],
    validationWarnings: [],
    recipientTotal: 1,
    feeTotal: 0.01,
    gasEstimate: {
      gasLimit: 1000,
      gasFeeCap: '1',
      gasPremium: '1',
      estimatedFeeInFil: 0.001,
    },
    isEstimatingGas: false,
    gasEstimationError: undefined,
    walletBalance: 10,
    insufficientBalance: false,
    transactionState: 'review',
    transactionHash: undefined,
    transactionError: undefined,
    batchConfiguration: DEFAULT_BATCH_CONFIGURATION,
  };
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

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ReviewTransactionModal', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('requires duplicate acknowledgment before enabling send', () => {
    const props = getBaseProps();
    props.validationWarnings = ['Recipient 2: Duplicate recipient matches Recipient 1'];

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const sendButton = getButton(container, 'Send');
    const checkbox = container.querySelector(
      'input[aria-label="Acknowledge duplicate recipients"]',
    );

    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect(sendButton.disabled).toBe(true);

    click(checkbox as HTMLInputElement);

    expect(sendButton.disabled).toBe(false);

    click(sendButton);

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not require acknowledgment for non-duplicate warnings', () => {
    const props = getBaseProps();
    props.validationWarnings = ['Batch is large and may take longer to process'];

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const sendButton = getButton(container, 'Send');
    const checkbox = container.querySelector(
      'input[aria-label="Acknowledge duplicate recipients"]',
    );

    expect(checkbox).toBeNull();
    expect(sendButton.disabled).toBe(false);
  });

  it('renders the batch configuration summary', () => {
    const props = getBaseProps();

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('Batch configuration');
    expect(container.textContent).toContain('Single-signer');
    expect(container.textContent).toContain('Standard');
    expect(container.textContent).toContain('Partial');
  });

  it('resets duplicate acknowledgment when the modal reopens', () => {
    const props = getBaseProps();
    props.validationWarnings = ['Recipient 2: Duplicate recipient matches Recipient 1'];

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const initialCheckbox = container.querySelector(
      'input[aria-label="Acknowledge duplicate recipients"]',
    );
    click(initialCheckbox as HTMLInputElement);

    expect(getButton(container, 'Send').disabled).toBe(false);

    act(() => {
      root.render(<ReviewTransactionModal {...props} isOpen={false} />);
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const reopenedCheckbox = container.querySelector(
      'input[aria-label="Acknowledge duplicate recipients"]',
    ) as HTMLInputElement;

    expect(reopenedCheckbox.checked).toBe(false);
    expect(getButton(container, 'Send').disabled).toBe(true);
  });
});
