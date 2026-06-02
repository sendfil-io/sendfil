import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { Buffer as NodeBuffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  FILSNAP_FILECOIN_PROVIDER_METADATA,
  LEDGER_FILECOIN_PROVIDER_METADATA,
  ensureBrowserBuffer,
  formatNativeFilecoinWalletErrorMessage,
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

  it('installs Buffer for Ledger browser transports when it is missing', async () => {
    const browserGlobal = globalThis as unknown as {
      Buffer?: typeof NodeBuffer;
    };
    const originalBuffer = browserGlobal.Buffer;

    try {
      delete browserGlobal.Buffer;

      await ensureBrowserBuffer();

      const installedBuffer = (globalThis as unknown as {
        Buffer?: typeof NodeBuffer;
      }).Buffer;

      expect(installedBuffer?.from('ledger').toString()).toBe('ledger');
    } finally {
      browserGlobal.Buffer = originalBuffer;
    }
  });

  it('formats Ledger browser transport errors as connection guidance', () => {
    expect(
      formatNativeFilecoinWalletErrorMessage(
        LEDGER_FILECOIN_PROVIDER_METADATA,
        new Error('Buffer is not defined'),
      ),
    ).toBe('Ledger connection could not start. Refresh SendFIL and try again.');

    expect(
      formatNativeFilecoinWalletErrorMessage(
        LEDGER_FILECOIN_PROVIDER_METADATA,
        new Error('Access denied to use Ledger device'),
      ),
    ).toBe(
      'Ledger connection was cancelled or blocked. Unlock your Ledger, open the Filecoin app, choose it in the browser USB prompt, and approve the connection.',
    );
  });

  it('formats FilSnap provider errors as MetaMask Snap guidance', () => {
    expect(
      formatNativeFilecoinWalletErrorMessage(
        FILSNAP_FILECOIN_PROVIDER_METADATA,
        new Error('MetaMask provider not found'),
      ),
    ).toBe(
      'FilSnap needs MetaMask with the FilSnap Snap installed. Open MetaMask, install or enable FilSnap, then try again.',
    );
  });
});
