import React, { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';
import {
  getSupportedNetworkByChainId,
  getSupportedNetworkListLabel,
} from '../lib/networks';
import {
  convertEthToDelegatedAddress,
  truncateAddress,
} from '../utils/addressConverter';

const E2E_MOCK_WALLET_ENABLED = import.meta.env.VITE_E2E_MOCK_WALLET === 'true';

export const CustomConnectButton: React.FC = () => {
  const [showAccountModal, setShowAccountModal] = useState(false);
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
          className="rounded-[22px] bg-[#4a84ea] px-4 py-4 text-left font-mono text-sm text-white shadow-[0_22px_35px_-28px_rgba(74,132,234,0.95)]"
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
        const delegatedAddress =
          account && supportedNetwork
            ? convertEthToDelegatedAddress(account.address, supportedNetwork.chainId)
            : account?.address;
        const networkLabel = supportedNetwork?.walletLabel ?? chain?.name;

        const renderDisconnectedState = () => (
          <button
            type="button"
            onClick={openConnectModal}
            className="w-full rounded-2xl bg-[#1f69ff] px-4 py-3 text-sm font-medium text-white shadow-[0_22px_35px_-28px_rgba(31,105,255,0.95)] transition-colors hover:bg-[#1857d4]"
          >
            Connect Wallet
          </button>
        );

        const renderConnectedState = () => {
          if (!account || !chain) {
            return null;
          }

          const displayAddress = truncateAddress(delegatedAddress ?? account.address, 5);
          const isWrongNetwork = chain.unsupported || !supportedNetwork;

          return (
            <div className="space-y-3">
              <button
                type="button"
                onClick={openChainModal}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
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
                className="w-full rounded-[22px] bg-[#4a84ea] px-4 py-4 text-left text-white shadow-[0_22px_35px_-28px_rgba(74,132,234,0.95)] transition-colors hover:bg-[#3f77dd]"
                title={delegatedAddress}
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
            {connected ? renderConnectedState() : renderDisconnectedState()}

            {showAccountModal && account && (
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
                      {delegatedAddress ?? account.address}
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">{networkLabel}</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {account.displayBalance || '0 FIL'}
                    </p>

                    <div className="mt-6 flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          copyToClipboard(delegatedAddress ?? account.address);
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
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
};
