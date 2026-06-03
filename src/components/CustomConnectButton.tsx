import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useConnect, useDisconnect, type Connector } from 'wagmi';
import {
  getDefaultNetworkKey,
  getSupportedNetworkByChainId,
  getSupportedNetworkListLabel,
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
  nativeFilecoin?: NativeWalletConnectionProps;
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
          <span className="mt-1 block text-sm text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
      {logo.src ? (
        <img
          src={logo.src}
          alt={logo.alt}
          className={`shrink-0 ${logo.className}`}
        />
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

function normalizeWalletName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getRainbowKitConnectorDetails(connector: Connector): RainbowKitConnectorDetails | undefined {
  return (connector as RainbowKitConnector).rkDetails;
}

function getEvmWalletKey(connector: Connector): string {
  return getRainbowKitConnectorDetails(connector)?.id ?? connector.id ?? connector.uid;
}

function getEvmWalletLabel(connector: Connector): string {
  return getRainbowKitConnectorDetails(connector)?.name ?? connector.name;
}

function getEvmWalletSortIndex(connector: Connector): number {
  const normalizedName = normalizeWalletName(`${getEvmWalletKey(connector)} ${getEvmWalletLabel(connector)}`);

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
  nativeFilecoin,
}) => {
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showWalletChooser, setShowWalletChooser] = useState(false);
  const [connectingNativeProviderId, setConnectingNativeProviderId] = useState<string | null>(
    null,
  );
  const [connectingEvmConnectorUid, setConnectingEvmConnectorUid] = useState<string | null>(
    null,
  );
  const [evmWalletConnectionError, setEvmWalletConnectionError] = useState<string | undefined>();
  const [evmWalletIcons, setEvmWalletIcons] = useState<Record<string, string>>({});
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

          setEvmWalletIcons((current) => (
            current[walletKey] ? current : { ...current, [walletKey]: src }
          ));
        })
        .catch(() => {
          // Logo loading is cosmetic; keep the text row usable if RainbowKit changes an asset.
        });
    });

    return () => {
      cancelled = true;
    };
  }, [connectors, evmWalletIcons]);

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
      {({
        account,
        chain,
        openChainModal,
        authenticationStatus,
        mounted,
      }) => {
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
        const isConnectingWallet = Boolean(
          connectingNativeProviderId || connectingEvmConnectorUid,
        );
        const connectionError =
          nativeFilecoin?.connectionError ?? evmWalletConnectionError;

        const handleNativeConnect = async (provider: NativeFilecoinWalletProvider) => {
          if (!nativeFilecoin) {
            return;
          }

          setEvmWalletConnectionError(undefined);
          setConnectingNativeProviderId(provider.metadata.id);

          try {
            await nativeFilecoin.onConnect(provider, getDefaultNetworkKey());
            setShowWalletChooser(false);
          } finally {
            setConnectingNativeProviderId(null);
          }
        };

        const handleEvmConnect = async (connector: Connector) => {
          const walletLabel = getEvmWalletLabel(connector);

          setEvmWalletConnectionError(undefined);
          nativeFilecoin?.onClearConnectionError?.();
          setConnectingEvmConnectorUid(connector.uid);

          try {
            await connectAsync({ connector });
            setShowWalletChooser(false);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : `Failed to connect ${walletLabel}.`;

            setEvmWalletConnectionError(message);
          } finally {
            setConnectingEvmConnectorUid(null);
          }
        };

        const renderWalletChooser = () => {
          return (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6 sm:items-center">
              <div className="relative max-h-[calc(100vh-3rem)] w-full max-w-md overflow-y-auto rounded-[24px] bg-white p-6 shadow-2xl">
                <button
                  type="button"
                  onClick={() => setShowWalletChooser(false)}
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                  aria-label="Close"
                >
                  ×
                </button>

                <div className="pr-10">
                  <h3 className="text-lg font-semibold text-slate-950">Connect a Wallet</h3>
                </div>

                <div className="mt-5 space-y-2">
                  {hasNativeWalletProviders &&
                    nativeFilecoin?.providers.map((provider) => {
                      const isConnecting = connectingNativeProviderId === provider.metadata.id;
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
                          disabled={isConnectingWallet}
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
                          disabled={isConnectingWallet}
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
            onClick={() => setShowWalletChooser(true)}
            className={`w-full rounded-full bg-[#1f69ff] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1857d4] ${primaryActionShadow}`}
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
              <div className="w-full rounded-full border border-slate-900 bg-slate-900 px-4 py-3 text-left text-sm font-semibold text-white">
                {nativeConnectedSender.network.walletLabel}
              </div>

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
                className={`w-full rounded-full border px-4 py-3 text-left text-sm font-semibold transition-colors ${
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
                <div className="mt-1 text-sm text-blue-100">{account.displayBalance || '0 FIL'}</div>
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

            {showAccountModal && nativeConnectedSender && renderModalPortal(
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
                          setShowAccountModal(false);
                        }}
                        className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
            )}

            {showAccountModal && !nativeConnectedSender && account && renderModalPortal(
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
                          disconnect();
                          setShowAccountModal(false);
                        }}
                        className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
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
