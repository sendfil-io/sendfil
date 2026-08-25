import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import type { Connector } from 'wagmi';
import type { NativeFilecoinWalletProvider } from '../../lib/senders';
import { TERMS_LAST_UPDATED } from '../../legal/termsAcceptance';
import { CustomConnectButton } from '../CustomConnectButton';

const walletMocks = vi.hoisted(() => ({
  connectAsync: vi.fn(),
  connectors: [] as Connector[],
  disconnect: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useConnect: () => ({
    connectAsync: walletMocks.connectAsync,
    connectors: walletMocks.connectors,
  }),
  useDisconnect: () => ({
    disconnect: walletMocks.disconnect,
  }),
}));

vi.mock('@rainbow-me/rainbowkit', () => ({
  ConnectButton: {
    Custom: ({
      children,
    }: {
      children: (value: {
        account: undefined;
        authenticationStatus: undefined;
        chain: undefined;
        mounted: boolean;
        openChainModal: () => void;
      }) => ReactNode;
    }) =>
      children({
        account: undefined,
        authenticationStatus: undefined,
        chain: undefined,
        mounted: true,
        openChainModal: vi.fn(),
      }),
  },
}));

const METAMASK_CONNECTOR = {
  id: 'metaMask',
  name: 'MetaMask',
  type: 'injected',
  uid: 'metamask-test',
} as Connector;

