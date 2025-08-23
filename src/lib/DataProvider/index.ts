import { callRpc } from './rpc';
import type {
  FilecoinMessage,
  SignedMessage,
  MessageReceipt,
  TipSet,
  GasEstimate,
  TransactionStatus,
} from './types';

/** Filecoin.WalletBalance */
export const getBalance = (address: string) =>
  callRpc<string>('Filecoin.WalletBalance', [address]);

/** Filecoin.MpoolGetNonce */
export const getNonce = (address: string) =>
  callRpc<number>('Filecoin.MpoolGetNonce', [address]);

/** Filecoin.ChainHead – useful for health checks */
export const getChainHead = () =>
  callRpc<{ Height: number; Cids: { '/': string }[] }>('Filecoin.ChainHead');

/** Filecoin.GasEstimateMessageGas - Estimate gas for a message */
export const estimateGas = (message: FilecoinMessage, spec?: any) =>
  callRpc<FilecoinMessage>('Filecoin.GasEstimateMessageGas', [message, spec, []]);

/** Filecoin.MpoolPush - Submit signed message to mempool */
export const submitTransaction = (signedMessage: SignedMessage) =>
  callRpc<{ '/': string }>('Filecoin.MpoolPush', [signedMessage]);

/** Filecoin.StateSearchMsg - Search for message by CID */
export const searchMessage = (cid: { '/': string }) =>
  callRpc<{
    Message: { '/': string };
    Receipt: MessageReceipt;
    ReturnDec: any;
    TipSet: { '/': string };
    Height: number;
  } | null>('Filecoin.StateSearchMsg', [null, cid, -1, true]);

/** Filecoin.StateGetReceipt - Get receipt for message CID */
export const getTransactionReceipt = (cid: { '/': string }) =>
  callRpc<MessageReceipt>('Filecoin.StateGetReceipt', [cid, null]);

/** Filecoin.ChainGetTipSet - Get tipset by key */
export const getTipSet = (tipsetKey: Array<{ '/': string }>) =>
  callRpc<TipSet>('Filecoin.ChainGetTipSet', [tipsetKey]);

/** Filecoin.MpoolPending - Get pending messages from mempool */
export const getPendingMessages = (address?: string) =>
  callRpc<FilecoinMessage[]>('Filecoin.MpoolPending', [address ? [address] : []]);

/** Helper: Check transaction status by CID */
export const getTransactionStatus = async (cidString: string): Promise<TransactionStatus> => {
  try {
    const cid = { '/': cidString };
    
    // First try to find the message
    const searchResult = await searchMessage(cid);
    
    if (searchResult) {
      // Message found and executed
      return {
        cid: cidString,
        status: searchResult.Receipt.ExitCode === 0 ? 'confirmed' : 'failed',
        receipt: searchResult.Receipt,
        error: searchResult.Receipt.ExitCode !== 0 ? `Exit code: ${searchResult.Receipt.ExitCode}` : undefined,
      };
    }
    
    // Message not found in chain, might be pending
    return {
      cid: cidString,
      status: 'pending',
    };
  } catch (error) {
    return {
      cid: cidString,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/** Helper: Poll transaction status until completion */
export const pollTransactionStatus = async (
  cidString: string,
  maxAttempts: number = 60,
  intervalMs: number = 5000
): Promise<TransactionStatus> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getTransactionStatus(cidString);
    
    if (status.status !== 'pending') {
      return status;
    }
    
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  return {
    cid: cidString,
    status: 'failed',
    error: 'Transaction timeout - still pending after maximum wait time',
  };
}; 