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
const WRONG_SIGNER_ADDRESS = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 60),
  CoinType.TEST,
).toString();
const CONNECTED_SIGNER = createNativeFilecoinConnectedSender({
  address: SIGNER_ADDRESS,
  provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
  expectedNetworkKey: 'calibration',
}).sender!;
const WRONG_CONNECTED_SIGNER = createNativeFilecoinConnectedSender({
  address: WRONG_SIGNER_ADDRESS,
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
      isCreateActionInFlight: false,
      isCreateRetryBlocked: false,
      isProposalActionInFlight: false,
      isProposalRetryBlocked: false,
      onSelect: vi.fn(),
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      onCreate: vi.fn(),
      onRecheckCreate: vi.fn().mockResolvedValue(undefined),
      onApprove: vi.fn().mockResolvedValue('bafyapproval'),
      onCancel: vi.fn().mockResolvedValue('bafycancel'),
      onRecheckProposal: vi.fn().mockResolvedValue(undefined),
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
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
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
    expect(
      (
        container.querySelector(
          'button[aria-label="Remove multisig Treasury"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain('bafycancel');

    renderPanel({
      onCancel,
      proposalActionState: {
        action: 'cancel',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
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
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        signerAddress: SIGNER_ADDRESS,
        status: 'pending',
        cid: 'bafypending',
        error: 'The uncertainty safety lock could not be saved in this browser.',
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'safety lock could not be saved',
    );
  });

  it('blocks duplicate proposal actions and offers CID reconciliation when uncertain', async () => {
    const onRecheckProposal = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      savedMultisigs: [
        {
          address: ADDRESS,
          networkKey: 'calibration',
          label: 'Treasury',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
        {
          address: OTHER_ADDRESS,
          networkKey: 'calibration',
          label: 'Backup',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      proposalActionState: {
        action: 'approve',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        signerAddress: SIGNER_ADDRESS,
        status: 'uncertain',
        cid: 'bafyuncertainapproval',
        error: 'The approval result could not be proven.',
      },
      isProposalRetryBlocked: true,
      onRecheckProposal,
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be proven');
    expect(
      (container.querySelector('button[aria-label="Approve proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (container.querySelector('button[aria-label="Cancel proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        container.querySelector(
          'button[aria-label="Remove multisig Treasury"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (container.querySelector('button[aria-label="Select multisig Backup"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Clear',
      )?.disabled,
    ).toBe(true);
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain(
      'bafyuncertainapproval',
    );

    const recheck = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Recheck action result',
    ) as HTMLButtonElement;
    await act(async () => {
      recheck.click();
      await Promise.resolve();
    });
    expect(onRecheckProposal).toHaveBeenCalledTimes(1);
  });

  it('keeps only the recorded actor selectable when recovery starts from the wrong selection', async () => {
    const onSelect = vi.fn();
    renderPanel({
      isExternallyLocked: true,
      isRecoveryNavigationLocked: false,
      savedMultisigs: [
        {
          address: ADDRESS,
          networkKey: 'calibration',
          label: 'Treasury',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
        {
          address: OTHER_ADDRESS,
          networkKey: 'calibration',
          label: 'Backup',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      selectedAddress: OTHER_ADDRESS,
      selectedMultisig: createActor(OTHER_ADDRESS),
      proposalActionState: {
        action: 'cancel',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        signerAddress: SIGNER_ADDRESS,
        status: 'uncertain',
        cid: 'bafywrongselection',
        error: 'The cancellation result could not be proven.',
      },
      isProposalRetryBlocked: true,
      onSelect,
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('still needs reconciliation');
    expect(alert?.textContent).toContain(ADDRESS);
    expect(alert?.textContent).toContain('Calibration Testnet');
    expect(alert?.querySelector('a[href]')?.getAttribute('href')).toContain('bafywrongselection');
    expect(
      (
        container.querySelector(
          'button[aria-label="Select multisig Treasury"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        container.querySelector(
          'button[aria-label="Remove multisig Treasury"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (container.querySelector('button[aria-label="Select multisig Backup"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Clear',
      )?.disabled,
    ).toBe(false);
    expect(
      (container.querySelector('button[aria-label="Approve proposal #7"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    const selectRecordedActor = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Select recorded actor',
    ) as HTMLButtonElement;
    await act(async () => {
      selectRecordedActor.click();
      await Promise.resolve();
    });
    expect(onSelect).toHaveBeenCalledWith(ADDRESS);
  });

  it('does not freeze saved-actor selection for another signer\'s uncertain action', async () => {
    const onSelect = vi.fn();
    renderPanel({
      savedMultisigs: [
        {
          address: ADDRESS,
          networkKey: 'calibration',
          label: 'Treasury',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
        {
          address: OTHER_ADDRESS,
          networkKey: 'calibration',
          label: 'Backup',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      proposalActionState: {
        action: 'approve',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        signerAddress: WRONG_SIGNER_ADDRESS,
        status: 'uncertain',
        cid: 'bafyotheruseraction',
        error: 'Another signer must reconcile this approval.',
      },
      isProposalRetryBlocked: false,
      onSelect,
    });

    const selectBackup = container.querySelector(
      'button[aria-label="Select multisig Backup"]',
    ) as HTMLButtonElement;
    expect(selectBackup.disabled).toBe(false);

    await act(async () => {
      selectBackup.click();
      await Promise.resolve();
    });
    expect(onSelect).toHaveBeenCalledWith(OTHER_ADDRESS);
  });

  it('can select the recorded recovery actor when it is no longer saved locally', async () => {
    const onSelect = vi.fn();
    renderPanel({
      savedMultisigs: [
        {
          address: OTHER_ADDRESS,
          networkKey: 'calibration',
          label: 'Backup',
          addedAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      selectedAddress: OTHER_ADDRESS,
      selectedMultisig: createActor(OTHER_ADDRESS),
      proposalActionState: {
        action: 'cancel',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        signerAddress: SIGNER_ADDRESS,
        status: 'uncertain',
        cid: 'bafyunsavedactor',
        error: 'The cancellation result could not be proven.',
      },
      isProposalRetryBlocked: true,
      onSelect,
    });

    expect(container.querySelector('button[aria-label="Select multisig Treasury"]')).toBeNull();
    const selectRecordedActor = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Select recorded actor',
    ) as HTMLButtonElement;
    expect(selectRecordedActor.disabled).toBe(false);

    await act(async () => {
      selectRecordedActor.click();
      await Promise.resolve();
    });
    expect(onSelect).toHaveBeenCalledWith(ADDRESS);
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

  it('labels the approval threshold and initial deposit as separate create fields', async () => {
    renderPanel();

    await act(async () => {
      (
        container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(container.querySelector('input[aria-label="Approval threshold"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Initial deposit (FIL)"]')).not.toBeNull();
    expect(container.textContent).toContain(
      'The connected signer pays the initial deposit plus creation gas.',
    );

    const addSignerButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '+ Add signer',
    ) as HTMLButtonElement;
    await act(async () => {
      addSignerButton.click();
      await Promise.resolve();
    });

    const threshold = container.querySelector(
      'input[aria-label="Approval threshold"]',
    ) as HTMLInputElement;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(threshold, '2');
      threshold.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      threshold.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'Each signer needs a small FIL balance later to pay gas when submitting an approval.',
    );
  });

  it('adds safe context to a generic create fetch failure', async () => {
    renderPanel({
      onCreate: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    await act(async () => {
      (
        container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
      ).click();
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
      'could not reach the Filecoin RPC',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'inspect recent messages before trying again',
    );
  });

  it('normalizes a hook-provided generic create fetch failure', () => {
    renderPanel({
      createActionState: {
        status: 'failed',
        signerAddress: SIGNER_ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        error: 'Failed to fetch',
      },
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not reach the Filecoin RPC',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).not.toBe('Failed to fetch');
  });

  it.each([
    'Connected signer has 0 FIL. Fund it or connect a funded signer.',
    'Filecoin.StateActorCodeCIDs failed on both configured RPC endpoints.',
    'Lotus RPC Filecoin.StateActorCodeCIDs failed on mainnet after 2 endpoints: primary: JSON-RPC error -32601; fallback: Failed to fetch',
  ])('preserves a deterministic hook-provided create failure: %s', (error) => {
    renderPanel({
      createActionState: {
        status: 'failed',
        signerAddress: SIGNER_ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        error,
      },
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(error);
  });

  it('does not duplicate local and hook create completion status', async () => {
    const onCreate = vi.fn().mockResolvedValue({
      outcome: 'confirmed' as const,
      cid: 'bafycreatedonce',
      createdAddress: ADDRESS,
    });
    renderPanel({ onCreate });

    await act(async () => {
      (
        container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    const createButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Create multisig',
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
      await Promise.resolve();
    });

    renderPanel({
      onCreate,
      createActionState: {
        status: 'confirmed',
        cid: 'bafycreatedonce',
        createdAddress: ADDRESS,
        signerAddress: SIGNER_ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
      },
    });

    const completionStatuses = Array.from(
      container.querySelectorAll('[role="status"], [role="alert"]'),
    ).filter((element) => element.textContent?.includes('Multisig creation confirmed'));
    expect(completionStatuses).toHaveLength(1);
  });

  it('surfaces a pending create persistence warning while confirmation is unresolved', () => {
    renderPanel({
      createActionState: {
        status: 'pending',
        cid: 'bafypendingcreate',
        signerAddress: SIGNER_ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        warning: 'The uncertainty safety lock could not be saved in this browser.',
      },
      isCreateActionInFlight: true,
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'safety lock could not be saved',
    );
    expect(container.textContent).toContain('awaiting confirmation');
  });

  it('keeps a confirmed but unsaved multisig address visible for manual import', () => {
    renderPanel({
      createActionState: {
        status: 'confirmed',
        cid: 'bafycreated',
        createdAddress: ADDRESS,
        signerAddress: SIGNER_ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        warning: `The multisig was created at ${ADDRESS}, but it was not saved locally.`,
      },
    });

    expect(container.querySelector('code')?.textContent).toBe(ADDRESS);
    expect(container.textContent).toContain('was not saved locally');
  });

  it('uses neutral create-button recovery copy for a proposal-only lock', async () => {
    const onCreate = vi.fn();
    const onRecheckCreate = vi.fn();
    renderPanel({
      proposalActionState: {
        action: 'approve',
        proposalId: 7,
        multisigAddress: ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        signerAddress: SIGNER_ADDRESS,
        status: 'uncertain',
        cid: 'bafyproposalonly',
        error: 'The approval still needs reconciliation.',
      },
      isCreateRetryBlocked: true,
      isProposalRetryBlocked: true,
      onCreate,
      onRecheckCreate,
    });

    await act(async () => {
      (
        container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    const resolveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Resolve pending multisig action',
    ) as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(true);
    expect(container.textContent).not.toContain('Inspect submitted create');
    expect(container.textContent).not.toContain('Recheck create result');

    await act(async () => {
      resolveButton.click();
      await Promise.resolve();
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onRecheckCreate).not.toHaveBeenCalled();
  });

  it('uses neutral create-button recovery copy for a storage-only lock', async () => {
    const onCreate = vi.fn();
    const onRecheckCreate = vi.fn();
    renderPanel({
      uncertaintyStorageError:
        'SendFIL could not safely read its saved uncertain multisig actions.',
      isCreateRetryBlocked: true,
      isProposalRetryBlocked: true,
      onCreate,
      onRecheckCreate,
    });

    await act(async () => {
      (
        container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    const resolveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Resolve pending multisig action',
    ) as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(true);
    expect(container.textContent).not.toContain('Inspect submitted create');
    expect(container.textContent).not.toContain('Recheck create result');

    await act(async () => {
      resolveButton.click();
      await Promise.resolve();
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onRecheckCreate).not.toHaveBeenCalled();
  });

  it('shows an identity-bound uncertain create with its submitted network snapshot', async () => {
    const onRecheckCreate = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      createActionState: {
        status: 'uncertain',
        cid: 'bafycreatewarning',
        signerAddress: SIGNER_ADDRESS,
        networkKey: 'calibration',
        chainId: 314159,
        networkLabel: 'Calibration Testnet',
        warning: 'The create message was confirmed, but the actor address could not be verified.',
      },
      isCreateRetryBlocked: true,
      onRecheckCreate,
    });

    const createMode = container.querySelector(
      '[data-testid="multisig-mode-create"]',
    ) as HTMLButtonElement;
    await act(async () => {
      createMode.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'actor address could not be verified',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Calibration Testnet');
    expect(container.querySelector('a[href]')?.getAttribute('href')).toContain(
      'https://calibration.filfox.info/en/message/bafycreatewarning',
    );
    const recheckCreate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Recheck create result',
    ) as HTMLButtonElement;
    await act(async () => {
      recheckCreate.click();
      await Promise.resolve();
    });
    expect(onRecheckCreate).toHaveBeenCalledTimes(1);
    const blockedCreateButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Inspect submitted create',
    ) as HTMLButtonElement;
    expect(blockedCreateButton.disabled).toBe(true);

    await act(async () => {
      (container.querySelector('[data-testid="multisig-mode-add"]') as HTMLButtonElement).click();
      (
        container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('actor address could not be verified');
    expect(
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Inspect submitted create')
        ?.hasAttribute('disabled'),
    ).toBe(true);
  });

  it.each([
    ['a different signer', WRONG_CONNECTED_SIGNER],
    ['no connected signer', undefined],
  ] as const)(
    'shows global create recovery for %s without exposing identity-bound recheck',
    async (_, signer) => {
      const onRecheckCreate = vi.fn().mockResolvedValue(undefined);
      renderPanel({
        connectedSigner: signer,
        enabled: Boolean(signer),
        createActionState: {
          status: 'uncertain',
          cid: 'bafyglobalcreate',
          signerAddress: SIGNER_ADDRESS,
          networkKey: 'calibration',
          chainId: 314159,
          networkLabel: 'Calibration Testnet',
          warning: 'The submitted create still needs a proof-bearing result.',
        },
        isCreateRetryBlocked: false,
        onRecheckCreate,
      });

      const recovery = container.querySelector('[data-testid="unresolved-create-recovery"]');
      expect(recovery?.textContent).toContain('still needs a proof-bearing result');
      expect(recovery?.textContent).toContain(SIGNER_ADDRESS);
      expect(recovery?.textContent).toContain('Calibration Testnet');
      expect(recovery?.textContent).toContain('bafyglobalcreate');
      expect(recovery?.querySelector('a[href]')?.getAttribute('href')).toContain(
        'https://calibration.filfox.info/en/message/bafyglobalcreate',
      );
      expect(
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === 'Recheck create result',
        ),
      ).toBeUndefined();

      await act(async () => {
        (
          container.querySelector('[data-testid="multisig-mode-create"]') as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });

      const createButton = Array.from(container.querySelectorAll('button')).find((button) =>
        ['Create multisig', 'Connect signer to create'].includes(button.textContent?.trim() ?? ''),
      ) as HTMLButtonElement;
      expect(createButton.textContent).toContain(signer ? 'Create multisig' : 'Connect signer');
      expect(createButton.disabled).toBe(!signer);
      expect(onRecheckCreate).not.toHaveBeenCalled();
    },
  );
});
