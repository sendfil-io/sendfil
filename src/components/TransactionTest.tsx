import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { getBalance, getNonce, getChainHead } from '../lib/DataProvider';
import {
  buildBatchTransaction,
  attoFilToFil,
  validateSufficientBalance,
} from '../lib/transaction/messageBuilder';
import { executeBatchTransaction, prepareRecipientsWithFees } from '../lib/transaction/executor';
import { convertEthToF4 } from '../utils/addressConverter';

interface TestResult {
  type: 'success' | 'error' | 'info';
  message: string;
  data?: any;
}

export const TransactionTest: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [results, setResults] = useState<TestResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addResult = (result: TestResult) => {
    setResults((prev) => [...prev, { ...result, timestamp: Date.now() }]);
  };

  const clearResults = () => setResults([]);

  const testRpcConnection = async () => {
    try {
      setIsLoading(true);
      addResult({ type: 'info', message: 'Testing RPC connection...' });

      const chainHead = await getChainHead();
      addResult({
        type: 'success',
        message: `RPC connection successful! Chain height: ${chainHead.Height}`,
        data: chainHead,
      });
    } catch (error) {
      addResult({
        type: 'error',
        message: `RPC connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testWalletData = async () => {
    if (!address || !isConnected) {
      addResult({ type: 'error', message: 'Wallet not connected' });
      return;
    }

    try {
      setIsLoading(true);
      const f4Address = convertEthToF4(address);
      addResult({ type: 'info', message: `Testing wallet data for ${f4Address}...` });

      const [balance, nonce] = await Promise.all([getBalance(f4Address), getNonce(f4Address)]);

      addResult({
        type: 'success',
        message: `Wallet data retrieved successfully!`,
        data: {
          address: f4Address,
          balance: `${attoFilToFil(balance)} FIL`,
          nonce,
        },
      });
    } catch (error) {
      addResult({
        type: 'error',
        message: `Failed to get wallet data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testTransactionBuilding = async () => {
    if (!address || !isConnected) {
      addResult({ type: 'error', message: 'Wallet not connected' });
      return;
    }

    try {
      setIsLoading(true);
      const f4Address = convertEthToF4(address);
      addResult({ type: 'info', message: 'Testing transaction building...' });

      // Create test recipients
      const testRecipients = [
        { address: 'f1test1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 0.001 },
        { address: 'f1test2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 0.002 },
      ];

      // Add fees
      const recipientsWithFees = prepareRecipientsWithFees(testRecipients);

      addResult({
        type: 'info',
        message: `Recipients with fees:`,
        data: recipientsWithFees,
      });

      // Build batch transaction
      const batchResult = await buildBatchTransaction({
        recipients: recipientsWithFees,
        senderAddress: f4Address,
        startingNonce: 0,
      });

      addResult({
        type: 'success',
        message: 'Transaction building successful!',
        data: {
          messageCount: batchResult.messages.length,
          totalValue: `${attoFilToFil(batchResult.totalValue)} FIL`,
          gasEstimate: `${attoFilToFil(batchResult.feeEstimate)} FIL`,
          messages: batchResult.messages.map((msg) => ({
            to: msg.To,
            value: `${attoFilToFil(msg.Value)} FIL`,
            nonce: msg.Nonce,
            gasLimit: msg.GasLimit,
          })),
        },
      });

      // Test balance validation
      const balance = await getBalance(f4Address);
      const balanceCheck = validateSufficientBalance(balance, batchResult);

      addResult({
        type: balanceCheck.isValid ? 'success' : 'error',
        message: balanceCheck.isValid
          ? 'Sufficient balance for transaction'
          : 'Insufficient balance for transaction',
        data: {
          required: `${attoFilToFil(balanceCheck.required)} FIL`,
          available: `${attoFilToFil(balanceCheck.available)} FIL`,
          shortfall: balanceCheck.shortfall
            ? `${attoFilToFil(balanceCheck.shortfall)} FIL`
            : undefined,
        },
      });
    } catch (error) {
      addResult({
        type: 'error',
        message: `Transaction building failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testDryRun = async () => {
    if (!address || !isConnected) {
      addResult({ type: 'error', message: 'Wallet not connected' });
      return;
    }

    try {
      setIsLoading(true);
      const f4Address = convertEthToF4(address);
      addResult({ type: 'info', message: 'Running transaction dry run...' });

      // Create test recipients
      const testRecipients = [
        { address: 'f1test1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 0.001 },
        { address: 'f1test2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 0.002 },
      ];

      const recipientsWithFees = prepareRecipientsWithFees(testRecipients);

      const result = await executeBatchTransaction(
        {
          recipients: recipientsWithFees,
          senderAddress: f4Address,
        },
        { dryRun: true },
      );

      addResult({
        type: result.success ? 'success' : 'error',
        message: result.success ? 'Dry run completed successfully!' : 'Dry run failed',
        data: {
          success: result.success,
          transactionCount: result.transactionCids.length,
          errors: result.errors,
          batchResult: result.batchResult
            ? {
                totalValue: attoFilToFil(result.batchResult.totalValue),
                gasEstimate: attoFilToFil(result.batchResult.feeEstimate),
              }
            : undefined,
        },
      });
    } catch (error) {
      addResult({
        type: 'error',
        message: `Dry run failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-md">
        <p className="text-yellow-800">
          Please connect your wallet to test transaction functionality.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <h3 className="font-semibold text-blue-800 mb-2">Transaction Testing</h3>
        <p className="text-blue-700 text-sm mb-4">
          Test transaction building and execution safely without sending real transactions.
        </p>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={testRpcConnection}
            disabled={isLoading}
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Test RPC
          </button>

          <button
            onClick={testWalletData}
            disabled={isLoading}
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Test Wallet Data
          </button>

          <button
            onClick={testTransactionBuilding}
            disabled={isLoading}
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Test Transaction Building
          </button>

          <button
            onClick={testDryRun}
            disabled={isLoading}
            className="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Test Dry Run
          </button>

          <button
            onClick={clearResults}
            disabled={isLoading}
            className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Clear Results
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold">Test Results:</h4>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {results.map((result, index) => (
              <div
                key={index}
                className={`p-3 rounded text-sm ${
                  result.type === 'success'
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : result.type === 'error'
                      ? 'bg-red-50 border border-red-200 text-red-800'
                      : 'bg-gray-50 border border-gray-200 text-gray-800'
                }`}
              >
                <div className="font-medium">{result.message}</div>
                {result.data && (
                  <pre className="mt-2 text-xs overflow-x-auto">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">Testing...</span>
        </div>
      )}
    </div>
  );
};

export default TransactionTest;
