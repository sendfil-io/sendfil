import React, { useCallback, useState } from 'react';
import Papa, { type ParseResult } from 'papaparse';
import { validateRecipientRows } from '../utils/recipientValidation';

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
  disabled?: boolean;
  expectedNetworkPrefix?: 'f' | 't';
}

export const CSVUpload: React.FC<CSVUploadProps> = ({
  onUpload,
  disabled = false,
  expectedNetworkPrefix,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const processCSV = useCallback(
    async (file: File) => {
      setIsProcessing(true);

      try {
        const text = await file.text();

        Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim().toLowerCase(),
          complete: (results: ParseResult<Record<string, string>>) => {
            const parsedRecipients: CSVRecipient[] = [];
            const errors: string[] = [];

            // Check for required columns
            const headers = results.meta.fields || [];
            const hasReceiverAddress = headers.some((h: string) =>
              ['receiveraddress', 'receiver_address', 'address', 'to'].includes(h.toLowerCase()),
            );
            const hasValue = headers.some((h: string) =>
              ['value', 'amount', 'fil', 'tokens'].includes(h.toLowerCase()),
            );

            if (!hasReceiverAddress) {
              errors.push('Missing required column: receiverAddress (or similar)');
            }
            if (!hasValue) {
              errors.push('Missing required column: value (or similar)');
            }

            if (errors.length === 0) {
              results.data.forEach((row: Record<string, string>, index: number) => {
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

                parsedRecipients.push({
                  receiverAddress: address,
                  value,
                  lineNumber,
                });
              });
            }

            const validationResult =
              errors.length === 0
                ? validateRecipientRows(
                    parsedRecipients.map((recipient) => ({
                      address: recipient.receiverAddress,
                      amount: recipient.value,
                      lineNumber: recipient.lineNumber,
                    })),
                    {
                      source: 'csv',
                      expectedNetworkPrefix,
                      requireAtLeastOneRecipient: true,
                    },
                  )
                : {
                    validRecipients: [],
                    errors: [],
                    warnings: [],
                    nonEmptyRowCount: 0,
                  };

            onUpload({
              recipients: validationResult.validRecipients.map((recipient) => ({
                receiverAddress: recipient.address,
                value: recipient.amount,
                lineNumber: recipient.lineNumber,
              })),
              errors: [...errors, ...validationResult.errors],
              warnings: validationResult.warnings,
            });
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
    [expectedNetworkPrefix, onUpload],
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
          rounded-[24px] border-2 border-dashed p-8 text-center transition-all
          ${isDragOver ? 'border-[#1f69ff] bg-blue-50' : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'}
          ${
            disabled || isProcessing
              ? 'opacity-50 cursor-not-allowed'
              : 'cursor-pointer'
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
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-[#1f69ff]"></div>
            <p className="text-slate-600">Processing CSV file...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="mb-4 text-4xl">📄</div>
            <h3 className="mb-2 text-lg font-semibold text-slate-950">Upload CSV File</h3>
            <p className="mb-4 max-w-md text-sm text-slate-600">
              Drag and drop your CSV file here, or click to browse
            </p>
            <p className="text-sm text-slate-500">Expected format: receiverAddress, value</p>
            {expectedNetworkPrefix ? (
              <p className="mt-2 text-xs text-slate-400">
                Current network expects native addresses that start with {expectedNetworkPrefix}...
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Connect a wallet to lock the batch to mainnet or Calibration before review.
              </p>
            )}
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
    </div>
  );
};

export default CSVUpload;
