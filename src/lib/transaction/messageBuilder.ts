import type {
  FilecoinMessage,
  BatchRecipient,
  BatchTransactionRequest,
  BatchTransactionResult,
  GasEstimate,
} from '../DataProvider/types';
import { estimateGas } from '../DataProvider';

/**
 * Convert FIL amount to attoFIL (smallest Filecoin unit)
 * 1 FIL = 10^18 attoFIL
 */
export function filToAttoFil(fil: number): string {
  const attoFil = BigInt(Math.floor(fil * 1e18));
  return attoFil.toString();
}

/**
 * Convert attoFIL to FIL for display
 */
export function attoFilToFil(attoFil: string): number {
  return Number(BigInt(attoFil)) / 1e18;
}

/**
 * Build a single Filecoin message for a recipient
 */
export function buildFilecoinMessage(params: {
  to: string;
  from: string;
  value: number; // in FIL
  nonce: number;
  gasLimit?: number;
  gasFeeCap?: string;
  gasPremium?: string;
}): FilecoinMessage {
  return {
    Version: 0,
    To: params.to,
    From: params.from,
    Nonce: params.nonce,
    Value: filToAttoFil(params.value),
    Method: 0, // Simple transfer
    Params: '',
    GasLimit: params.gasLimit || 1000000, // Default gas limit
    GasFeeCap: params.gasFeeCap || '1000000000', // 1 nanoFIL base fee
    GasPremium: params.gasPremium || '100000000', // 0.1 nanoFIL priority fee
  };
}

/**
 * Build batch of Filecoin messages for multiple recipients
 */
export function buildBatchMessages(request: BatchTransactionRequest): FilecoinMessage[] {
  const { recipients, senderAddress, startingNonce = 0 } = request;

  return recipients.map((recipient, index) =>
    buildFilecoinMessage({
      to: recipient.address,
      from: senderAddress,
      value: recipient.amount,
      nonce: startingNonce + index,
    })
  );
}

/**
 * Estimate gas for a batch of transactions
 */
export async function estimateBatchGas(
  messages: FilecoinMessage[]
): Promise<GasEstimate> {
  if (messages.length === 0) {
    return {
      GasLimit: 0,
      GasFeeCap: '0',
      GasPremium: '0',
    };
  }

  try {
    // Estimate gas for the first message as a sample
    // In practice, simple transfers have fairly consistent gas costs
    const sampleMessage = messages[0];
    const estimated = await estimateGas(sampleMessage);

    // Apply the estimated values to all messages and calculate totals
    const totalGasLimit = estimated.GasLimit * messages.length;
    
    // Use the estimated fee values
    const gasFeeCap = estimated.GasFeeCap;
    const gasPremium = estimated.GasPremium;

    return {
      GasLimit: totalGasLimit,
      GasFeeCap: gasFeeCap,
      GasPremium: gasPremium,
    };
  } catch (error) {
    console.warn('Gas estimation failed, using defaults:', error);
    
    // Fallback to conservative defaults
    return {
      GasLimit: 1500000 * messages.length, // Conservative estimate
      GasFeeCap: '2000000000', // 2 nanoFIL
      GasPremium: '100000000', // 0.1 nanoFIL
    };
  }
}

/**
 * Apply gas estimates to messages
 */
export function applyGasEstimates(
  messages: FilecoinMessage[],
  gasEstimate: GasEstimate
): FilecoinMessage[] {
  const gasPerMessage = Math.ceil(gasEstimate.GasLimit / messages.length);
  
  return messages.map(message => ({
    ...message,
    GasLimit: gasPerMessage,
    GasFeeCap: gasEstimate.GasFeeCap,
    GasPremium: gasEstimate.GasPremium,
  }));
}

/**
 * Calculate total transaction cost (value + gas fees)
 */
export function calculateTotalCost(
  messages: FilecoinMessage[],
  gasEstimate: GasEstimate
): {
  totalValue: string; // in attoFIL
  totalGasFees: string; // in attoFIL
  grandTotal: string; // in attoFIL
} {
  // Sum all message values
  const totalValue = messages.reduce((sum, msg) => {
    return sum + BigInt(msg.Value);
  }, BigInt(0));

  // Calculate total gas fees: (GasFeeCap + GasPremium) * GasLimit
  const feePerUnit = BigInt(gasEstimate.GasFeeCap) + BigInt(gasEstimate.GasPremium);
  const totalGasFees = feePerUnit * BigInt(gasEstimate.GasLimit);

  const grandTotal = totalValue + totalGasFees;

  return {
    totalValue: totalValue.toString(),
    totalGasFees: totalGasFees.toString(),
    grandTotal: grandTotal.toString(),
  };
}

/**
 * Build complete batch transaction with gas estimation
 */
export async function buildBatchTransaction(
  request: BatchTransactionRequest
): Promise<BatchTransactionResult> {
  // Build base messages
  const messages = buildBatchMessages(request);
  
  // Estimate gas
  const gasEstimate = await estimateBatchGas(messages);
  
  // Apply gas estimates to messages
  const messagesWithGas = applyGasEstimates(messages, gasEstimate);
  
  // Calculate costs
  const costs = calculateTotalCost(messagesWithGas, gasEstimate);

  return {
    messages: messagesWithGas,
    estimatedGas: gasEstimate,
    totalValue: costs.totalValue,
    feeEstimate: costs.totalGasFees,
  };
}

/**
 * Validate that sender has sufficient balance for batch
 */
export function validateSufficientBalance(
  senderBalance: string, // in attoFIL
  batchResult: BatchTransactionResult
): {
  isValid: boolean;
  required: string; // in attoFIL
  available: string; // in attoFIL
  shortfall?: string; // in attoFIL
} {
  const required = BigInt(batchResult.totalValue) + BigInt(batchResult.feeEstimate);
  const available = BigInt(senderBalance);
  
  const isValid = available >= required;
  
  return {
    isValid,
    required: required.toString(),
    available: available.toString(),
    shortfall: isValid ? undefined : (required - available).toString(),
  };
} 