import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import {
  getNativeFilecoinSenderBalanceAttoFil,
  getNativeFilecoinWalletProviders,
  NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
} from '../nativeFilecoinProvider';
import { createNativeFilecoinConnectedSender } from '../senderModel';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

describe('native Filecoin provider boundary', () => {
  it('keeps native Filecoin providers hidden while the feature flag is disabled', () => {
    expect(getNativeFilecoinWalletProviders({ featureEnabled: false })).toEqual([]);
  });

  it('exposes only an unsupported placeholder when the feature flag is enabled', async () => {
    const [provider] = getNativeFilecoinWalletProviders({ featureEnabled: true });

    expect(provider.metadata).toMatchObject({
      id: 'native-filecoin-placeholder',
      kind: 'native-filecoin-wallet',
      status: 'planned',
      capabilities: {
        canConnect: false,
        canSignBatch: false,
        canSubmit: false,
        oneApprovalPerBatch: true,
      },
    });
    await expect(provider.connect()).rejects.toThrow(
      'Native Filecoin wallet signing is scaffolded',
    );
  });

  it('reads native sender balances on the sender network', async () => {
    const senderResult = createNativeFilecoinConnectedSender({
      address: CALIBRATION_T1,
      provider: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
    });
    const readBalance = vi.fn(async () => '123');

    expect(senderResult.sender).toBeDefined();

    const balance = await getNativeFilecoinSenderBalanceAttoFil(
      senderResult.sender!,
      readBalance,
    );

    expect(balance).toBe(123n);
    expect(readBalance).toHaveBeenCalledWith(CALIBRATION_T1, 'calibration');
  });
});
