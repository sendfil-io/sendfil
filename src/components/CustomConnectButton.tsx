import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useConnect, useDisconnect, type Connector } from 'wagmi';
import {
  getDefaultNetworkKey,
  getNetworkConfig,
  getSupportedNetworkByChainId,
  getSupportedNetworkListLabel,
  type SendFilNetworkConfig,
  type SendFilNetworkKey,
} from '../lib/networks';
import {
  createEvmConnectedSender,
  getSenderDisplayAddress,
  type NativeFilecoinConnectedSender,
  type NativeFilecoinWalletProvider,
} from '../lib/senders';
import { truncateAddress } from '../utils/addressConverter';
import ledgerLLogo from '../assets/ledger-l-logo.svg';
import metamaskFoxLogo from '../assets/metamask-fox.png';
import { TERMS_LAST_UPDATED } from '../legal/termsAcceptance';
import TermsOfServiceLink from './TermsOfServiceLink';

const E2E_MOCK_WALLET_ENABLED = import.meta.env.VITE_E2E_MOCK_WALLET === 'true';

const primaryActionShadow =
  'shadow-[0_18px_36px_-26px_rgba(31,105,255,0.82),0_14px_32px_-28px_rgba(60,212,160,0.22)]';

interface NativeWalletConnectionProps {
  providers: NativeFilecoinWalletProvider[];
  connectedSender?: NativeFilecoinConnectedSender;
  balanceLabel?: string;
  connectionError?: string;
  onConnect: (
    provider: NativeFilecoinWalletProvider,
    networkKey: SendFilNetworkKey,
  ) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClearConnectionError?: () => void;
}

export interface CustomConnectButtonProps {
  disabled?: boolean;
  hasAcceptedTerms: boolean;
  nativeFilecoin?: NativeWalletConnectionProps;
  onAcceptTerms: () => void;
  onOpenTerms: () => void;
}

const nativeWalletLogos: Record<string, { alt: string; className: string; src: string }> = {
  'filsnap-filecoin': {
    alt: 'MetaMask',
    className: 'h-8 w-8 rounded-lg object-contain',
    src: metamaskFoxLogo,
  },
  'ledger-filecoin': {
    alt: 'Ledger',
    className: 'h-8 w-8 object-contain',
    src: ledgerLLogo,
  },
};

interface WalletLogo {
  alt: string;
  className: string;
  src?: string;
}

interface RainbowKitConnectorDetails {
  iconUrl?: string | (() => Promise<string>);
  id?: string;
  name?: string;
}

type RainbowKitConnector = Connector & {
  rkDetails?: RainbowKitConnectorDetails;
};

interface WalletOptionButtonProps {
  description?: string;
  disabled: boolean;
  isConnecting: boolean;
  label: string;
  logo: WalletLogo;
  onClick: () => void;
}

function WalletOptionButton({
  description,
  disabled,
  isConnecting,
  label,
  logo,
  onClick,
}: WalletOptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold text-slate-950">
          {isConnecting ? `${label}...` : label}
        </span>
        {description ? (
          <span className="mt-1 block text-sm text-slate-500">{description}</span>
        ) : null}
      </span>
      {logo.src ? (
        <img src={logo.src} alt={logo.alt} className={`shrink-0 ${logo.className}`} />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold uppercase text-slate-600">
          {label.slice(0, 2)}
        </span>
      )}
    </button>
  );
}

const nativeWalletDescriptions: Record<string, string> = {
  'filsnap-filecoin': 'MetaMask Snap for native Filecoin accounts',
  'ledger-filecoin': 'Filecoin app within Ledger wallet',
};

const nativeNetworkOptions: SendFilNetworkConfig[] = [
  getNetworkConfig('mainnet'),
  getNetworkConfig('calibration'),
];

function normalizeWalletName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getRainbowKitConnectorDetails(
  connector: Connector,
): RainbowKitConnectorDetails | undefined {
  return (connector as RainbowKitConnector).rkDetails;
}

function getEvmWalletKey(connector: Connector): string {
  return getRainbowKitConnectorDetails(connector)?.id ?? connector.id ?? connector.uid;
}

