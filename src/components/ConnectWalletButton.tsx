import React, { useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import AddressChip from './AddressChip';

const WALLET_ORDER = ['MetaMask', 'WalletConnect', 'Ledger'];

const ConnectWalletButton: React.FC = () => {
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const [modalOpen, setModalOpen] = useState(false);

  if (isConnected) {
    return <AddressChip />;
  }

  // Order connectors as specified and filter out duplicates/nulls
  const orderedConnectors = WALLET_ORDER
    .map((name) => connectors.find((c) => c.name === name))
    .filter((c, i, arr) => c && arr.indexOf(c) === i);

  return (
    <>
      <button
        className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-md py-2 mb-4"
        type="button"
        onClick={() => setModalOpen(true)}
      >
        Connect Wallet
      </button>
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-md shadow-md min-w-[300px] relative">
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 text-xl font-bold"
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-xl font-semibold mb-4">Connect a Wallet</h2>
            <ul>
              {orderedConnectors.map((connector) => (
                connector ? (
                  <li key={connector.id} className="mb-2">
                    <button
                      className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md p-2"
                      onClick={() => {
                        connect({ connector });
                        setModalOpen(false);
                      }}
                      disabled={!connector.ready}
                    >
                      {connector.name}
                    </button>
                  </li>
                ) : null
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

export default ConnectWalletButton;
