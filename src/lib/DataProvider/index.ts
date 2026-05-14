import { callRpc } from './rpc';
import type {
  FilecoinMessage,
  SignedMessage,
  MessageReceipt,
  TipSet,
  TransactionStatus,
} from './types';
import type { SendFilNetworkKey } from '../networks';

/** Filecoin.WalletBalance */
export const getBalance = (address: string, networkKey?: SendFilNetworkKey) =>
  callRpc<string>('Filecoin.WalletBalance', [address], networkKey);

/** Filecoin.MpoolGetNonce */
export const getNonce = (address: string, networkKey?: SendFilNetworkKey) =>
  callRpc<number>('Filecoin.MpoolGetNonce', [address], networkKey);

/** Filecoin.ChainHead – useful for health checks */
export const getChainHead = (networkKey?: SendFilNetworkKey) =>
  callRpc<{ Height: number; Cids: { '/': string }[] }>('Filecoin.ChainHead', [], networkKey);

/** Filecoin.GasEstimateMessageGas - Estimate gas for a message */
export const estimateGas = (
  message: FilecoinMessage,
  spec?: unknown,
  networkKey?: SendFilNetworkKey,
) =>
  callRpc<FilecoinMessage>('Filecoin.GasEstimateMessageGas', [message, spec, []], networkKey);

/** Filecoin.MpoolPush - Submit signed message to mempool */
export const submitTransaction = (
  signedMessage: SignedMessage,
  networkKey?: SendFilNetworkKey,
) =>
  callRpc<{ '/': string }>('Filecoin.MpoolPush', [signedMessage], networkKey);

/** Filecoin.StateSearchMsg - Search for message by CID */
export const searchMessage = (cid: { '/': string }, networkKey?: SendFilNetworkKey) =>
  callRpc<{
    Message: { '/': string };
    Receipt: MessageReceipt;
    ReturnDec: unknown;
    TipSet: { '/': string };
    Height: number;
  } | null>('Filecoin.StateSearchMsg', [null, cid, -1, true], networkKey);

/** Filecoin.StateGetReceipt - Get receipt for message CID */
export const getTransactionReceipt = (
  cid: { '/': string },
  networkKey?: SendFilNetworkKey,
) =>
  callRpc<MessageReceipt>('Filecoin.StateGetReceipt', [cid, null], networkKey);

/** Filecoin.ChainGetTipSet - Get tipset by key */
export const getTipSet = (
  tipsetKey: Array<{ '/': string }>,
  networkKey?: SendFilNetworkKey,
) =>
  callRpc<TipSet>('Filecoin.ChainGetTipSet', [tipsetKey], networkKey);

/** Filecoin.MpoolPending - Get pending messages from mempool */
export const getPendingMessages = (
  address?: string,
  networkKey?: SendFilNetworkKey,
) =>
  callRpc<FilecoinMessage[]>('Filecoin.MpoolPending', [address ? [address] : []], networkKey);

/** Helper: Check transaction status by CID */
export const getTransactionStatus = async (
  cidString: string,
  networkKey?: SendFilNetworkKey,
): Promise<TransactionStatus> => {
  try {
    const cid = { '/': cidString };
    
    // First try to find the message
    const searchResult = await searchMessage(cid, networkKey);
    
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
  intervalMs: number = 5000,
  networkKey?: SendFilNetworkKey,
): Promise<TransactionStatus> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getTransactionStatus(cidString, networkKey);
    
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
