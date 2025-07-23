import { callRpc } from './rpc';

/** Filecoin.WalletBalance */
export const getBalance = (address: string) =>
  callRpc<string>('Filecoin.WalletBalance', [address]);

/** Filecoin.MpoolGetNonce */
export const getNonce = (address: string) =>
  callRpc<number>('Filecoin.MpoolGetNonce', [address]);

/** Filecoin.ChainHead – useful for health checks */
export const getChainHead = () =>
  callRpc<{ Height: number; Cids: { '/': string }[] }>('Filecoin.ChainHead'); 