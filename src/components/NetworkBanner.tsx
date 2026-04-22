import React from 'react';
import { useChainId, useAccount } from 'wagmi';
import {
  getSupportedNetworkByChainId,
  getSupportedNetworkListLabel,
} from '../lib/networks';

const NetworkBanner: React.FC = () => {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const network = getSupportedNetworkByChainId(chainId);

  if (!isConnected || !chainId) return null;
  if (!network) {
    return (
      <div className="mb-6 w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-800">
        Unsupported network. Switch to {getSupportedNetworkListLabel()} to review and send this
        batch.
      </div>
    );
  }

  if (!network.isTestnet) return null;

  return (
    <div className="mb-6 w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm font-medium text-blue-900">
      Connected to Calibration Testnet. Review and send will use test FIL on chain {network.chainId}.
    </div>
  );
};

export default NetworkBanner;
