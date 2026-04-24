import {
  CoinType,
  newActorAddress,
  newBLSAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { toF4 } from '../toF4';
import {
  DUPLICATE_RECIPIENT_WARNING_MARKER,
  validateRecipientRows,
} from '../recipientValidation';

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();

const MAINNET_F2 = newActorAddress(
  Uint8Array.from([1, 2, 3, 4]),
  CoinType.MAIN,
).toString();

const MAINNET_F3 = newBLSAddress(
  Uint8Array.from({ length: 48 }, (_, index) => index + 10),
  CoinType.MAIN,
).toString();

const MAINNET_F4 = toF4(
  '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd',
  'f',
);

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

const ZERO_X_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const TWIN_ZERO_X_ADDRESS = '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd';

function makeUniqueEvmAddress(seed: number): `0x${string}` {
  return getAddress(`0x${seed.toString(16).padStart(40, '0')}`);
}

describe('INV-ADDR-001 recipient acceptance', () => {
  it('accepts valid f1, f2, f3, f4, and 0x recipients through the shared validator', () => {
    const result = validateRecipientRows(
      [
        { address: MAINNET_F1, amount: '1.25' },
        { address: MAINNET_F2, amount: '2' },
        { address: MAINNET_F3, amount: '3' },
        { address: MAINNET_F4, amount: '4' },
        { address: ZERO_X_ADDRESS, amount: '5' },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.validRecipients).toEqual([
      { address: MAINNET_F1, amount: '1.25', lineNumber: 1 },
      { address: MAINNET_F2, amount: '2', lineNumber: 2 },
      { address: MAINNET_F3, amount: '3', lineNumber: 3 },
      { address: MAINNET_F4, amount: '4', lineNumber: 4 },
      {
        address: getAddress(ZERO_X_ADDRESS),
        amount: '5',
        lineNumber: 5,
      },
    ]);
  });

  it('trims surrounding whitespace before validating supported recipients', () => {
    const result = validateRecipientRows(
      [
        {
          address: `  ${MAINNET_F1}  `,
          amount: '  1.000000000000000001  ',
        },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toEqual([
      {
        address: MAINNET_F1,
        amount: '1.000000000000000001',
        lineNumber: 1,
      },
    ]);
  });
});

describe('INV-ADDR-002 f0 rejection', () => {
  it('rejects f0 and t0 recipients as unsupported ID addresses', () => {
    const result = validateRecipientRows(
      [
        { address: 'f01234', amount: '1' },
        { address: 't01234', amount: '2' },
      ],
      { source: 'manual' },
    );

    expect(result.errors).toEqual([
      'Recipient 1: f0/t0 ID addresses are not supported',
      'Recipient 2: f0/t0 ID addresses are not supported',
    ]);
    expect(result.validRecipients).toEqual([]);
  });
});

describe('INV-ADDR-003 twin identity handling', () => {
  it('treats a 0x address and its f4 twin as the same duplicate identity', () => {
    const result = validateRecipientRows(
      [
        { address: TWIN_ZERO_X_ADDRESS, amount: '1' },
        { address: toF4(TWIN_ZERO_X_ADDRESS, 'f'), amount: '2' },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toHaveLength(2);
    expect(result.warnings).toEqual([
      `Recipient 2: ${DUPLICATE_RECIPIENT_WARNING_MARKER} Recipient 1`,
    ]);
  });

  it('treats a 0x address and its t4 twin as the same duplicate identity on Calibration', () => {
    const result = validateRecipientRows(
      [
        { address: TWIN_ZERO_X_ADDRESS, amount: '1' },
        { address: toF4(TWIN_ZERO_X_ADDRESS, 't'), amount: '2' },
      ],
      { source: 'manual', expectedNetworkPrefix: 't' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toHaveLength(2);
    expect(result.warnings).toEqual([
      `Recipient 2: ${DUPLICATE_RECIPIENT_WARNING_MARKER} Recipient 1`,
    ]);
  });
});

describe('INV-AMT-001 amount sign and presence rules', () => {
  it('rejects blank, zero, and negative amount strings', () => {
    const result = validateRecipientRows(
      [
        { address: MAINNET_F1, amount: '' },
        { address: MAINNET_F1, amount: '   ' },
        { address: MAINNET_F1, amount: '0' },
        { address: MAINNET_F1, amount: '0.0' },
        { address: MAINNET_F1, amount: '0.000000000000000000' },
        { address: MAINNET_F1, amount: '-1' },
        { address: MAINNET_F1, amount: '-0.1' },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      'Recipient 1: Amount is required',
      'Recipient 2: Amount is required',
      'Recipient 3: Amount must be greater than 0',
      'Recipient 4: Amount must be greater than 0',
      'Recipient 5: Amount must be greater than 0',
      'Recipient 6: Amount must be a positive FIL value with up to 18 decimal places',
      'Recipient 7: Amount must be a positive FIL value with up to 18 decimal places',
    ]);
    expect(result.validRecipients).toEqual([]);
  });

  it('accepts a tiny positive value at 1 attoFIL', () => {
    const result = validateRecipientRows(
      [{ address: MAINNET_F1, amount: '0.000000000000000001' }],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toEqual([
      {
        address: MAINNET_F1,
        amount: '0.000000000000000001',
        lineNumber: 1,
      },
    ]);
  });

  it('rejects malformed non-numeric amount strings', () => {
    const result = validateRecipientRows(
      [{ address: MAINNET_F1, amount: '10 FIL' }],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      'Recipient 1: Amount must be a positive FIL value with up to 18 decimal places',
    ]);
    expect(result.validRecipients).toEqual([]);
  });
});

describe('INV-AMT-002 precision rules', () => {
  it('accepts values with up to 18 decimal places', () => {
    const result = validateRecipientRows(
      [
        { address: MAINNET_F1, amount: '1' },
        { address: MAINNET_F1, amount: '1.0' },
        { address: MAINNET_F1, amount: '1.123456789012345678' },
        { address: MAINNET_F1, amount: '0.000000000000000001' },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toHaveLength(4);
  });

  it('rejects values with more than 18 decimal places', () => {
    const result = validateRecipientRows(
      [
        { address: MAINNET_F1, amount: '1.1234567890123456789' },
        { address: MAINNET_F1, amount: '0.0000000000000000001' },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      'Recipient 1: Amount must be a positive FIL value with up to 18 decimal places',
      'Recipient 2: Amount must be a positive FIL value with up to 18 decimal places',
    ]);
    expect(result.validRecipients).toEqual([]);
  });
});

describe('INV-BATCH-001 batch size cap', () => {
  it('accepts exactly 500 non-empty recipients', () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      address: makeUniqueEvmAddress(index + 1),
      amount: '1',
    }));

    const result = validateRecipientRows(rows, {
      source: 'manual',
      expectedNetworkPrefix: 'f',
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.validRecipients).toHaveLength(500);
  });

  it('rejects 501 non-empty recipients', () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      address: makeUniqueEvmAddress(index + 1),
      amount: '1',
    }));

    const result = validateRecipientRows(rows, {
      source: 'manual',
      expectedNetworkPrefix: 'f',
    });

    expect(result.errors).toContain(
      'Batch size exceeds the current limit of 500 recipients',
    );
  });

  it('ignores blank rows when enforcing the 500-recipient cap', () => {
    const rows = [
      ...Array.from({ length: 500 }, (_, index) => ({
        address: makeUniqueEvmAddress(index + 1),
        amount: '1',
      })),
      { address: '', amount: '' },
      { address: '   ', amount: '   ' },
    ];

    const result = validateRecipientRows(rows, {
      source: 'manual',
      expectedNetworkPrefix: 'f',
    });

    expect(result.errors).toEqual([]);
    expect(result.nonEmptyRowCount).toBe(500);
    expect(result.validRecipients).toHaveLength(500);
  });
});

describe('INV-DUP-001 duplicate warning behavior', () => {
  it('emits duplicate warnings for repeated 0x rows without turning them into errors', () => {
    const result = validateRecipientRows(
      [
        { address: ZERO_X_ADDRESS, amount: '1' },
        { address: ZERO_X_ADDRESS, amount: '2' },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      `Recipient 2: ${DUPLICATE_RECIPIENT_WARNING_MARKER} Recipient 1`,
    ]);
    expect(result.validRecipients).toHaveLength(2);
  });
});

describe('network-aware validation regression coverage', () => {
  it('rejects testnet prefixes in the mainnet flow', () => {
    const result = validateRecipientRows(
      [{ address: CALIBRATION_T1, amount: '1' }],
      { source: 'csv', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      `Line 1: ${CALIBRATION_T1} does not match the current mainnet address format`,
    ]);
  });

  it('accepts Calibration-native recipients in the testnet flow', () => {
    const result = validateRecipientRows(
      [
        { address: CALIBRATION_T1, amount: '1' },
        { address: toF4(TWIN_ZERO_X_ADDRESS, 't'), amount: '2' },
      ],
      { source: 'manual', expectedNetworkPrefix: 't' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toHaveLength(2);
  });

  it('blocks mixed mainnet and Calibration native prefixes while disconnected', () => {
    const result = validateRecipientRows(
      [
        { address: MAINNET_F1, amount: '1' },
        { address: CALIBRATION_T1, amount: '2' },
      ],
      { source: 'manual' },
    );

    expect(result.errors).toContain(
      'Batch mixes mainnet (f...) and Calibration (t...) native addresses. Keep all native recipients on one network before review.',
    );
  });
});
