import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import {
  FILSNAP_FILECOIN_PROVIDER_METADATA,
  getNativeFilecoinSenderBalanceAttoFil,
  getNativeFilecoinWalletProviders,
} from '../nativeFilecoinProvider';
import { createNativeFilecoinConnectedSender } from '../senderModel';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

describe('native Filecoin provider boundary', () => {
  it('keeps native Filecoin providers hidden when explicitly disabled', () => {
    expect(getNativeFilecoinWalletProviders({ featureEnabled: false })).toEqual([]);
  });

  it('exposes FilSnap and Ledger as native Filecoin wallet providers by default', () => {
    const providers = getNativeFilecoinWalletProviders();

    expect(providers.map((provider) => provider.metadata.id)).toEqual([
      'filsnap-filecoin',
      'ledger-filecoin',
    ]);
    expect(providers.map((provider) => provider.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'filsnap-filecoin',
          name: 'FilSnap (Filecoin)',
          status: 'available',
          capabilities: expect.objectContaining({
            canConnect: true,
            canSignBatch: true,
            canSubmit: true,
            oneApprovalPerBatch: true,
          }),
        }),
        expect.objectContaining({
          id: 'ledger-filecoin',
          name: 'Ledger (Filecoin)',
          status: 'available',
          capabilities: expect.objectContaining({
            canConnect: true,
            canSignBatch: true,
            canSubmit: true,
            oneApprovalPerBatch: true,
          }),
        }),
      ]),
    );
  });

  it('reads native sender balances on the sender network', async () => {
    const senderResult = createNativeFilecoinConnectedSender({
      address: CALIBRATION_T1,
      provider: FILSNAP_FILECOIN_PROVIDER_METADATA,
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