const NATIVE_PROVIDER = {
  metadata: {
    id: 'filsnap-filecoin',
    name: 'FilSnap (Filecoin)',
    kind: 'native-filecoin-wallet',
    status: 'available',
    capabilities: {
      canConnect: true,
      canDisconnect: true,
      canDetectNetwork: true,
      canReadBalance: true,
      canSignBatch: true,
      canSubmit: true,
      oneApprovalPerBatch: true,
    },
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getAccount: vi.fn(),
  getBalance: vi.fn(),
} as NativeFilecoinWalletProvider;

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button with label "${label}"`);
  }

  return button;
}

function getTermsCheckbox(): HTMLInputElement {
  const checkbox = document.querySelector('[data-testid="wallet-terms-acknowledgment"]');

  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error('Could not find the wallet Terms acknowledgment checkbox');
  }

  return checkbox;
}

function click(element: HTMLElement) {
  act(() => {
    element.click();
  });
}

async function clickAndFlush(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

describe('CustomConnectButton Terms gating', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    walletMocks.connectAsync.mockReset();
    walletMocks.connectAsync.mockResolvedValue(undefined);
    walletMocks.connectors = [];
    walletMocks.disconnect.mockReset();

    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://sendfil.io/',
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

  it('blocks an EVM wallet choice until explicit assent, then accepts before connecting', async () => {
    const onAcceptTerms = vi.fn();
    const onOpenTerms = vi.fn();
    walletMocks.connectors = [METAMASK_CONNECTOR];

    act(() => {
      root.render(
        <CustomConnectButton
          hasAcceptedTerms={false}
          onAcceptTerms={onAcceptTerms}
          onOpenTerms={onOpenTerms}
        />,
      );
    });

    click(getButton('Connect Wallet'));

    const chooser = document.querySelector<HTMLElement>('[role="dialog"]');
    const walletButton = getButton('MetaMask');
    const termsLink = document.querySelector<HTMLAnchorElement>('a[href="/?terms=1"]');
    const termsCheckbox = getTermsCheckbox();

    expect(chooser?.getAttribute('aria-labelledby')).toBe('wallet-chooser-title');
    expect(document.activeElement).toBe(chooser);
    expect(document.body.style.overflow).toBe('hidden');
    expect(termsCheckbox.getAttribute('aria-label')).toBe(
      `I confirm I am an invited Louisiana business user participating only in the fee-free Calibration beta and agree to the Terms of Service effective ${TERMS_LAST_UPDATED}`,
    );
    expect(walletButton.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      `I confirm that I am an invited Louisiana business user participating only in the fee-free Calibration beta, and I have read and agree to the Terms of Service, effective ${TERMS_LAST_UPDATED}.`,
    );

    if (!termsLink) {
      throw new Error('Could not find the Terms of Service link');
    }

    click(termsLink);
    expect(onOpenTerms).toHaveBeenCalledTimes(1);

    click(getTermsCheckbox());
    expect(getButton('MetaMask').disabled).toBe(false);

    await clickAndFlush(getButton('MetaMask'));

    expect(onAcceptTerms).toHaveBeenCalledTimes(1);
    expect(walletMocks.connectAsync).toHaveBeenCalledWith({
      connector: METAMASK_CONNECTOR,
    });
    expect(onAcceptTerms.mock.invocationCallOrder[0]).toBeLessThan(
      walletMocks.connectAsync.mock.invocationCallOrder[0]!,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('closes the wallet chooser on Escape and restores focus to its trigger', () => {
    act(() => {
      root.render(
        <CustomConnectButton
          hasAcceptedTerms={false}
          onAcceptTerms={vi.fn()}
          onOpenTerms={vi.fn()}
        />,
      );
    });

    const trigger = getButton('Connect Wallet');
    trigger.focus();
    click(trigger);

    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
  });

  it('applies the same explicit-assent gate to a native Filecoin wallet', async () => {
    const onAcceptTerms = vi.fn();
    const onConnect = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <CustomConnectButton
          hasAcceptedTerms={false}
          onAcceptTerms={onAcceptTerms}
          onOpenTerms={vi.fn()}
          nativeFilecoin={{
            providers: [NATIVE_PROVIDER],
            onConnect,
            onDisconnect: vi.fn().mockResolvedValue(undefined),
          }}
        />,
      );
    });

    click(getButton('Connect Wallet'));
    expect(getButton('FilSnap (Filecoin)').disabled).toBe(true);

    click(getTermsCheckbox());
    expect(getButton('FilSnap (Filecoin)').disabled).toBe(false);

    await clickAndFlush(getButton('FilSnap (Filecoin)'));

    expect(onAcceptTerms).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(NATIVE_PROVIDER, 'mainnet');
    expect(onAcceptTerms.mock.invocationCallOrder[0]).toBeLessThan(
      onConnect.mock.invocationCallOrder[0]!,
    );
  });

  it('records assent from the checked wallet selection even when connection is rejected', async () => {
    const onAcceptTerms = vi.fn();
    walletMocks.connectors = [METAMASK_CONNECTOR];
    walletMocks.connectAsync.mockRejectedValueOnce(new Error('User rejected the request.'));

    act(() => {
      root.render(
        <CustomConnectButton
          hasAcceptedTerms={false}
          onAcceptTerms={onAcceptTerms}
          onOpenTerms={vi.fn()}
        />,
      );
    });

    click(getButton('Connect Wallet'));
    click(getTermsCheckbox());
    await clickAndFlush(getButton('MetaMask'));

    expect(onAcceptTerms).toHaveBeenCalledTimes(1);
    expect(walletMocks.connectAsync).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('User rejected the request.');
  });

  it('shows the accepted Terms copy without asking for a second checkbox', () => {
    walletMocks.connectors = [METAMASK_CONNECTOR];

    act(() => {
      root.render(
        <CustomConnectButton hasAcceptedTerms onAcceptTerms={vi.fn()} onOpenTerms={vi.fn()} />,
      );
    });

    click(getButton('Connect Wallet'));

    expect(document.querySelector('[data-testid="wallet-terms-acknowledgment"]')).toBeNull();
    expect(document.body.textContent).toContain(
      'Invited Louisiana businesses • Calibration beta only.',
    );
    expect(document.body.textContent).toContain(
      'By selecting a wallet and connecting, you reaffirm the Terms of Service.',
    );
    expect(getButton('MetaMask').disabled).toBe(false);
  });
});
