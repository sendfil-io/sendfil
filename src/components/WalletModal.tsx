import React from 'react';
import metamaskLogo from '../assets/metamask-logo.png';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-md shadow-md">
        <h2 className="text-xl font-semibold mb-4">Connect a Wallet</h2>
        <ul>
          <li className="mb-2">
            <button className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md p-2">
              <img src={metamaskLogo} alt="MetaMask" className="w-6 h-6" />
              MetaMask
            </button>
          </li>
          <li className="mb-2">
            <button className="w-full text-left p-2 hover:bg-gray-100">WalletConnect</button>
          </li>
          <li>
            <button className="w-full text-left p-2 hover:bg-gray-100">Ledger</button>
          </li>
        </ul>
        <button onClick={onClose} className="mt-4 text-blue-500">Close</button>
      </div>
    </div>
  );
};

export default WalletModal; 