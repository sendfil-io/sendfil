import { describe, expect, it, vi } from 'vitest';
import { CoinType, newActorAddress } from '@glif/filecoin-address';
import { getAddress } from 'viem';
import { toF4 } from '../toF4';
import { validateNoEvmContractRecipients } from '../contractRecipientGuard';

const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const NATIVE_ADDRESS = 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za';
const NATIVE_ACTOR_ADDRESS = newActorAddress(
  Uint8Array.from([1, 2, 3, 4]),
  CoinType.MAIN,
).toString();

describe('validateNoEvmContractRecipients', () => {
  it('skips native Filecoin recipients', async () => {
    const getCode = vi.fn();

    const errors = await validateNoEvmContractRecipients(
      [{ address: NATIVE_ADDRESS }, { address: NATIVE_ACTOR_ADDRESS }],
      { getCode },
    );

    expect(errors).toEqual([]);
    expect(getCode).not.toHaveBeenCalled();
  });

  it('allows EVM recipients with empty code', async () => {
    const getCode = vi.fn().mockResolvedValue('0x');

    const errors = await validateNoEvmContractRecipients(
      [{ address: EVM_ADDRESS }],
      { getCode },
    );

    expect(errors).toEqual([]);
    expect(getCode).toHaveBeenCalledWith({ address: getAddress(EVM_ADDRESS) });
  });

  it('normalizes f4 twins before checking deployed code', async () => {
    const getCode = vi.fn().mockResolvedValue('0x60016000');
    const f4Address = toF4(EVM_ADDRESS, 'f');

    const errors = await validateNoEvmContractRecipients(
      [
        { address: EVM_ADDRESS },
        { address: f4Address },
      ],
      { getCode },
    );

    expect(getCode).toHaveBeenCalledTimes(1);
    expect(getCode).toHaveBeenCalledWith({ address: getAddress(EVM_ADDRESS) });
    expect(errors).toEqual([
      `EVM contract recipients are not supported: ${EVM_ADDRESS}, ${f4Address} (${getAddress(EVM_ADDRESS)}).`,
    ]);
  });

  it('fails closed when EVM recipient code cannot be checked', async () => {
    const getCode = vi.fn().mockRejectedValue(new Error('RPC unavailable'));

    await expect(
      validateNoEvmContractRecipients([{ address: EVM_ADDRESS }], { getCode }),
    ).resolves.toEqual([
      'Could not verify EVM recipients for deployed contract code: RPC unavailable',
    ]);
  });
});