function getEvmWalletLabel(connector: Connector): string {
  return getRainbowKitConnectorDetails(connector)?.name ?? connector.name;
}

function getEvmWalletSortIndex(connector: Connector): number {
  const normalizedName = normalizeWalletName(
    `${getEvmWalletKey(connector)} ${getEvmWalletLabel(connector)}`,
  );

  if (normalizedName.includes('metamask')) {
    return 0;
  }

  if (normalizedName.includes('brave')) {
    return 1;
  }

  if (normalizedName.includes('walletconnect')) {
    return 2;
  }

  return 10;
}

function getVisibleEvmConnectors(connectors: readonly Connector[]): Connector[] {
  const seenWallets = new Set<string>();

  return [...connectors]
    .sort((left, right) => getEvmWalletSortIndex(left) - getEvmWalletSortIndex(right))
    .filter((connector) => {
      const walletKey = normalizeWalletName(getEvmWalletLabel(connector));

      if (seenWallets.has(walletKey)) {
        return false;
      }

      seenWallets.add(walletKey);
      return true;
    });
}

function getEvmWalletLogo(connector: Connector, iconSrc?: string): WalletLogo {
  const label = getEvmWalletLabel(connector);
  const normalizedName = normalizeWalletName(`${getEvmWalletKey(connector)} ${label}`);

  if (normalizedName.includes('metamask')) {
    return {
      alt: 'MetaMask',
      className: 'h-8 w-8 rounded-lg object-contain',
      src: metamaskFoxLogo,
    };
  }

  return {
    alt: label,
    className: 'h-8 w-8 rounded-lg object-contain',
    src: iconSrc ?? connector.icon,
  };
}

function renderModalPortal(content: React.ReactNode): React.ReactNode {
  if (typeof document === 'undefined') {
    return content;
  }

  return createPortal(content, document.body);
}

