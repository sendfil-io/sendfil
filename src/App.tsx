import * as React from 'react';
//import reactLogo from './assets/react.svg'
//import viteLogo from '/vite.svg'
import './App.css';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CustomConnectButton } from './components/CustomConnectButton';
import NetworkBanner from './components/NetworkBanner';
import CSVUpload, { CSVRecipient, CSVUploadResult } from './components/CSVUpload';
import { useAccount } from 'wagmi';
import { calculateFeeRows } from './utils/fee';

interface Recipient {
  address: string;
  amount: string;
}

export default function App() {
  const { isConnected } = useAccount();
  const [recipients, setRecipients] = React.useState<Recipient[]>([]);
  const [csvData, setCsvData] = React.useState<CSVRecipient[]>([]);
  const [csvErrors, setCsvErrors] = React.useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = React.useState<string[]>([]);
  const [showManualInput, setShowManualInput] = React.useState(false);

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

  const handleReview = () => {
    const rows = calculateFeeRows(
      recipients
        .filter((r) => r.address && r.amount)
        .map((r) => ({ address: r.address, amount: Number(r.amount) })),
    );

    console.log('recipients with fees', rows);

    // Calculate totals for display
    const recipientTotal = recipients.reduce((sum, r) => sum + parseFloat(r.amount || '0'), 0);
    const feeTotal = rows.slice(recipients.length).reduce((sum, r) => sum + r.amount, 0);
    const grandTotal = recipientTotal + feeTotal;

    // For now, just alert with the preview - later this will be a proper modal
    alert(`Batch Review:
    
Recipients: ${recipients.length}
Recipient Total: ${recipientTotal.toFixed(6)} FIL
Fee (1%): ${feeTotal.toFixed(6)} FIL
Grand Total: ${grandTotal.toFixed(6)} FIL

Check console for full details.`);
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
        <div className="flex-1 p-8 flex flex-col">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold mb-1">SendFIL</h1>
            <p className="text-gray-600 text-sm">Transfer FIL to one or many recipients.</p>
          </div>

          {/* Show main interface only when wallet is connected */}
          {isConnected ? (
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
                  <CSVUpload onUpload={handleCSVUpload} onReset={handleCSVReset} disabled={false} />
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
                    {recipients.reduce((sum, r) => sum + parseFloat(r.amount || '0'), 0).toFixed(6)}{' '}
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

              {/* Manual Input Section or Recipients Display */}
              {(showManualInput || csvData.length > 0) && (
                <>
                  <div className="grid grid-cols-[1fr,auto] gap-x-4 gap-y-3">
                    <div className="font-medium">Receiver</div>
                    <div className="font-medium">FIL Amount</div>

                    {showManualInput
                      ? // Manual input mode
                        recipients.map((recipient, index) => (
                          <React.Fragment key={index}>
                            <div className="relative">
                              <input
                                placeholder="f1..."
                                value={recipient.address}
                                onChange={(e) => updateRecipient(index, 'address', e.target.value)}
                                className="w-full p-2 border rounded-md bg-gray-100"
                              />
                            </div>
                            <div className="relative flex items-center gap-2">
                              <input
                                type="number"
                                placeholder="0"
                                value={recipient.amount}
                                onChange={(e) => updateRecipient(index, 'amount', e.target.value)}
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
                            <div className="p-2 bg-gray-50 rounded-md text-sm font-mono">
                              {recipient.address}
                            </div>
                            <div className="p-2 bg-gray-50 rounded-md text-sm text-right">
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
                </>
              )}

              {/* Review Button - only show when we have valid recipients */}
              {recipients.length > 0 && csvErrors.length === 0 && (
                <button
                  className="mt-4 text-white bg-blue-500 hover:bg-blue-600 rounded-md p-2"
                  onClick={handleReview}
                >
                  Review Batch ({recipients.length} recipients)
                </button>
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
    </div>
  );
}
