import { describe, it, expect } from 'vitest';
import { toF4 } from '../toF4';

describe('toF4', () => {
  it('should convert EVM address to f4 address on mainnet', () => {
    const ethAddress = '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd' as `0x${string}`;
    const f4Address = toF4(ethAddress, 'f');
    
    // The f4 address should start with 'f4' and be longer than the original
    expect(f4Address).toMatch(/^f4/);
    expect(f4Address.length).toBeGreaterThan(ethAddress.length);
    
    // Should be a valid f4 address format (f4 + number + base32 chars)
    expect(f4Address).toMatch(/^f4[0-9]+[a-z2-7]+$/);
  });

  it('should convert EVM address to t4 address on testnet', () => {
    const ethAddress = '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd' as `0x${string}`;
    const t4Address = toF4(ethAddress, 't');
    
    // The t4 address should start with 't4' for testnet
    expect(t4Address).toMatch(/^t4/);
    expect(t4Address.length).toBeGreaterThan(ethAddress.length);
    
    // Should be a valid t4 address format
    expect(t4Address).toMatch(/^t4[0-9]+[a-z2-7]+$/);
  });

  it('should default to mainnet (f) when network not specified', () => {
    const ethAddress = '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd' as `0x${string}`;
    const f4Address = toF4(ethAddress);
    
    expect(f4Address).toMatch(/^f4/);
  });

  it('should handle different valid EVM addresses consistently', () => {
    const addresses = [
      '0x742d35Cc6634C0532925a3b8D24e3B9d8e6e3c8e' as `0x${string}`,
      '0x1234567890123456789012345678901234567890' as `0x${string}`,
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
    ];

    addresses.forEach(addr => {
      const f4Addr = toF4(addr, 'f');
      expect(f4Addr).toMatch(/^f4/);
      expect(f4Addr.length).toBeGreaterThan(addr.length);
      expect(f4Addr).toMatch(/^f4[0-9]+[a-z2-7]+$/);
    });
  });

  it('should produce consistent results for the same address', () => {
    const ethAddress = '0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd' as `0x${string}`;
    const f4Address1 = toF4(ethAddress, 'f');
    const f4Address2 = toF4(ethAddress, 'f');
    
    expect(f4Address1).toBe(f4Address2);
  });
});
