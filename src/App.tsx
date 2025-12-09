import * as React from 'react';
//import reactLogo from './assets/react.svg'
//import viteLogo from '/vite.svg'
import './App.css';
import { CustomConnectButton } from './components/CustomConnectButton';
import NetworkBanner from './components/NetworkBanner';
import CSVUpload, { CSVRecipient, CSVUploadResult } from './components/CSVUpload';
import TransactionTest from './components/TransactionTest';
import ReviewTransactionModal, {
  TransactionState,
  GasEstimate,
} from './components/ReviewTransactionModal';
import { useAccount, useBalance } from 'wagmi';
import { calculateFeeRows } from './utils/fee';
import { buildBatchTransaction, attoFilToFil } from './lib/transaction/messageBuilder';
import { getBalance, getNonce } from './lib/DataProvider';

interface Recipient {
  address: string;
  amount: string;
}

export default function App() {
  const { isConnected, address } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const [recipients, setRecipients] = React.useState<Recipient[]>([]);
  const [csvData, setCsvData] = React.useState<CSVRecipient[]>([]);
  const [csvErrors, setCsvErrors] = React.useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = React.useState<string[]>([]);
  const [showManualInput, setShowManualInput] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'send' | 'test'>('send');

  // Review Modal State
  const [isReviewModalOpen, setIsReviewModalOpen] = React.useState(false);
  const [transactionState, setTransactionState] = React.useState<TransactionState>('review');
  const [gasEstimate, setGasEstimate] = React.useState<GasEstimate | undefined>(undefined);
  const [isEstimatingGas, setIsEstimatingGas] = React.useState(false);
  const [gasEstimationError, setGasEstimationError] = React.useState<string | undefined>(undefined);
  const [transactionHash, setTransactionHash] = React.useState<string | undefined>(undefined);
  const [transactionError, setTransactionError] = React.useState<string | undefined>(undefined);

  // Initialize manual input with empty recipients when switching to manual mode
  React.useEffect(() => {
    if (showManualInput && recipients.length === 0) {
      setRecipients([
        { address: '', amount: '' },
        { address: '', amount: '' },
        { address: '', amount: '' },
        { address: '', amount: '' },
      ]);
    }
  }, [showManualInput, recipients.length]);

  const handleCSVUpload = (result: CSVUploadResult) => {
    setCsvData(result.recipients);
    setCsvErrors(result.errors);
    setCsvWarnings(result.warnings);

    // Convert CSV data to recipients format for compatibility
    if (result.recipients.length > 0 && result.errors.length === 0) {
      const convertedRecipients = result.recipients.map((csvRecipient) => ({
        address: csvRecipient.receiverAddress,
        amount: csvRecipient.value,
      }));
      setRecipients(convertedRecipients);
    }
  };

  const handleCSVReset = () => {
    setCsvData([]);
    setCsvErrors([]);
    setCsvWarnings([]);
    setRecipients([]);
    setShowManualInput(false);
  };

  const addRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '' }]);
  };

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    const newRecipients = [...recipients];
    newRecipients[index] = { ...newRecipients[index], [field]: value };
    setRecipients(newRecipients);
  };

  // Calculate fee and totals for the modal
  const validRecipients = recipients
    .filter((r) => r.address && r.amount)
    .map((r) => ({ address: r.address, amount: Number(r.amount) }));

  const recipientTotal = validRecipients.reduce((sum, r) => sum + r.amount, 0);

  // Calculate fee (safely handle empty recipients)
  const feeTotal = React.useMemo(() => {
    if (validRecipients.length === 0) return 0;
    try {
      const rows = calculateFeeRows(validRecipients);
      return rows.slice(validRecipients.length).reduce((sum, r) => sum + r.amount, 0);
    } catch {
      return 0;
    }
  }, [validRecipients]);

  // Get wallet balance in FIL
  const walletBalance = balanceData ? Number(balanceData.formatted) : 0;
  const estimatedNetworkFee = gasEstimate?.estimatedFeeInFil || 0;
  const insufficientBalance = walletBalance < recipientTotal + feeTotal + estimatedNetworkFee;

  const handleReview = async () => {
    if (validRecipients.length === 0) {
      alert('Please add at least one recipient');
      return;
    }

    // Reset modal state
    setTransactionState('review');
    setGasEstimate(undefined);
    setGasEstimationError(undefined);
    setTransactionHash(undefined);
    setTransactionError(undefined);
    setIsReviewModalOpen(true);

    // Start gas estimation
    if (address) {
      setIsEstimatingGas(true);
      try {
        // Get all recipients including fee rows
        const allRecipients = calculateFeeRows(validRecipients);

        const batchResult = await buildBatchTransaction({
          recipients: allRecipients,
          senderAddress: address,
          startingNonce: await getNonce(address),
        });

        setGasEstimate({
          gasLimit: batchResult.estimatedGas.GasLimit,
          gasFeeCap: batchResult.estimatedGas.GasFeeCap,
          gasPremium: batchResult.estimatedGas.GasPremium,
          estimatedFeeInFil: attoFilToFil(batchResult.feeEstimate),
        });
      } catch (error) {
        console.error('Gas estimation failed:', error);
        setGasEstimationError(
          error instanceof Error ? error.message : 'Failed to estimate gas',
        );
      } finally {
        setIsEstimatingGas(false);
      }
    }
  };

  const handleCloseReviewModal = () => {
    // Only allow closing in certain states
    if (transactionState === 'signing') {
      return; // Don't allow closing while signing
    }
    setIsReviewModalOpen(false);
  };

  const handleConfirmTransaction = async () => {
    setTransactionState('signing');
    setTransactionError(undefined);

    try {
      // TODO: Implement actual transaction execution with wagmi
      // For now, simulate the flow
      setTransactionState('pending');

      // Simulate transaction delay
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Simulate success (replace with actual transaction logic)
      setTransactionHash('bafy2bzaced...example');
      setTransactionState('confirmed');
    } catch (error) {
      console.error('Transaction failed:', error);
      setTransactionError(error instanceof Error ? error.message : 'Transaction failed');
      setTransactionState('failed');
    }
  };

  const handleDownloadTemplate = () => {
    try {
      console.log('Download template button clicked');

      // Method 1: Try to fetch the actual file from public directory
      fetch('/sendfil-template.csv')
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.blob();
        })
        .then((blob) => {
          console.log('Successfully fetched template file');

          // Create download link
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'sendfil-template.csv';
          link.style.display = 'none';

          document.body.appendChild(link);
          console.log('Triggering download from file...');
          link.click();

          // Clean up
          setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            console.log('Download cleanup completed');
          }, 1000);
        })
        .catch((error) => {
          console.log('Failed to fetch file, using fallback method:', error);

          // Fallback: Use hardcoded content (temporary until file is properly served)
          const csvContent = `receiverAddress,value
f1cj...,3.3`;

          const blob = new Blob([csvContent], {
            type: 'text/csv;charset=utf-8;',
          });

          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'sendfil-template.csv';
          link.style.display = 'none';

          document.body.appendChild(link);
          console.log('Triggering fallback download...');
          link.click();

          setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            console.log('Fallback download cleanup completed');
          }, 1000);
        });
    } catch (error) {
      console.error('Error in download template:', error);
    }
  };

  return (
    <div className="h-screen w-full bg-white flex flex-col">
      {/* Network Banner - shows at top when needed */}
      <NetworkBanner />

      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-64 border-r p-6 flex flex-col items-start bg-white">
          <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center mb-4">
            <span className="text-white text-2xl font-bold">ƒ</span>
          </div>
          <CustomConnectButton />
        </div>

        {/* Main Content */}
        <div className="flex-1 p-8 flex flex-col bg-white">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold mb-1">SendFIL</h1>
            <p className="text-gray-600 text-sm">Transfer FIL to one or many recipients.</p>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              onClick={() => setActiveTab('send')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'send'
                  ? 'border-blue-500 text-blue-600 bg-white'
                  : 'border-transparent bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              Send FIL
            </button>
            <button
              onClick={() => setActiveTab('test')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'test'
                  ? 'border-blue-500 text-blue-600 bg-white'
                  : 'border-transparent bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              Transaction Testing
            </button>
          </div>

          {/* Show main interface only when wallet is connected */}
          {isConnected ? (
            <>
              {activeTab === 'send' ? (
                <>
                  <div className="flex gap-3 mb-8">
                    <button className="bg-blue-500 hover:bg-blue-600 text-white rounded-md px-4 py-2">
                      Import configuration
                    </button>
                    <button
                      className="bg-gray-100 text-blue-500 rounded-md px-4 py-2"
                      onClick={handleDownloadTemplate}
                    >
                      Download Template
                    </button>
                    <button
                      className="bg-gray-100 text-gray-700 rounded-md px-4 py-2"
                      onClick={() => setShowManualInput(!showManualInput)}
                    >
                      {showManualInput ? 'Use CSV Upload' : 'Manual Input'}
                    </button>
                  </div>

                  {/* CSV Upload Section */}
                  {!showManualInput && csvData.length === 0 && (
                    <div className="mb-8">
                      <CSVUpload
                        onUpload={handleCSVUpload}
                        onReset={handleCSVReset}
                        disabled={false}
                      />
                    </div>
                  )}

                  {/* CSV Validation Messages */}
                  {(csvErrors.length > 0 || csvWarnings.length > 0) && (
                    <div className="mb-6 space-y-2">
                      {csvErrors.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-md p-4">
                          <h4 className="font-semibold text-red-800 mb-2">Errors:</h4>
                          <ul className="text-sm text-red-700 space-y-1">
                            {csvErrors.map((error, index) => (
                              <li key={index}>• {error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {csvWarnings.length > 0 && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                          <h4 className="font-semibold text-yellow-800 mb-2">Warnings:</h4>
                          <ul className="text-sm text-yellow-700 space-y-1">
                            {csvWarnings.map((warning, index) => (
                              <li key={index}>• {warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* CSV Data Summary */}
                  {csvData.length > 0 && csvErrors.length === 0 && (
                    <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4">
                      <h4 className="font-semibold text-green-800 mb-2">
                        ✅ Successfully loaded {csvData.length} recipients
                      </h4>
                      <div className="text-sm text-green-700 mb-3">
                        Total amount:{' '}
                        {recipients
                          .reduce((sum, r) => sum + parseFloat(r.amount || '0'), 0)
                          .toFixed(6)}{' '}
                        FIL
                      </div>
                      <button
                        onClick={handleCSVReset}
                        className="text-sm text-green-600 hover:text-green-800 underline"
                      >
                        Upload different file
                      </button>
                    </div>
                  )}

                  {/* Spacing */}
                  {csvData.length > 0 && <div className="mb-6" />}

                  {/* Manual Input Section or Recipients Display */}
                  {(showManualInput || csvData.length > 0) && (
                    <>
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold mb-4 text-gray-800">
                          {showManualInput ? 'Manual Recipients' : 'CSV Recipients'}
                        </h3>
                        <div className="grid grid-cols-[1fr,auto] gap-x-4 gap-y-3">
                          <div className="font-medium text-gray-700">Receiver</div>
                          <div className="font-medium text-gray-700">FIL Amount</div>

                          {showManualInput
                            ? // Manual input mode
                              recipients.map((recipient, index) => (
                                <React.Fragment key={index}>
                                  <div className="relative">
                                    <input
                                      placeholder="f1..."
                                      value={recipient.address}
                                      onChange={(e) =>
                                        updateRecipient(index, 'address', e.target.value)
                                      }
                                      className="w-full p-2 border rounded-md bg-gray-100"
                                    />
                                  </div>
                                  <div className="relative flex items-center gap-2">
                                    <input
                                      type="number"
                                      placeholder="0"
                                      value={recipient.amount}
                                      onChange={(e) =>
                                        updateRecipient(index, 'amount', e.target.value)
                                      }
                                      className="w-full p-2 border rounded-md bg-gray-100"
                                    />
                                    {recipients.length > 1 && (
                                      <button
                                        onClick={() => removeRecipient(index)}
                                        className="text-gray-500 hover:text-gray-700 bg-gray-100 rounded-md p-2"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                </React.Fragment>
                              ))
                            : // CSV display mode - show loaded recipients
                              recipients.map((recipient, index) => (
                                <React.Fragment key={index}>
                                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm font-mono text-blue-900 break-all">
                                    {recipient.address}
                                  </div>
                                  <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-right font-medium text-green-900">
                                    {recipient.amount} FIL
                                  </div>
                                </React.Fragment>
                              ))}
                        </div>

                        {showManualInput && (
                          <button
                            className="mt-4 text-blue-500 hover:text-blue-600 bg-gray-100 rounded-md p-2"
                            onClick={addRecipient}
                          >
                            + Add receiver
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {/* Review Button - only show when we have valid recipients */}
                  {recipients.length > 0 && csvErrors.length === 0 && (
                    <div className="mt-6">
                      <button
                        className="w-full text-white bg-blue-500 hover:bg-blue-600 rounded-md py-3 px-4 font-medium text-lg"
                        onClick={handleReview}
                      >
                        Review Batch ({recipients.length} recipients)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <TransactionTest />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">🔗</div>
                <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
                <p className="text-gray-600 mb-4">
                  Connect your wallet to start sending FIL to multiple recipients
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Review Transaction Modal */}
      <ReviewTransactionModal
        isOpen={isReviewModalOpen}
        onClose={handleCloseReviewModal}
        onConfirm={handleConfirmTransaction}
        recipients={validRecipients}
        validationErrors={csvErrors}
        validationWarnings={csvWarnings}
        recipientTotal={recipientTotal}
        feeTotal={feeTotal}
        gasEstimate={gasEstimate}
        isEstimatingGas={isEstimatingGas}
        gasEstimationError={gasEstimationError}
        walletBalance={walletBalance}
        insufficientBalance={insufficientBalance}
        transactionState={transactionState}
        transactionHash={transactionHash}
        transactionError={transactionError}
      />
    </div>
  );
}
