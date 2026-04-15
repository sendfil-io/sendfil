import { describe, expect, it } from 'vitest';
import { validateRecipientRows } from '../recipientValidation';
import { toF4 } from '../toF4';

describe('validateRecipientRows', () => {
  it('accepts supported mainnet address types including 0x recipients', () => {
    const result = validateRecipientRows(
      [
        {
          address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
          amount: '1.25',
        },
        {
          address: 'f410fdjztlgqlzfda5hm6bm6z5gt3aglxcfsu24pgrsi',
          amount: '2',
        },
        {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '0.5',
        },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.validRecipients).toHaveLength(3);
    expect(result.validRecipients[2]?.address).toBe(
      '0x1234567890AbcdEF1234567890aBcdef12345678',
    );
  });

  it('rejects f0 recipients', () => {
    const result = validateRecipientRows(
      [{ address: 'f01234', amount: '1' }],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      'Recipient 1: f0/t0 ID addresses are not supported',
    ]);
  });

  it('rejects testnet prefixes in the mainnet flow', () => {
    const result = validateRecipientRows(
      [
        {
          address: 't1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
          amount: '1',
        },
      ],
      { source: 'csv', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      'Line 1: t1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za does not match the current mainnet address format',
    ]);
  });

  it('warns when duplicate recipients resolve to the same EVM destination', () => {
    const result = validateRecipientRows(
      [
        {
          address: '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd',
          amount: '1',
        },
        {
          address: toF4('0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd', 'f'),
          amount: '2',
        },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      'Recipient 2: Duplicate recipient matches Recipient 1',
    ]);
  });

  it('rejects malformed amounts and values over 18 decimals', () => {
    const result = validateRecipientRows(
      [
        {
          address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
          amount: '1.1234567890123456789',
        },
        {
          address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
          amount: '10 FIL',
        },
      ],
      { source: 'manual', expectedNetworkPrefix: 'f' },
    );

    expect(result.errors).toEqual([
      'Recipient 1: Amount must be a positive FIL value with up to 18 decimal places',
      'Recipient 2: Amount must be a positive FIL value with up to 18 decimal places',
    ]);
  });

  it('enforces the 500 recipient cap', () => {
    const rows = Array.from({ length: 501 }, () => ({
      address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
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
});
