import { act, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { getNetworkConfig } from '../../../lib/networks';
import {
  FILSNAP_FILECOIN_PROVIDER_METADATA,
  createNativeFilecoinConnectedSender,
} from '../../../lib/senders';
import type {
  MultisigActorState,
  MultisigPendingProposal,
  NativeMultisigAddress,
} from '../../../lib/multisig';
import { MultisigFundingPanel } from '../MultisigFundingPanel';

const ADDRESS = 't2selected' as NativeMultisigAddress;
const OTHER_ADDRESS = 't2other' as NativeMultisigAddress;
const SIGNER_ADDRESS = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 10),
  CoinType.TEST,
).toString();
const CONNECTED_SIGNER = createNativeFilecoinConnectedSender({
  address: SIGNER_ADDRESS,
  provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  expectedNetworkKey: 'calibration',
}).sender!;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createActor(address = ADDRESS): MultisigActorState {
  return {
    address,
    networkKey: 'calibration',
    balanceAttoFil: 2n * 10n ** 18n,
    availableBalanceAttoFil: 2n * 10n ** 18n,
    threshold: 2,
    signers: ['t1signer-a', 't1signer-b'],
    signerIdAddresses: ['t01001', 't01002'],
    connectedSignerIdAddress: 't01002',
    connectedSignerCanApprove: true,
  };
}

function createProposal(): MultisigPendingProposal {
  return {
    id: 7,
    proposer: 't01001',
    proposerIdAddress: 't01001',
    to: 't410ftarget',
    valueAttoFil: 10n ** 18n + 1n,
    method: 3_844_450_837,
    paramsBase64: '',
    paramsBytes: new Uint8Array(),
    approvals: ['t01001'],
    approvalIdAddresses: ['t01001'],
    connectedSignerHasApproved: false,
    isSendFilCompatible: true,
    decodedBatch: {
      executionMethod: 'STANDARD',
      errorMode: 'ATOMIC',
      recipientCount: 2,
      totalValueAttoFil: '1000000000000000001',
      payments: [
        {
          index: 0,
          kind: 'FILECOIN',
          recipient: 't1recipient-a',
          amountAttoFil: '1000000000000000000',
        },
        {
          index: 1,
          kind: 'EVM',
          recipient: '0x1111111111111111111111111111111111111111',
          amountAttoFil: '1',
        },
      ],
    },
    canApprove: true,
    canCancel: true,
  };
}

