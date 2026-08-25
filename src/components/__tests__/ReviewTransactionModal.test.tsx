import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import ReviewTransactionModal, {
  type ReviewTransactionModalProps,
} from '../ReviewTransactionModal';
import { DEFAULT_BATCH_CONFIGURATION } from '../../lib/batchConfiguration';
import { BatchExecutionError } from '../../lib/transaction/errorHandling';

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
    chainId: 314,
    networkLabel: 'Filecoin Mainnet',
    feeLabel: 'Platform fee (1%)',
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

  it('INV-DUP-001 requires duplicate acknowledgment before enabling send', () => {
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
    expect(container.textContent).toContain('Filecoin Mainnet');
    expect(container.textContent).toContain('Sender type');
    expect(container.textContent).toContain('Single-signer');
    expect(container.textContent).toContain('Method');
    expect(container.textContent).toContain('Standard');
    expect(container.textContent).toContain('Error handling');
    expect(container.textContent).toContain('Atomic');
    expect(container.textContent).toContain('Any failing transfer reverts the whole batch.');
  });

  it('shows the exact multisig actor, signer, and threshold before proposing', () => {
    const props = getBaseProps();
    const multisigAddress = 'f2abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz234567';
    const signerAddress = 'f1abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz234567';

    props.fundingMode = 'native-multisig';
    props.fundingSourceLabel = 'Treasury';
    props.fundingSourceAddress = multisigAddress;
    props.connectedSignerAddress = signerAddress;
    props.multisigThreshold = 2;
    props.multisigSignerCount = 3;
    props.batchConfiguration = {
      ...DEFAULT_BATCH_CONFIGURATION,
      senderWalletType: 'MULTI_SIG',
    };

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const identity = container.querySelector('[data-testid="multisig-review-identity"]');

    expect(identity?.textContent).toContain('Treasury');
    expect(identity?.textContent).toContain(multisigAddress);
    expect(identity?.textContent).toContain(signerAddress);
    expect(identity?.textContent).toContain('2 of 3 signers');
    expect(identity?.textContent).toContain("Proposing adds the connected signer's approval");
    expect(getButton(container, 'Propose batch').disabled).toBe(false);
  });

  it('distinguishes a queued multisig proposal from an executed batch', () => {
    const props = getBaseProps();
    props.fundingMode = 'native-multisig';
    props.transactionState = 'confirmed';
    props.multisigProposalOutcome = {
      kind: 'queued',
      transactionId: 42,
    };

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain(
      'Proposal #42 is confirmed and awaiting additional approvals.',
    );
    expect(container.textContent).not.toContain('batch call completed on-chain');
  });

  it('reports when a multisig proposal reached threshold and executed', () => {
    const props = getBaseProps();
    props.fundingMode = 'native-multisig';
    props.transactionState = 'confirmed';
    props.multisigProposalOutcome = {
      kind: 'applied-success',
      transactionId: 43,
    };

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain(
      'Proposal #43 reached threshold and its batch call completed on-chain.',
    );
  });

  it('labels mixed validation failures as blocking issues instead of row errors', () => {
    const props = getBaseProps();
    props.validationErrors = ['Selected multisig state is still loading.'];

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('1 blocking issue');
    expect(container.textContent).not.toContain('row has errors');
    expect(getButton(container, 'Send').disabled).toBe(true);
  });

  it('uses the Calibration Filfox URL when rendering testnet transactions', () => {
    const props = getBaseProps();
    props.chainId = 314159;
    props.networkLabel = 'Calibration Testnet';
    props.transactionState = 'pending';
    props.transactionHash = `0x${'a'.repeat(64)}` as `0x${string}`;

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const link = container.querySelector('a[href]') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toContain('https://calibration.filfox.info/en/message/');
    expect(container.textContent).toContain('Calibration Testnet');
  });

  it('INV-DUP-001 resets duplicate acknowledgment when the modal reopens', () => {
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

  it('renders selected execution semantics in review mode', () => {
    const props = getBaseProps();
    props.batchConfiguration = {
      ...DEFAULT_BATCH_CONFIGURATION,
      errorHandling: 'ATOMIC',
    };

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('Atomic');
    expect(container.textContent).toContain('Any failing transfer reverts the whole batch.');
    expect(container.textContent).not.toContain(
      'ThinBatch refunds failed payments while successful transfers continue.',
    );
  });

  it('blocks send when atomic preflight fails', () => {
    const props = getBaseProps();
    props.batchConfiguration = {
      ...DEFAULT_BATCH_CONFIGURATION,
      errorHandling: 'ATOMIC',
    };
    props.gasEstimationError = new BatchExecutionError({
      category: 'SIMULATION_REVERT',
      title: 'Atomic batch would revert',
      message:
        'At least one recipient call would fail. Because Atomic mode is all-or-nothing, the whole batch is blocked before submission.',
      errorMode: 'ATOMIC',
      stage: 'preflight',
      recoverable: true,
      hint: 'Correct the failing recipient rows and try again, or use Partial for best-effort delivery when available.',
      details: 'execution reverted: forward failed',
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('Atomic batch would revert');
    expect(getButton(container, 'Send').disabled).toBe(true);

    const technicalDetails = container.querySelector(
      '[data-testid="gas-estimation-technical-details"]',
    ) as HTMLDetailsElement;
    const summary = technicalDetails.querySelector('summary');

    expect(technicalDetails.tagName).toBe('DETAILS');
    expect(technicalDetails.open).toBe(false);
    expect(summary?.textContent).toContain('Technical details');
    expect(container.textContent).toContain('execution reverted: forward failed');

    click(summary as HTMLElement);
    expect(technicalDetails.open).toBe(true);
  });

  it('blocks send while EVM contract-recipient checks are pending', () => {
    const props = getBaseProps();
    props.isCheckingContractRecipients = true;

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('Checking 0x and f4 recipients');
    expect(container.textContent).toContain(
      'SendFIL is checking that those recipients are wallet addresses, not contracts.',
    );
    expect(getButton(container, 'Send').disabled).toBe(true);
  });

  it('renders atomic-specific failure guidance', () => {
    const props = getBaseProps();
    props.batchConfiguration = {
      ...DEFAULT_BATCH_CONFIGURATION,
      errorHandling: 'ATOMIC',
    };
    props.transactionState = 'failed';
    props.transactionError = new BatchExecutionError({
      category: 'ONCHAIN_REVERT_ATOMIC',
      title: 'Atomic batch reverted',
      message:
        'The transaction reached on-chain execution, but one internal call failed and reverted the entire batch. No transfers were finalized.',
      errorMode: 'ATOMIC',
      stage: 'confirmation',
      recoverable: true,
      hint: 'Correct the failing recipient rows and try again, or use Partial for best-effort delivery when available.',
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain(
      'No transfers are finalized if any internal call fails.',
    );
    expect(container.textContent).not.toContain(
      'Some transfers may already be finalized; failed payment value is refunded by ThinBatch unless the refund itself reverts.',
    );
    expect(
      container.querySelector('[data-testid="transaction-error-technical-details"]'),
    ).toBeNull();
  });

  it('does not present an inner multisig failure as a successful partial batch', () => {
    const props = getBaseProps();
    props.fundingMode = 'native-multisig';
    props.transactionState = 'failed';
    props.transactionHash = 'bafyfailedproposal';
    props.batchConfiguration = {
      ...DEFAULT_BATCH_CONFIGURATION,
      executionMethod: 'THINBATCH',
      errorHandling: 'PARTIAL',
      senderWalletType: 'MULTI_SIG',
    };
    props.transactionError = new BatchExecutionError({
      category: 'UNKNOWN',
      title: 'Multisig batch execution failed',
      message: 'The proposal was confirmed, but the batch failed with inner exit code 33.',
      errorMode: 'PARTIAL',
      stage: 'confirmation',
      recoverable: true,
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('Multisig batch execution failed');
    expect(container.textContent).toContain('Do not assume the batch executed successfully');
    expect(container.textContent).toContain('proposal message CID');
    expect(container.textContent).not.toContain('Some transfers may already be finalized');
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain(
      'bafyfailedproposal',
    );
  });

  it('states that no multisig proposal was submitted when failure has no CID', () => {
    const props = getBaseProps();
    props.fundingMode = 'native-multisig';
    props.transactionState = 'failed';
    props.transactionError = new BatchExecutionError({
      category: 'WALLET_FAILURE',
      title: 'Wallet signing failed',
      message: 'Ledger could not sign the Filecoin message.',
      errorMode: 'ATOMIC',
      stage: 'execution',
      recoverable: true,
      hint: 'Keep the Filecoin app open and try again.',
      details: 'Ledger device: Invalid data received (0x6a80)',
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain(
      'No multisig proposal was submitted, so the batch did not execute.',
    );
    expect(container.textContent).toContain('Ledger device: Invalid data received (0x6a80)');
    expect(container.querySelector('a[href]')).toBeNull();

    const technicalDetails = container.querySelector(
      '[data-testid="transaction-error-technical-details"]',
    ) as HTMLDetailsElement;
    expect(technicalDetails.open).toBe(false);
  });

  it('does not offer retry when a confirmed multisig outcome cannot be verified', () => {
    const props = getBaseProps();
    props.fundingMode = 'native-multisig';
    props.transactionState = 'failed';
    props.transactionHash = 'bafyunknownoutcome';
    props.transactionError = new BatchExecutionError({
      category: 'UNKNOWN',
      title: 'Could not verify multisig batch outcome',
      message: 'The proposal was confirmed, but its actor return could not be decoded.',
      errorMode: 'ATOMIC',
      stage: 'confirmation',
      recoverable: false,
      hint: 'Inspect the confirmed CID before retrying to avoid a duplicate batch.',
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain('Could not verify multisig batch outcome');
    expect(container.textContent).toContain('avoid a duplicate batch');
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Try Again',
      ),
    ).toBe(false);
  });

  it('presents a known-CID native uncertainty as recheck-only', () => {
    const props = getBaseProps();
    props.transactionState = 'failed';
    props.transactionHash =
      'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';
    props.onRecheckTransaction = vi.fn().mockResolvedValue(undefined);
    props.transactionError = new BatchExecutionError({
      category: 'RPC_FAILURE',
      title: 'Native batch confirmation is uncertain',
      message:
        'SendFIL could not prove that the batch reached a terminal on-chain result.',
      errorMode: 'ATOMIC',
      stage: 'confirmation',
      recoverable: false,
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    expect(container.textContent).toContain(
      'The original transaction may still execute. Do not submit another transaction while its status is unresolved.',
    );
    expect(container.textContent).not.toContain(
      'No transfers are finalized if any internal call fails.',
    );
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Try Again',
      ),
    ).toBe(false);
    expect(getButton(container, 'Check status again')).toBeDefined();
  });

  it('traps keyboard focus and restores the previously focused control on close', () => {
    const outsideButton = document.createElement('button');
    outsideButton.textContent = 'Outside';
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    const props = getBaseProps();

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const dialog = container.querySelector('[role="dialog"] > div') as HTMLDivElement;
    const lastButton = getButton(container, 'Send');
    expect(document.activeElement).toBe(dialog);

    lastButton.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });

    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Close modal');

    act(() => {
      root.render(<ReviewTransactionModal {...props} isOpen={false} />);
    });

    expect(document.activeElement).toBe(outsideButton);
    outsideButton.remove();
  });

  it('keeps the technical-details disclosure inside the failed-state focus trap', () => {
    const props = getBaseProps();
    props.fundingMode = 'native-multisig';
    props.transactionState = 'failed';
    props.transactionError = new BatchExecutionError({
      category: 'WALLET_FAILURE',
      title: 'Wallet signing failed',
      message: 'Ledger could not sign the Filecoin message.',
      errorMode: 'ATOMIC',
      stage: 'execution',
      recoverable: true,
      details: 'Ledger transport error',
    });

    act(() => {
      root.render(<ReviewTransactionModal {...props} />);
    });

    const summary = container.querySelector('summary') as HTMLElement;
    const tryAgainButton = getButton(container, 'Try Again');

    summary.focus();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tryAgainButton);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(summary);
  });
});
