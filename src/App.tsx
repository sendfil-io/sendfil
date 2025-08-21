import * as React from 'react';
//import reactLogo from './assets/react.svg'
//import viteLogo from '/vite.svg'
import './App.css';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CustomConnectButton } from './components/CustomConnectButton';
import { calculateFeeRows } from './utils/fee';

interface Recipient {
  address: string;
  amount: string;
}

export default function App() {
  const [recipients, setRecipients] = React.useState<Recipient[]>([
    { address: '', amount: '' },
    { address: '', amount: '' },
    { address: '', amount: '' },
    { address: '', amount: '' },
  ]);

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
    <div className="h-screen w-full bg-white flex">
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
        </div>

        <div className="grid grid-cols-[1fr,auto] gap-x-4 gap-y-3">
          <div className="font-medium">Receiver</div>
          <div className="font-medium">FIL Amount</div>

          {recipients.map((recipient, index) => (
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
          ))}
        </div>

        <button
          className="mt-4 text-blue-500 hover:text-blue-600 bg-gray-100 rounded-md p-2"
          onClick={addRecipient}
        >
          + Add receiver
        </button>
        <button
          className="mt-4 text-white bg-blue-500 hover:bg-blue-600 rounded-md p-2"
          onClick={handleReview}
        >
          Review Batch
        </button>
      </div>
    </div>
  );
}
