import { newFromString } from '@glif/filecoin-address';
import { getAddress, isAddress } from 'viem';
import { normalizeToEvmAddress } from './addressEncoder';

export interface RecipientInput {
  address: string;
  amount: string;
  lineNumber?: number;
}

export interface ValidatedRecipient extends RecipientInput {
  lineNumber: number;
}

export interface RecipientValidationOptions {
  source: 'csv' | 'manual';
  expectedNetworkPrefix?: 'f' | 't';
  maxRecipients?: number;
  requireAtLeastOneRecipient?: boolean;
}

export interface RecipientValidationResult {
  validRecipients: ValidatedRecipient[];
  errors: string[];
  warnings: string[];
  nonEmptyRowCount: number;
}

export const DUPLICATE_RECIPIENT_WARNING_MARKER = 'Duplicate recipient matches';

interface AddressValidationResult {
  isValid: boolean;
  normalizedAddress?: string;
  duplicateKey?: string;
  error?: string;
}

interface AmountValidationResult {
  isValid: boolean;
  normalizedAmount?: string;
  error?: string;
}

const DEFAULT_MAX_RECIPIENTS = 500;

function normalizeEvmInput(address: string): `0x${string}` | null {
  if (!/^0x/i.test(address)) {
    return null;
  }

  const normalizedPrefixAddress = `0x${address.slice(2)}`;
  if (!isAddress(normalizedPrefixAddress)) {
    return null;
  }

  return getAddress(normalizedPrefixAddress);
}

function getRowLabel(
  source: RecipientValidationOptions['source'],
  lineNumber: number,
): string {
  return source === 'csv' ? `Line ${lineNumber}` : `Recipient ${lineNumber}`;
}

function toAttoFil(amount: string): bigint {
  const [whole, decimal = ''] = amount.split('.');
  const paddedDecimal = decimal.padEnd(18, '0');
  return BigInt(`${whole}${paddedDecimal}`);
}

function validateAmount(amount: string): AmountValidationResult {
  const trimmed = amount.trim();

  if (!trimmed) {
    return {
      isValid: false,
      error: 'Amount is required',
    };
  }

  if (!/^\d+(?:\.\d{1,18})?$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'Amount must be a positive FIL value with up to 18 decimal places',
    };
  }

  if (toAttoFil(trimmed) <= 0n) {
    return {
      isValid: false,
      error: 'Amount must be greater than 0',
    };
  }

  return {
    isValid: true,
    normalizedAmount: trimmed,
  };
}

function validateAddress(
  address: string,
  expectedNetworkPrefix?: 'f' | 't',
): AddressValidationResult {
  const trimmed = address.trim();

  if (!trimmed) {
    return {
      isValid: false,
      error: 'Address is required',
    };
  }

  const normalizedEvmAddress = normalizeEvmInput(trimmed);
  if (normalizedEvmAddress) {
    return {
      isValid: true,
      normalizedAddress: normalizedEvmAddress,
      duplicateKey: normalizedEvmAddress.toLowerCase(),
    };
  }

  try {
    newFromString(trimmed);
  } catch {
    return {
      isValid: false,
      error: `Invalid address "${trimmed}"`,
    };
  }

  if (/^[ft]0/.test(trimmed)) {
    return {
      isValid: false,
      error: 'f0/t0 ID addresses are not supported',
    };
  }

  if (!/^[ft][1234]/.test(trimmed)) {
    return {
      isValid: false,
      error: `Unsupported address format "${trimmed}"`,
    };
  }

  if (expectedNetworkPrefix && trimmed[0] !== expectedNetworkPrefix) {
    const networkLabel = expectedNetworkPrefix === 'f' ? 'mainnet' : 'Calibration';
    return {
      isValid: false,
      error: `${trimmed} does not match the current ${networkLabel} address format`,
    };
  }

  const normalizedTwin = normalizeToEvmAddress(trimmed);

  return {
    isValid: true,
    normalizedAddress: trimmed,
    duplicateKey: normalizedTwin ? normalizedTwin.toLowerCase() : trimmed,
  };
}

export function validateRecipientRows(
  rows: RecipientInput[],
  options: RecipientValidationOptions,
): RecipientValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validRecipients: ValidatedRecipient[] = [];
  const seenRecipients = new Map<string, string>();
  const maxRecipients = options.maxRecipients ?? DEFAULT_MAX_RECIPIENTS;
  const requireAtLeastOneRecipient = options.requireAtLeastOneRecipient ?? true;
  let nonEmptyRowCount = 0;

  rows.forEach((row, index) => {
    const lineNumber = row.lineNumber ?? index + 1;
    const rowLabel = getRowLabel(options.source, lineNumber);
    const address = row.address.trim();
    const amount = row.amount.trim();

    if (!address && !amount) {
      return;
    }

    nonEmptyRowCount += 1;

    if (!address) {
      errors.push(`${rowLabel}: Address is required`);
      return;
    }

    if (!amount) {
      errors.push(`${rowLabel}: Amount is required`);
      return;
    }

    const addressValidation = validateAddress(address, options.expectedNetworkPrefix);
    if (!addressValidation.isValid || !addressValidation.normalizedAddress) {
      errors.push(`${rowLabel}: ${addressValidation.error}`);
      return;
    }

    const amountValidation = validateAmount(amount);
    if (!amountValidation.isValid || !amountValidation.normalizedAmount) {
      errors.push(`${rowLabel}: ${amountValidation.error}`);
      return;
    }

    const duplicateSource = seenRecipients.get(addressValidation.duplicateKey!);
    if (duplicateSource) {
      warnings.push(
        `${rowLabel}: ${DUPLICATE_RECIPIENT_WARNING_MARKER} ${duplicateSource}`,
      );
    } else {
      seenRecipients.set(addressValidation.duplicateKey!, rowLabel);
    }

    validRecipients.push({
      address: addressValidation.normalizedAddress,
      amount: amountValidation.normalizedAmount,
      lineNumber,
    });
  });

  if (requireAtLeastOneRecipient && nonEmptyRowCount === 0) {
    errors.push(
      options.source === 'csv'
        ? 'No recipients found in CSV file'
        : 'Add at least one recipient to continue',
    );
  }

  if (nonEmptyRowCount > maxRecipients) {
    errors.push(
      `Batch size exceeds the current limit of ${maxRecipients} recipients`,
    );
  }

  return {
    validRecipients,
    errors,
    warnings,
    nonEmptyRowCount,
  };
}

export function isDuplicateRecipientWarning(warning: string): boolean {
  return warning.includes(DUPLICATE_RECIPIENT_WARNING_MARKER);
}

export function getDuplicateRecipientWarnings(warnings: string[]): string[] {
  return warnings.filter(isDuplicateRecipientWarning);
}
