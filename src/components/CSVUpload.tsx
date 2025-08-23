import React, { useCallback, useState } from 'react';
import Papa from 'papaparse';

export interface CSVRecipient {
  receiverAddress: string;
  value: string;
  lineNumber: number;
}

export interface CSVUploadResult {
  recipients: CSVRecipient[];
  errors: string[];
  warnings: string[];
}

interface CSVUploadProps {
  onUpload: (result: CSVUploadResult) => void;
  onReset: () => void;
  disabled?: boolean;
}

export const CSVUpload: React.FC<CSVUploadProps> = ({ onUpload, onReset, disabled = false }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const validateAddress = (address: string): boolean => {
    // Basic Filecoin address validation
    if (!address || typeof address !== 'string') return false;

    // Check for f1, f2, f3, f4, t1, t2, t3, t4 addresses
    const filecoinAddressRegex = /^[ft][0-4][a-zA-Z0-9]{38,}$/;
    return filecoinAddressRegex.test(address.trim());
  };

  const validateValue = (value: string): { isValid: boolean; numericValue?: number } => {
    if (!value || typeof value !== 'string') return { isValid: false };

    const trimmed = value.trim();
    const numericValue = parseFloat(trimmed);

    if (isNaN(numericValue) || numericValue <= 0) {
      return { isValid: false };
    }

    return { isValid: true, numericValue };
  };

  const processCSV = useCallback(
    async (file: File) => {
      setIsProcessing(true);

      try {
        const text = await file.text();

        Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim().toLowerCase(),
          complete: (results) => {
            const recipients: CSVRecipient[] = [];
            const errors: string[] = [];
            const warnings: string[] = [];
            const seenAddresses = new Set<string>();

            // Check for required columns
            const headers = results.meta.fields || [];
            const hasReceiverAddress = headers.some((h) =>
              ['receiveraddress', 'receiver_address', 'address', 'to'].includes(h.toLowerCase()),
            );
            const hasValue = headers.some((h) =>
              ['value', 'amount', 'fil', 'tokens'].includes(h.toLowerCase()),
            );

            if (!hasReceiverAddress) {
              errors.push('Missing required column: receiverAddress (or similar)');
            }
            if (!hasValue) {
              errors.push('Missing required column: value (or similar)');
            }

            if (errors.length === 0) {
              results.data.forEach((row, index) => {
                const lineNumber = index + 2; // +1 for 0-indexing, +1 for header row

                // Find the address and value fields (case insensitive)
                const addressKey = Object.keys(row).find((key) =>
                  ['receiveraddress', 'receiver_address', 'address', 'to'].includes(
                    key.toLowerCase(),
                  ),
                );
                const valueKey = Object.keys(row).find((key) =>
                  ['value', 'amount', 'fil', 'tokens'].includes(key.toLowerCase()),
                );

                const address = addressKey ? row[addressKey]?.trim() || '' : '';
                const value = valueKey ? row[valueKey]?.trim() || '' : '';

                // Skip empty rows
                if (!address && !value) return;

                // Validate address
                if (!validateAddress(address)) {
                  errors.push(`Line ${lineNumber}: Invalid Filecoin address "${address}"`);
                  return;
                }

                // Check for duplicates
                if (seenAddresses.has(address)) {
                  warnings.push(`Line ${lineNumber}: Duplicate address "${address}"`);
                } else {
                  seenAddresses.add(address);
                }

                // Validate value
                const valueValidation = validateValue(value);
                if (!valueValidation.isValid) {
                  errors.push(
                    `Line ${lineNumber}: Invalid value "${value}" (must be positive number)`,
                  );
                  return;
                }

                recipients.push({
                  receiverAddress: address,
                  value: value,
                  lineNumber,
                });
              });
            }

            // Additional validations
            if (recipients.length === 0 && errors.length === 0) {
              errors.push('No valid recipients found in CSV file');
            }

            if (recipients.length > 1000) {
              warnings.push(
                `Large batch detected: ${recipients.length} recipients. Consider splitting into smaller batches.`,
              );
            }

            onUpload({ recipients, errors, warnings });
            setIsProcessing(false);
          },
          error: (error: Error) => {
            onUpload({
              recipients: [],
              errors: [`Failed to parse CSV: ${error.message}`],
              warnings: [],
            });
            setIsProcessing(false);
          },
        });
      } catch (error) {
        onUpload({
          recipients: [],
          errors: [
            `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ],
          warnings: [],
        });
        setIsProcessing(false);
      }
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      if (disabled || isProcessing) return;

      const files = Array.from(e.dataTransfer.files);
      const csvFile = files.find(
        (file) => file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv'),
      );

      if (!csvFile) {
        onUpload({
          recipients: [],
          errors: ['Please upload a CSV file'],
          warnings: [],
        });
        return;
      }

      processCSV(csvFile);
    },
    [disabled, isProcessing, processCSV, onUpload],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!disabled && !isProcessing) {
        setIsDragOver(true);
      }
    },
    [disabled, isProcessing],
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && !disabled && !isProcessing) {
        processCSV(file);
      }
    },
    [disabled, isProcessing, processCSV],
  );

  return (
    <div className="w-full">
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-all
          ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${
            disabled || isProcessing
              ? 'opacity-50 cursor-not-allowed'
              : 'cursor-pointer hover:bg-gray-50'
          }
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() =>
          !disabled && !isProcessing && document.getElementById('csv-file-input')?.click()
        }
      >
        {isProcessing ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
            <p className="text-gray-600">Processing CSV file...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="text-4xl mb-4">📄</div>
            <h3 className="text-lg font-semibold mb-2">Upload CSV File</h3>
            <p className="text-gray-600 mb-4">
              Drag and drop your CSV file here, or click to browse
            </p>
            <p className="text-sm text-gray-500">Expected format: receiverAddress, value</p>
          </div>
        )}
      </div>

      <input
        id="csv-file-input"
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isProcessing}
      />

      {/* Reset button - show when there's data uploaded */}
      <div className="mt-4 flex justify-center">
        <button
          onClick={onReset}
          className="text-sm bg-gray-100 text-gray-500 hover:text-gray-700 underline"
          disabled={disabled || isProcessing}
        >
          Clear and upload different file
        </button>
      </div>
    </div>
  );
};

export default CSVUpload;