describe('MultisigFundingPanel interactions', () => {
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
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  function renderPanel(overrides: Partial<ComponentProps<typeof MultisigFundingPanel>> = {}) {
    const proposal = createProposal();
    const props: ComponentProps<typeof MultisigFundingPanel> = {
      enabled: true,
      network: getNetworkConfig('calibration'),
      connectedSigner: CONNECTED_SIGNER,
      savedMultisigs: [
        {
          address: ADDRESS,
          networkKey: 'calibration',
          label: 'Treasury',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      selectedAddress: ADDRESS,
      selectedMultisig: createActor(),
      pendingProposals: [proposal],
      isLoadingSelected: false,
      onSelect: vi.fn(),
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      onCreate: vi.fn(),
      onApprove: vi.fn().mockResolvedValue('bafyapproval'),
      onCancel: vi.fn().mockResolvedValue('bafycancel'),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };

    act(() => root.render(<MultisigFundingPanel {...props} />));
    return { props, proposal };
  }

  it('single-flights proposal actions and links the submitted message', async () => {
    const approval = createDeferred<string>();
    const onApprove = vi.fn(() => approval.promise);
    renderPanel({ onApprove });

    const approve = container.querySelector(
      'button[aria-label="Approve proposal #7"]',
    ) as HTMLButtonElement;
    const cancel = container.querySelector(
      'button[aria-label="Cancel proposal #7"]',
    ) as HTMLButtonElement;

    await act(async () => {
      approve.click();
      await Promise.resolve();
    });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(approve.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(approve.textContent).toContain('Approving...');
    expect(
      container.querySelector('[data-testid="multisig-funding-panel"]')?.getAttribute('aria-busy'),
    ).toBe('true');

    await act(async () => {
      approval.resolve('bafyapproval');
      await approval.promise;
    });

    expect(container.textContent).toContain('Approval submitted.');
    const link = container.querySelector('a[href]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain(
      'https://calibration.filfox.info/en/message/bafyapproval',
    );
  });

  it('submits cancellation through the UI and locks actions through confirmation', async () => {
    const cancellation = createDeferred<string>();
    const onCancel = vi.fn(() => cancellation.promise);
    const { proposal } = renderPanel({ onCancel });

    const approve = container.querySelector(
      'button[aria-label="Approve proposal #7"]',
    ) as HTMLButtonElement;
    const cancel = container.querySelector(
      'button[aria-label="Cancel proposal #7"]',
    ) as HTMLButtonElement;

    await act(async () => {
      cancel.click();
      await Promise.resolve();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(proposal);
    expect(approve.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(cancel.textContent).toContain('Cancelling...');
    expect(
      container.querySelector('[data-testid="multisig-funding-panel"]')?.getAttribute('aria-busy'),
    ).toBe('true');

    await act(async () => {
      cancellation.resolve('bafycancel');
      await cancellation.promise;
    });

    expect(container.textContent).toContain('Cancellation submitted.');
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain(
      'https://calibration.filfox.info/en/message/bafycancel',
    );

    renderPanel({
      onCancel,
      proposalActionState: {
        action: 'cancel',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        signerAddress: SIGNER_ADDRESS,
        status: 'pending',
        cid: 'bafycancel',
      },
    });

    expect(container.textContent).toContain('Cancellation submitted and awaiting confirmation.');
    expect(
      (container.querySelector('button[aria-label="Approve proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (container.querySelector('button[aria-label="Cancel proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain('bafycancel');

    renderPanel({
      onCancel,
      proposalActionState: {
        action: 'cancel',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        signerAddress: SIGNER_ADDRESS,
        status: 'confirmed',
        cid: 'bafycancel',
        outcome: 'cancelled',
      },
    });

    expect(container.textContent).toContain('Proposal cancellation confirmed.');
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain('bafycancel');
  });

  it('shows every strictly decoded payment before approval', () => {
    renderPanel();

    const decoded = container.querySelector('[data-testid="proposal-7-decoded-batch"]');

    expect(decoded?.textContent).toContain('Standard');
    expect(decoded?.textContent).toContain('Atomic');
    expect(decoded?.textContent).toContain('2 payments');
    expect(decoded?.textContent).toContain('t1recipient-a');
    expect(decoded?.textContent).toContain('1 FIL');
    expect(decoded?.textContent).toContain('0x1111111111111111111111111111111111111111');
    expect(decoded?.textContent).toContain('0.000000000000000001 FIL');
  });

  it('keeps actions locked and exposes the CID while confirmation is pending', () => {
    renderPanel({
      proposalActionState: {
        action: 'approve',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        signerAddress: SIGNER_ADDRESS,
        status: 'pending',
        cid: 'bafypending',
      },
    });

    expect(container.textContent).toContain('Approval submitted and awaiting confirmation.');
    expect(
      (container.querySelector('button[aria-label="Approve proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (container.querySelector('button[aria-label="Cancel proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((container.querySelector('a[href]') as HTMLAnchorElement).href).toContain('bafypending');
  });

  it('requires explicit acknowledgment before approving duplicate payments', async () => {
    const proposal = createProposal();
    proposal.decodedBatch = {
      ...proposal.decodedBatch!,
      payments: [
        proposal.decodedBatch!.payments[0]!,
        { ...proposal.decodedBatch!.payments[0]!, index: 1 },
      ],
      recipientCount: 2,
      totalValueAttoFil: '2000000000000000000',
    };
    const onApprove = vi.fn().mockResolvedValue('bafyduplicateapproval');
    renderPanel({ pendingProposals: [proposal], onApprove });

    const approve = container.querySelector(
      'button[aria-label="Approve proposal #7"]',
    ) as HTMLButtonElement;
    const acknowledgment = container.querySelector(
      'input[aria-label="Acknowledge duplicate payments in proposal #7"]',
    ) as HTMLInputElement;

    expect(approve.disabled).toBe(true);

    await act(async () => {
      acknowledgment.click();
      await Promise.resolve();
    });

    expect(approve.disabled).toBe(false);
    await act(async () => {
      approve.click();
      await Promise.resolve();
    });

    expect(onApprove).toHaveBeenCalledWith(proposal, true);
  });

  it('does not render stale actor details or actions for a different selection', () => {
    renderPanel({ selectedMultisig: createActor(OTHER_ADDRESS) });

    expect(container.textContent).toContain(ADDRESS);
    expect(container.textContent).not.toContain('2 / 2');
    expect(container.querySelector('button[aria-label="Approve proposal #7"]')).toBeNull();
  });

  it('exposes refresh and saved-actor controls with specific accessible names', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onRefresh });

    const selected = container.querySelector(
      'button[aria-label="Select multisig Treasury"]',
    ) as HTMLButtonElement;
    const refresh = container.querySelector(
      `button[aria-label="Refresh multisig ${ADDRESS}"]`,
    ) as HTMLButtonElement;

    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('button[aria-label="Remove multisig Treasury"]')).not.toBeNull();

    await act(async () => {
      refresh.click();
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows a warning instead of clean success when creation cannot be verified', async () => {
    renderPanel({
      onCreate: vi.fn().mockResolvedValue({
        cid: 'bafycreatewarning',
        warning: 'The create message was confirmed, but the actor address could not be verified.',
      }),
    });

    const createMode = container.querySelector(
      '[data-testid="multisig-mode-create"]',
    ) as HTMLButtonElement;
    await act(async () => {
      createMode.click();
      await Promise.resolve();
    });

    const createButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Create multisig',
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'actor address could not be verified',
    );
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain('bafycreatewarning');
  });
});
