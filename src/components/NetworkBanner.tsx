import React from 'react';
import { useChainId, useAccount } from 'wagmi';

const FILECOIN_MAINNET_ID = 314;

const NetworkBanner: React.FC = () => {
  const chainId = useChainId();
  const { isConnected } = useAccount();

  if (!isConnected || !chainId) return null;
  if (chainId === FILECOIN_MAINNET_ID) return null;

  return (
    <div className="w-full bg-red-100 text-red-800 px-4 py-2 text-center font-semibold">
      Unsupported network: {chainId}. Please switch to Filecoin Mainnet.
    </div>
  );
};

export default NetworkBanner;
