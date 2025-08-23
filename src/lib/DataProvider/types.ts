import { z } from 'zod';

export const JsonRpcSuccess = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown(),
});

export const JsonRpcError = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

export type RpcSuccess<T> = {
  jsonrpc: '2.0';
  id: string | number;
  result: T;
};

// Filecoin Transaction Types
export interface FilecoinMessage {
  Version: number;
  To: string;
  From: string;
  Nonce: number;
  Value: string;
  GasLimit: number;
  GasFeeCap: string;
  GasPremium: string;
  Method: number;
  Params?: string;
}

export interface SignedMessage {
  Message: FilecoinMessage;
  Signature: {
    Type: number;
    Data: string;
  };
}

export interface MessageReceipt {
  ExitCode: number;
  Return: string;
  GasUsed: number;
  EventsRoot?: string;
}

export interface TipSet {
  Cids: Array<{ '/': string }>;
  Blocks: Array<{
    Miner: string;
    Ticket: any;
    ElectionProof: any;
    BeaconEntries: any[];
    WinPostedProof: any[];
    Parents: Array<{ '/': string }>;
    ParentWeight: string;
    Height: number;
    ParentStateRoot: { '/': string };
    ParentMessageReceipts: { '/': string };
    Messages: { '/': string };
    BLSAggregate: any;
    Timestamp: number;
    BlockSig: any;
    ForkSignaling: number;
    ParentBaseFee: string;
  }>;
  Height: number;
}

export interface MpoolMessage {
  Message: FilecoinMessage;
  Signature: {
    Type: number;
    Data: string;
  };
  CID: { '/': string };
}

export interface GasEstimate {
  GasLimit: number;
  GasFeeCap: string;
  GasPremium: string;
}

export interface TransactionStatus {
  cid: string;
  status: 'pending' | 'confirmed' | 'failed';
  receipt?: MessageReceipt;
  tipset?: TipSet;
  error?: string;
}

// Batch transaction types
export interface BatchRecipient {
  address: string;
  amount: number; // in FIL
}

export interface BatchTransactionRequest {
  recipients: BatchRecipient[];
  senderAddress: string;
  startingNonce?: number;
}

export interface BatchTransactionResult {
  messages: FilecoinMessage[];
  estimatedGas: GasEstimate;
  totalValue: string; // in attoFIL
  feeEstimate: string; // in attoFIL
} 