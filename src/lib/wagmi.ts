import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import {
  SUPPORTED_WAGMI_CHAINS,
  getNetworkConfig,
} from './networks';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID!;

const mainnetConfig = getNetworkConfig('mainnet');
const calibrationConfig = getNetworkConfig('calibration');
const transports: Record<(typeof SUPPORTED_WAGMI_CHAINS)[number]['id'], ReturnType<typeof http>> = {
  314: http(mainnetConfig.fevmRpcUrl),
  314159: http(calibrationConfig.fevmRpcUrl),
};

export const wagmiConfig = createConfig({
  chains: SUPPORTED_WAGMI_CHAINS,
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
  transports,
  ssr: false,
});
