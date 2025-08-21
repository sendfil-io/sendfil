import React, { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';
import { convertEthToF4, truncateAddress } from '../utils/addressConverter';

export const CustomConnectButton: React.FC = () => {
  const [showAccountModal, setShowAccountModal] = useState(false);
  const { disconnect } = useDisconnect();

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
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

        return (
          <div
            {...(!ready && {
              'aria-hidden': true,
              style: {
                opacity: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <button
                    onClick={openConnectModal}
                    className="bg-blue-500 hover:bg-blue-600 text-white rounded-md px-4 py-2"
                  >
                    Connect Wallet
                  </button>
                );
              }

              if (chain.unsupported) {
                return (
                  <button
                    onClick={openChainModal}
                    className="bg-red-500 hover:bg-red-600 text-white rounded-md px-4 py-2"
                  >
                    Wrong network
                  </button>
                );
              }

              const f4Address = convertEthToF4(account.address);
              const displayAddress = truncateAddress(f4Address);

              return (
                <div className="w-full">
                  {/* Chain Status */}
                  <button
                    onClick={openChainModal}
                    className="w-full flex items-center justify-center bg-gray-800 hover:bg-gray-900 text-white rounded-md px-3 py-2 mb-3 text-sm font-medium"
                  >
                    {chain.hasIcon && (
                      <div
                        className="w-4 h-4 rounded-full overflow-hidden mr-2"
                        style={{ background: chain.iconBackground }}
                      >
                        {chain.iconUrl && (
                          <img
                            alt={chain.name ?? 'Chain icon'}
                            src={chain.iconUrl}
                            className="w-4 h-4"
                          />
                        )}
                      </div>
                    )}
                    {chain.name}
                  </button>

                  {/* Wallet Address */}
                  <button
                    onClick={() => setShowAccountModal(true)}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-md px-4 py-3 font-mono text-sm"
                    title={f4Address}
                  >
                    <div className="flex flex-col items-center">
                      <span className="font-semibold">{displayAddress}</span>
                      {account.displayBalance && (
                        <span className="text-blue-100 text-xs mt-1">{account.displayBalance}</span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })()}

            {/* Custom Account Modal */}
            {showAccountModal && account && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white p-6 rounded-lg shadow-lg min-w-[320px] relative">
                  <button
                    onClick={() => setShowAccountModal(false)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 text-xl font-bold"
                    aria-label="Close"
                  >
                    ×
                  </button>

                  <div className="text-center">
                    <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-white text-2xl">♥</span>
                    </div>

                    <h3 className="font-mono text-lg font-bold text-gray-900 mb-2">
                      {convertEthToF4(account.address)}
                    </h3>

                    <p className="text-sm text-gray-600 mb-6">
                      {account.displayBalance || '0.009 FIL'}
                    </p>

                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => {
                          copyToClipboard(convertEthToF4(account.address));
                          setShowAccountModal(false);
                        }}
                        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium"
                      >
                        <span>📋</span>
                        Copy Address
                      </button>

                      <button
                        onClick={() => {
                          disconnect();
                          setShowAccountModal(false);
                        }}
                        className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium"
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
