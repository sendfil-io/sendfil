import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';
import {
  getDefaultNetworkKey,
  getNetworkConfig,
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
}

export interface CustomConnectButtonProps {
  nativeFilecoin?: NativeWalletConnectionProps;
}

const nativeWalletDescriptions: Record<string, string> = {
  'filsnap-filecoin': 'MetaMask Snap for f1/t1 Filecoin accounts',
  'ledger-filecoin': 'Ledger Filecoin app over WebUSB',
};

function getNativeWalletDescription(provider: NativeFilecoinWalletProvider): string {
  return nativeWalletDescriptions[provider.metadata.id] ?? 'Native Filecoin wallet';
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
  const [nativeNetworkKey, setNativeNetworkKey] = useState<SendFilNetworkKey>(
    getDefaultNetworkKey(),
  );
  const [connectingNativeProviderId, setConnectingNativeProviderId] = useState<string | null>(
    null,
  );
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
        openConnectModal,
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

        const handleNativeConnect = async (provider: NativeFilecoinWalletProvider) => {
          if (!nativeFilecoin) {
            return;
          }

          setConnectingNativeProviderId(provider.metadata.id);

          try {
            await nativeFilecoin.onConnect(provider, nativeNetworkKey);
            setShowWalletChooser(false);
          } finally {
            setConnectingNativeProviderId(null);
          }
        };

        const renderWalletChooser = () => {
          const selectedNetwork = getNetworkConfig(nativeNetworkKey);

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

                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Filecoin native
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {(['mainnet', 'calibration'] as const).map((networkKey) => {
                      const network = getNetworkConfig(networkKey);
                      const isSelected = nativeNetworkKey === networkKey;

                      return (
                        <button
                          key={networkKey}
                          type="button"
                          onClick={() => setNativeNetworkKey(networkKey)}
                          className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
                          }`}
                        >
                          {network.walletLabel}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    {hasNativeWalletProviders &&
                      nativeFilecoin?.providers.map((provider) => {
                        const isConnecting =
                          connectingNativeProviderId === provider.metadata.id;

                        return (
                          <button
                            key={provider.metadata.id}
                            type="button"
                            onClick={() => handleNativeConnect(provider)}
                            disabled={Boolean(connectingNativeProviderId)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 text-left text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-semibold">
                                {provider.metadata.name}
                              </span>
                              <span className="rounded-full bg-white/12 px-2 py-0.5 text-xs font-semibold text-slate-200">
                                {isConnecting ? 'Connecting' : selectedNetwork.nativePrefix + '1'}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-300">
                              {getNativeWalletDescription(provider)}
                            </div>
                          </button>
                        );
                      })}
                  </div>

                  {nativeFilecoin?.connectionError && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {nativeFilecoin.connectionError}
                    </div>
                  )}
                </div>

                <div className="mt-5 border-t border-slate-200 pt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    FEVM wallets
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowWalletChooser(false);
                      openConnectModal();
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50"
                  >
                    <div className="font-semibold text-slate-950">EVM wallets</div>
                    <div className="mt-1 text-xs text-slate-500">
                      MetaMask, Brave Wallet, WalletConnect, and other 0x senders
                    </div>
                  </button>
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
