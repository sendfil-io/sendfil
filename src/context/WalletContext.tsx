import { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '../lib/wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';

interface WalletContextProps {
  children: ReactNode;
}

export function WalletContext({ children }: WalletContextProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider>
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
