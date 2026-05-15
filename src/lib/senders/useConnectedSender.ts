import * as React from 'react';
import { useAccount, useChainId } from 'wagmi';
import { getNativeFilecoinWalletProviders } from './nativeFilecoinProvider';
import {
  resolveConnectedSenderState,
  type ConnectedSenderState,
  type E2eMockWalletSnapshot,
} from './connectedSender';
import type {
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
} from './types';

export interface UseConnectedSenderOptions {
  e2eMockWallet?: E2eMockWalletSnapshot;
  nativeFilecoinSender?: NativeFilecoinConnectedSender;
  nativeFilecoinProviders?: NativeFilecoinWalletProvider[];
  balanceQueriesEnabled?: boolean;
}

export function useConnectedSender({
  e2eMockWallet,
  nativeFilecoinSender,
  nativeFilecoinProviders: configuredNativeFilecoinProviders,
  balanceQueriesEnabled = true,
}: UseConnectedSenderOptions = {}): ConnectedSenderState {
  const account = useAccount();
  const chainId = useChainId();
  const nativeFilecoinProviders = React.useMemo(
    () =>
      configuredNativeFilecoinProviders ??
      getNativeFilecoinWalletProviders(),
    [configuredNativeFilecoinProviders],
  );

  return React.useMemo(
    () =>
      resolveConnectedSenderState({
        evmWallet: {
          address: account.address,
          chainId,
          isConnected: account.isConnected,
        },
        e2eMockWallet,
        nativeFilecoinSender,
        nativeFilecoinProviders,
        balanceQueriesEnabled,
      }),
    [
      account.address,
      account.isConnected,
      balanceQueriesEnabled,
      chainId,
      e2eMockWallet,
      nativeFilecoinProviders,
      nativeFilecoinSender,
    ],
  );
}
