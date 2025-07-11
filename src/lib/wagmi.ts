import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { filecoin } from 'viem/chains';

const chains = [filecoin];
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID!;

export const wagmiConfig = createConfig({
  chains,
  connectors: connectorsForWallets(
    [
      {
        groupName: 'Recommended',
        wallets: [
          metaMaskWallet,         // pass the function, not metaMaskWallet({ ... })
          walletConnectWallet,
        ],
      },
    ],
    { appName: 'SendFIL', projectId }
  ),
  transports: { [filecoin.id]: http(import.meta.env.VITE_RPC_URL) },
  ssr: false,
});
