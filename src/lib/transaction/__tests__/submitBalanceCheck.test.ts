import { describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';
import { getNetworkConfig } from '../../networks';
import {
  createSubmitBalanceCheckError,
  recheckSubmitBalance,
  type SubmitBalanceSender,
} from '../submitBalanceCheck';

const EVM_SENDER = {
  kind: 'evm',
  address: getAddress('0x9999999999999999999999999999999999999999'),
  chainId: 314,
} satisfies SubmitBalanceSender;

describe('submit-time balance recheck helper', () => {
  it('allows EVM submission when balance covers transfers and estimated network fee', async () => {
    const network = getNetworkConfig('mainnet');
    const readEvmBalance = vi.fn().mockResolvedValue(111n);

    const result = await recheckSubmitBalance({
      sender: EVM_SENDER,
      network,
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
      readEvmBalance,
    });

    expect(result).toEqual({
      ok: true,
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
      requiredAttoFil: 111n,
      availableAttoFil: 111n,
    });
    expect(readEvmBalance).toHaveBeenCalledWith({
      address: EVM_SENDER.address,
      chainId: 314,
    });
  });

  it('blocks EVM submission when balance no longer covers transfers and estimated network fee', async () => {
    const result = await recheckSubmitBalance({
      sender: EVM_SENDER,
      network: getNetworkConfig('mainnet'),
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
      readEvmBalance: vi.fn().mockResolvedValue(110n),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_BALANCE',
      requiredAttoFil: 111n,
      availableAttoFil: 110n,
    });

    if (!result.ok) {
      expect(createSubmitBalanceCheckError(result, 'PARTIAL').message).toBe(
        'Balance changed. Please review again.',
      );
    }
  });

  it('treats unsupported networks as blocking before balance reads', async () => {
    const readEvmBalance = vi.fn().mockResolvedValue(111n);

    const result = await recheckSubmitBalance({
      sender: EVM_SENDER,
      network: undefined,
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
      readEvmBalance,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_NETWORK',
    });
    expect(readEvmBalance).not.toHaveBeenCalled();
  });

  it('returns an explicit not-implemented path for native Filecoin senders', async () => {
    const result = await recheckSubmitBalance({
      sender: {
        kind: 'native',
        address: 'f1sender',
        networkKey: 'mainnet',
      },
      network: getNetworkConfig('mainnet'),
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_SENDER',
    });
  });

  it('allows native Filecoin submission when the sender network balance covers the batch', async () => {
    const readNativeBalance = vi.fn().mockResolvedValue(111n);

    const result = await recheckSubmitBalance({
      sender: {
        kind: 'native',
        address: 't1sender',
        networkKey: 'calibration',
      },
      network: getNetworkConfig('calibration'),
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
      readNativeBalance,
    });

    expect(result).toMatchObject({
      ok: true,
      requiredAttoFil: 111n,
      availableAttoFil: 111n,
    });
    expect(readNativeBalance).toHaveBeenCalledWith({
      address: 't1sender',
      networkKey: 'calibration',
    });
  });

  it('blocks native Filecoin balance reads on mismatched networks', async () => {
    const readNativeBalance = vi.fn().mockResolvedValue(111n);

    const result = await recheckSubmitBalance({
      sender: {
        kind: 'native',
        address: 'f1sender',
        networkKey: 'mainnet',
      },
      network: getNetworkConfig('calibration'),
      transferTotalAttoFil: 101n,
      estimatedNetworkFeeAttoFil: 10n,
      readNativeBalance,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_NETWORK',
    });
    expect(readNativeBalance).not.toHaveBeenCalled();
  });
});
