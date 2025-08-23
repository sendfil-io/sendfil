import type {
  FilecoinMessage,
  SignedMessage,
  BatchTransactionResult,
  TransactionStatus,
} from '../DataProvider/types';
import { submitTransaction, getNonce, getBalance, pollTransactionStatus } from '../DataProvider';
import { buildBatchTransaction, validateSufficientBalance, attoFilToFil } from './messageBuilder';
import { calculateFeeRows } from '../../utils/fee';

export interface BatchExecutionRequest {
  recipients: Array<{ address: string; amount: number }>; // includes fees
  senderAddress: string;
}

export interface BatchExecutionResult {
  success: boolean;
  transactionCids: string[];
  errors: string[];
  batchResult?: BatchTransactionResult;
}

export interface TransactionProgress {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  transactions: Array<{
    cid: string;
    to: string;
    amount: number;
    status: TransactionStatus;
  }>;
}

/**
 * Convert Filecoin message to signing format for wagmi
 */
function messageToSigningData(message: FilecoinMessage): string {
  // This is a simplified version - in practice you'd need proper CBOR encoding
  // For now, we'll create a JSON representation that can be signed
  const signingData = {
    Version: message.Version,
    To: message.To,
    From: message.From,
    Nonce: message.Nonce,
    Value: message.Value,
    Method: message.Method,
    Params: message.Params || '',
    GasLimit: message.GasLimit,
    GasFeeCap: message.GasFeeCap,
    GasPremium: message.GasPremium,
  };
  
  return JSON.stringify(signingData);
}

/**
 * Execute a batch transaction (dry run first for testing)
 */
export async function executeBatchTransaction(
  request: BatchExecutionRequest,
  options: {
    dryRun?: boolean;
    signMessage?: (message: string) => Promise<string>;
  } = {}
): Promise<BatchExecutionResult> {
  const { recipients, senderAddress } = request;
  const { dryRun = false, signMessage } = options;

  try {
    // 1. Get current nonce and balance
    const [currentNonce, senderBalance] = await Promise.all([
      getNonce(senderAddress),
      getBalance(senderAddress),
    ]);

    console.log(`Current nonce: ${currentNonce}, Balance: ${attoFilToFil(senderBalance)} FIL`);

    // 2. Build batch transaction
    const batchResult = await buildBatchTransaction({
      recipients,
      senderAddress,
      startingNonce: currentNonce,
    });

    console.log('Batch transaction built:', {
      messageCount: batchResult.messages.length,
      totalValue: attoFilToFil(batchResult.totalValue),
      gasEstimate: attoFilToFil(batchResult.feeEstimate),
    });

    // 3. Validate sufficient balance
    const balanceCheck = validateSufficientBalance(senderBalance, batchResult);
    
    if (!balanceCheck.isValid) {
      return {
        success: false,
        transactionCids: [],
        errors: [
          `Insufficient balance. Required: ${attoFilToFil(balanceCheck.required)} FIL, ` +
          `Available: ${attoFilToFil(balanceCheck.available)} FIL, ` +
          `Shortfall: ${attoFilToFil(balanceCheck.shortfall!)} FIL`
        ],
        batchResult,
      };
    }

    // 4. If dry run, stop here
    if (dryRun) {
      console.log('Dry run completed successfully');
      return {
        success: true,
        transactionCids: batchResult.messages.map((_, i) => `dry-run-${i}`),
        errors: [],
        batchResult,
      };
    }

    // 5. Sign and submit transactions (requires actual wallet integration)
    if (!signMessage) {
      return {
        success: false,
        transactionCids: [],
        errors: ['No signing function provided - wallet not connected'],
        batchResult,
      };
    }

    const transactionCids: string[] = [];
    const errors: string[] = [];

    // Process each message
    for (let i = 0; i < batchResult.messages.length; i++) {
      const message = batchResult.messages[i];
      
      try {
        console.log(`Signing transaction ${i + 1}/${batchResult.messages.length} to ${message.To}`);
        
        // Sign the message
        const signingData = messageToSigningData(message);
        const signature = await signMessage(signingData);
        
        // Create signed message
        const signedMessage: SignedMessage = {
          Message: message,
          Signature: {
            Type: 1, // SECP256K1 signature type
            Data: signature,
          },
        };

        // Submit to mempool
        const result = await submitTransaction(signedMessage);
        const cid = result['/'];
        
        transactionCids.push(cid);
        console.log(`Transaction ${i + 1} submitted with CID: ${cid}`);
        
        // Small delay between submissions to avoid overwhelming the network
        if (i < batchResult.messages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        const errorMsg = `Transaction ${i + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    return {
      success: errors.length === 0,
      transactionCids,
      errors,
      batchResult,
    };

  } catch (error) {
    console.error('Batch execution failed:', error);
    return {
      success: false,
      transactionCids: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * Monitor progress of a batch transaction
 */
export async function monitorBatchProgress(
  transactionCids: string[],
  recipients: Array<{ address: string; amount: number }>
): Promise<TransactionProgress> {
  const transactions = await Promise.all(
    transactionCids.map(async (cid, index) => ({
      cid,
      to: recipients[index]?.address || 'unknown',
      amount: recipients[index]?.amount || 0,
      status: await pollTransactionStatus(cid, 1, 1000), // Quick check, don't wait
    }))
  );

  const completed = transactions.filter(tx => tx.status.status === 'confirmed').length;
  const failed = transactions.filter(tx => tx.status.status === 'failed').length;
  const pending = transactions.length - completed - failed;

  return {
    total: transactions.length,
    completed,
    pending,
    failed,
    transactions,
  };
}

/**
 * Helper: Prepare recipients with fees for batch execution
 */
export function prepareRecipientsWithFees(
  recipients: Array<{ address: string; amount: number }>
): Array<{ address: string; amount: number }> {
  return calculateFeeRows(recipients);
} 