import { useAccount } from 'wagmi';
import { Wallet } from '../types/wallet';

export function useWallet(): Wallet {
  const { address, isConnected } = useAccount();
  return { address: address ?? '', isConnected };
}