export const CustomConnectButton: React.FC<CustomConnectButtonProps> = ({
  disabled = false,
  hasAcceptedTerms,
  nativeFilecoin,
  onAcceptTerms,
  onOpenTerms,
}) => {
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showNativeNetworkChooser, setShowNativeNetworkChooser] = useState(false);
  const [showWalletChooser, setShowWalletChooser] = useState(false);
  const [connectingNativeProviderId, setConnectingNativeProviderId] = useState<string | null>(null);
  const [preparedNativeProviderIds, setPreparedNativeProviderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [connectingEvmConnectorUid, setConnectingEvmConnectorUid] = useState<string | null>(null);
  const [switchingNativeNetworkKey, setSwitchingNativeNetworkKey] =
    useState<SendFilNetworkKey | null>(null);
  const [evmWalletConnectionError, setEvmWalletConnectionError] = useState<string | undefined>();
  const [evmWalletIcons, setEvmWalletIcons] = useState<Record<string, string>>({});
  const [hasAcknowledgedTermsForConnection, setHasAcknowledgedTermsForConnection] = useState(false);
  const walletChooserRef = useRef<HTMLDivElement>(null);
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const mockNetwork =
    getSupportedNetworkByChainId(Number(import.meta.env.VITE_E2E_CHAIN_ID ?? '314')) ??
    getSupportedNetworkByChainId(314);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  React.useEffect(() => {
    let cancelled = false;

    connectors.forEach((connector) => {
      const walletKey = getEvmWalletKey(connector);
      const iconUrl = getRainbowKitConnectorDetails(connector)?.iconUrl;

      if (!iconUrl || evmWalletIcons[walletKey]) {
        return;
      }

      void Promise.resolve(typeof iconUrl === 'function' ? iconUrl() : iconUrl)
        .then((src) => {
          if (cancelled || !src) {
            return;
          }

          setEvmWalletIcons((current) =>
            current[walletKey] ? current : { ...current, [walletKey]: src },
          );
        })
        .catch(() => {
          // Logo loading is cosmetic; keep the text row usable if RainbowKit changes an asset.
        });
    });

    return () => {
      cancelled = true;
    };
  }, [connectors, evmWalletIcons]);

  React.useEffect(() => {
    if (!showWalletChooser || !nativeFilecoin?.providers.length) {
      return undefined;
    }

    let cancelled = false;

    nativeFilecoin.providers.forEach((provider) => {
      if (!provider.prepareConnect || preparedNativeProviderIds.has(provider.metadata.id)) {
        return;
      }

      void provider
        .prepareConnect({ networkKey: getDefaultNetworkKey() })
        .catch(() => {
          // Keep the row connectable; the connect action reports actionable Ledger guidance.
        })
        .finally(() => {
          if (cancelled) {
            return;
          }

          setPreparedNativeProviderIds((current) => {
            if (current.has(provider.metadata.id)) {
              return current;
            }

            const next = new Set(current);
            next.add(provider.metadata.id);
            return next;
          });
        });
    });

    return () => {
      cancelled = true;
    };
  }, [nativeFilecoin?.providers, preparedNativeProviderIds, showWalletChooser]);

  React.useEffect(() => {
    if (!showWalletChooser) {
      return undefined;
    }

    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    walletChooserRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const chooser = walletChooserRef.current;

      if (!chooser || !chooser.contains(document.activeElement)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setShowWalletChooser(false);
        setHasAcknowledgedTermsForConnection(false);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = Array.from(
        chooser.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        chooser.focus();
        return;
      }

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || activeElement === chooser)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus();
      }
    };
  }, [showWalletChooser]);

  if (E2E_MOCK_WALLET_ENABLED) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-medium text-white">
          {mockNetwork?.walletLabel ?? 'Filecoin Mainnet'}
        </div>
        <div
          className={`rounded-full bg-[#4a84ea] px-4 py-4 text-left font-mono text-sm text-white ${primaryActionShadow}`}
          data-testid="mock-wallet-chip"
        >
          <div className="text-base font-semibold">Test Wallet</div>
          <div className="mt-1 text-sm text-blue-100">Ready for E2E</div>
        </div>
      </div>
    );
  }

  return (
    <ConnectButton.Custom>
      {({ account, chain, openChainModal, authenticationStatus, mounted }) => {
        const ready = mounted && authenticationStatus !== 'loading';
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === 'authenticated');
        const supportedNetwork = chain ? getSupportedNetworkByChainId(chain.id) : undefined;
        const connectedSender =
          account && supportedNetwork
            ? createEvmConnectedSender({
                address: account.address,
                chainId: supportedNetwork.chainId,
                isConnected: true,
              })
            : undefined;
        const senderDisplayAddress = connectedSender
          ? getSenderDisplayAddress(connectedSender)
          : account?.address;
        const networkLabel = supportedNetwork?.walletLabel ?? chain?.name;

        const nativeConnectedSender = nativeFilecoin?.connectedSender;
        const hasNativeWalletProviders = Boolean(nativeFilecoin?.providers.length);
        const evmConnectors = getVisibleEvmConnectors(connectors);
        const hasEvmConnectors = evmConnectors.length > 0;
        const isConnectingWallet = Boolean(connectingNativeProviderId || connectingEvmConnectorUid);
        const connectionError = nativeFilecoin?.connectionError ?? evmWalletConnectionError;
        const canConnectUnderCurrentTerms = hasAcceptedTerms || hasAcknowledgedTermsForConnection;

        const closeWalletChooser = () => {
          setShowWalletChooser(false);
          setHasAcknowledgedTermsForConnection(false);
        };

        const handleNativeConnect = async (provider: NativeFilecoinWalletProvider) => {
          if (disabled || !nativeFilecoin || !canConnectUnderCurrentTerms) {
            return;
          }

          setEvmWalletConnectionError(undefined);
          setConnectingNativeProviderId(provider.metadata.id);

          try {
            onAcceptTerms();
            await nativeFilecoin.onConnect(provider, getDefaultNetworkKey());
            closeWalletChooser();
          } finally {
            setConnectingNativeProviderId(null);
          }
        };

        const handleNativeNetworkSwitch = async (networkKey: SendFilNetworkKey) => {
          if (disabled || !nativeFilecoin || !nativeConnectedSender) {
            return;
          }

          if (networkKey === nativeConnectedSender.networkKey) {
            setShowNativeNetworkChooser(false);
            return;
          }

          const activeProvider = nativeFilecoin.providers.find(
            (provider) => provider.metadata.id === nativeConnectedSender.provider.id,
          );

          if (!activeProvider) {
            return;
          }

          setEvmWalletConnectionError(undefined);
          nativeFilecoin.onClearConnectionError?.();
          setSwitchingNativeNetworkKey(networkKey);

          try {
            await nativeFilecoin.onConnect(activeProvider, networkKey);
            setShowNativeNetworkChooser(false);
          } finally {
            setSwitchingNativeNetworkKey(null);
          }
        };

        const handleEvmConnect = async (connector: Connector) => {
          if (disabled || !canConnectUnderCurrentTerms) {
            return;
          }

          const walletLabel = getEvmWalletLabel(connector);

          setEvmWalletConnectionError(undefined);
          nativeFilecoin?.onClearConnectionError?.();
          setConnectingEvmConnectorUid(connector.uid);

          try {
            onAcceptTerms();
            await connectAsync({ connector });
            closeWalletChooser();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : `Failed to connect ${walletLabel}.`;

            setEvmWalletConnectionError(message);
          } finally {
            setConnectingEvmConnectorUid(null);
          }
        };

        const renderWalletChooser = () => {
          return (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6 sm:items-center">
              <div
                ref={walletChooserRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="wallet-chooser-title"
                tabIndex={-1}
                className="relative max-h-[calc(100vh-3rem)] w-full max-w-md overflow-y-auto rounded-[24px] bg-white p-6 shadow-2xl"
              >
                <button
                  type="button"
                  onClick={closeWalletChooser}
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                  aria-label="Close"
                >
                  ×
                </button>

                <div className="pr-10">
                  <h3 id="wallet-chooser-title" className="text-lg font-semibold text-slate-950">
                    Connect a Wallet
                  </h3>
                </div>

                <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  {hasAcceptedTerms ? (
                    <div className="text-sm leading-6 text-blue-950">
                      <p className="font-semibold">
                        Invited Louisiana businesses • Calibration beta only.
                      </p>
                      <p>
                        By selecting a wallet and connecting, you reaffirm the{' '}
                        <TermsOfServiceLink
                          onOpen={onOpenTerms}
                          className="font-semibold underline underline-offset-2"
                        />
                        .
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <input
                        id="wallet-terms-acknowledgment"
                        type="checkbox"
                        checked={hasAcknowledgedTermsForConnection}
                        onChange={(event) =>
                          setHasAcknowledgedTermsForConnection(event.target.checked)
                        }
                        aria-label={`I confirm I am an invited Louisiana business user participating only in the fee-free Calibration beta and agree to the Terms of Service effective ${TERMS_LAST_UPDATED}`}
                        data-testid="wallet-terms-acknowledgment"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                      />
                      <p className="text-sm leading-6 text-blue-950">
                        <label htmlFor="wallet-terms-acknowledgment">
                          I confirm that I am an invited Louisiana business user participating only
                          in the fee-free Calibration beta, and I have read and agree to the{' '}
                        </label>
                        <TermsOfServiceLink
                          onOpen={onOpenTerms}
                          className="font-semibold underline underline-offset-2"
                        />
                        , effective {TERMS_LAST_UPDATED}.
                      </p>
                    </div>
                  )}
                  <p className="mt-2 text-xs leading-5 text-blue-800">
                    Connecting shares public wallet and network information. It does not authorize a
                    FIL transfer; a separate wallet approval is required.
                  </p>
                </div>

                <div className="mt-5 space-y-2">
                  {hasNativeWalletProviders &&
                    nativeFilecoin?.providers.map((provider) => {
                      const isConnecting = connectingNativeProviderId === provider.metadata.id;
                      const isPreparing = Boolean(
                        provider.prepareConnect &&
                        !preparedNativeProviderIds.has(provider.metadata.id),
                      );
                      const logo = nativeWalletLogos[provider.metadata.id];

                      return (
                        <WalletOptionButton
                          key={provider.metadata.id}
                          description={nativeWalletDescriptions[provider.metadata.id]}
                          label={provider.metadata.name}
                          logo={
                            logo ?? {
                              alt: provider.metadata.name,
                              className: 'h-8 w-8 rounded-lg object-contain',
                            }
                          }
                          disabled={
                            disabled ||
                            isConnectingWallet ||
                            isPreparing ||
                            !canConnectUnderCurrentTerms
                          }
                          isConnecting={isConnecting}
                          onClick={() => handleNativeConnect(provider)}
                        />
                      );
                    })}

                  {hasEvmConnectors &&
                    evmConnectors.map((connector) => {
                      const walletKey = getEvmWalletKey(connector);

                      return (
                        <WalletOptionButton
                          key={walletKey}
                          label={getEvmWalletLabel(connector)}
                          logo={getEvmWalletLogo(connector, evmWalletIcons[walletKey])}
                          disabled={disabled || isConnectingWallet || !canConnectUnderCurrentTerms}
                          isConnecting={connectingEvmConnectorUid === connector.uid}
                          onClick={() => handleEvmConnect(connector)}
                        />
                      );
                    })}

                  {connectionError && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {connectionError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        };

        const renderDisconnectedState = () => (
          <button
            type="button"
            onClick={() => {
              setHasAcknowledgedTermsForConnection(false);
              setShowWalletChooser(true);
            }}
            disabled={disabled}
            className={`w-full rounded-full bg-[#1f69ff] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1857d4] disabled:cursor-not-allowed disabled:opacity-60 ${primaryActionShadow}`}
          >
            Connect Wallet
          </button>
        );

        const renderNativeConnectedState = () => {
          if (!nativeConnectedSender) {
            return null;
          }

          const displayAddress = truncateAddress(nativeConnectedSender.address, 5);

          return (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowNativeNetworkChooser(true)}
                disabled={disabled}
                className="w-full rounded-full border border-slate-900 bg-slate-900 px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{nativeConnectedSender.network.walletLabel}</span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/80">
                    Switch
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setShowAccountModal(true)}
                className={`w-full rounded-full bg-[#4a84ea] px-4 py-4 text-left text-white transition-colors hover:bg-[#3f77dd] ${primaryActionShadow}`}
                title={nativeConnectedSender.address}
              >
                <div className="font-mono text-base font-semibold">{displayAddress}</div>
                <div className="mt-1 text-sm text-blue-100">
                  {nativeFilecoin?.balanceLabel ?? nativeConnectedSender.provider.name}
                </div>
              </button>
            </div>
          );
        };

        const renderEvmConnectedState = () => {
          if (!account || !chain) {
            return null;
          }

          const displayAddress = truncateAddress(senderDisplayAddress ?? account.address, 5);
          const isWrongNetwork = chain.unsupported || !supportedNetwork;

          return (
            <div className="space-y-3">
              <button
                type="button"
                onClick={openChainModal}
                disabled={disabled}
                className={`w-full rounded-full border px-4 py-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isWrongNetwork
                    ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                    : 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{isWrongNetwork ? 'Unsupported Network' : networkLabel}</span>
                  {isWrongNetwork && (
                    <span className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-xs font-semibold text-red-700">
                      Switch
                    </span>
                  )}
                </div>
                {isWrongNetwork && (
                  <div className="mt-1 text-xs font-normal text-red-700">
                    Switch to {getSupportedNetworkListLabel()}.
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowAccountModal(true)}
                className={`w-full rounded-full bg-[#4a84ea] px-4 py-4 text-left text-white transition-colors hover:bg-[#3f77dd] ${primaryActionShadow}`}
                title={senderDisplayAddress}
              >
                <div className="font-mono text-base font-semibold">{displayAddress}</div>
                <div className="mt-1 text-sm text-blue-100">
                  {account.displayBalance || '0 FIL'}
                </div>
              </button>
            </div>
          );
        };

        return (
          <div
            className="w-full"
            {...(!ready && {
              'aria-hidden': true,
              style: {
                opacity: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })}
          >
            {nativeConnectedSender
              ? renderNativeConnectedState()
              : connected
                ? renderEvmConnectedState()
                : renderDisconnectedState()}

            {showWalletChooser && renderModalPortal(renderWalletChooser())}

            {showNativeNetworkChooser &&
              nativeConnectedSender &&
              renderModalPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4">
                  <div className="relative w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => setShowNativeNetworkChooser(false)}
                      className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                      aria-label="Close"
                    >
                      ×
                    </button>

                    <div className="pr-10">
                      <h3 className="text-lg font-semibold text-slate-950">Switch Network</h3>
                    </div>

                    <div className="mt-5 space-y-2">
                      {nativeNetworkOptions.map((network) => {
                        const isCurrent = network.key === nativeConnectedSender.networkKey;
                        const isSwitching = switchingNativeNetworkKey === network.key;

                        return (
                          <button
                            key={network.key}
                            type="button"
                            onClick={() => {
                              void handleNativeNetworkSwitch(network.key);
                            }}
                            disabled={disabled || Boolean(switchingNativeNetworkKey) || isCurrent}
                            className={`flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                              isCurrent
                                ? 'border-blue-200 bg-blue-50 text-blue-900'
                                : 'border-slate-200 bg-white text-slate-950 hover:border-blue-200 hover:bg-blue-50'
                            }`}
                          >
                            <span className="font-semibold">
                              {isSwitching ? `${network.walletLabel}...` : network.walletLabel}
                            </span>
                            {isCurrent ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                Current
                              </span>
                            ) : null}
                          </button>
                        );
                      })}

                      {connectionError && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {connectionError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>,
              )}

            {showAccountModal &&
              nativeConnectedSender &&
              renderModalPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4">
                  <div className="relative w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => setShowAccountModal(false)}
                      className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                      aria-label="Close"
                    >
                      ×
                    </button>

                    <div className="text-center">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#1f69ff] text-lg font-semibold text-white">
                        FIL
                      </div>

                      <h3 className="break-all font-mono text-base font-semibold text-slate-950">
                        {nativeConnectedSender.address}
                      </h3>
                      <p className="mt-2 text-sm text-slate-500">
                        {nativeConnectedSender.provider.name}
                      </p>
                      <p className="mt-2 text-sm text-slate-500">
                        {nativeConnectedSender.network.walletLabel}
                      </p>
                      <p className="mt-2 text-sm text-slate-500">
                        {nativeFilecoin?.balanceLabel ?? 'Balance unavailable'}
                      </p>

                      <div className="mt-6 flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            copyToClipboard(nativeConnectedSender.address);
                            setShowAccountModal(false);
                          }}
                          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                        >
                          Copy Address
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            void nativeFilecoin?.onDisconnect();
                            setShowNativeNetworkChooser(false);
                            setShowAccountModal(false);
                          }}
                          disabled={disabled}
                          className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                </div>,
              )}

            {showAccountModal &&
              !nativeConnectedSender &&
              account &&
              renderModalPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4">
                  <div className="relative w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => setShowAccountModal(false)}
                      className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                      aria-label="Close"
                    >
                      ×
                    </button>

                    <div className="text-center">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#1f69ff] text-2xl text-white">
                        ƒ
                      </div>

                      <h3 className="font-mono text-base font-semibold text-slate-950">
                        {senderDisplayAddress ?? account.address}
                      </h3>
                      <p className="mt-2 text-sm text-slate-500">{networkLabel}</p>
                      <p className="mt-2 text-sm text-slate-500">
                        {account.displayBalance || '0 FIL'}
                      </p>

                      <div className="mt-6 flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            copyToClipboard(senderDisplayAddress ?? account.address);
                            setShowAccountModal(false);
                          }}
                          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                        >
                          Copy Address
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (disabled) {
                              return;
                            }

                            disconnect();
                            setShowAccountModal(false);
                          }}
                          disabled={disabled}
                          className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                </div>,
              )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
};
