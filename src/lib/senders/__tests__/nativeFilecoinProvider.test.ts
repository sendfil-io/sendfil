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

function createStatusError(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

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

  it('prepares Ledger transport modules before the browser device prompt path', () => {
    const providers = getNativeFilecoinWalletProviders();
    const filsnapProvider = providers.find(
      (provider) => provider.metadata.id === 'filsnap-filecoin',
    );
    const ledgerProvider = providers.find(
      (provider) => provider.metadata.id === 'ledger-filecoin',
    );

    expect(filsnapProvider?.prepareConnect).toBeUndefined();
    expect(ledgerProvider?.prepareConnect).toEqual(expect.any(Function));
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
      'Ledger connection was cancelled or blocked. Unlock your Ledger, open the Filecoin app, choose it in the browser device prompt, and approve the connection.',
    );
  });

  it('formats Ledger signing rejection separately from connection failures', () => {
    expect(
      formatNativeFilecoinWalletErrorMessage(
        LEDGER_FILECOIN_PROVIDER_METADATA,
        createStatusError('Filecoin App: Command rejected (0x6986)', 0x6986),
        'sign',
      ),
    ).toBe(
      'Ledger signature request was rejected on the device. No Filecoin message was submitted.',
    );

    expect(
      formatNativeFilecoinWalletErrorMessage(
        LEDGER_FILECOIN_PROVIDER_METADATA,
        createStatusError('Filecoin App: Data is invalid (0x6984)', 0x6984),
        'sign',
      ),
    ).toBe(
      'The Ledger Filecoin app rejected the message data before signing. Confirm the app is up to date, then try again. No Filecoin message was submitted.',
    );

    expect(
      formatNativeFilecoinWalletErrorMessage(
        LEDGER_FILECOIN_PROVIDER_METADATA,
        createStatusError('Filecoin App: Bad key handle (0x6a80)', 0x6a80),
        'sign',
      ),
    ).toBe(
      'Ledger could not use the selected Filecoin account key. Reconnect the Ledger account, verify the Filecoin app is open and up to date, then try again.',
    );

    expect(
      formatNativeFilecoinWalletErrorMessage(
        LEDGER_FILECOIN_PROVIDER_METADATA,
        createStatusError('Filecoin App: Filecoin app not open (0x6e01)', 0x6e01),
        'sign',
      ),
    ).toBe(
      'Open the Filecoin app on your Ledger, then retry the signature. No Filecoin message was submitted.',
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

  it('formats FilSnap signing rejection and locked-wallet errors accurately', () => {
    expect(
      formatNativeFilecoinWalletErrorMessage(
        FILSNAP_FILECOIN_PROVIDER_METADATA,
        new Error('MetaMask user rejected the request'),
        'sign',
      ),
    ).toBe(
      'FilSnap signature request was rejected in MetaMask. No Filecoin message was submitted.',
    );

    expect(
      formatNativeFilecoinWalletErrorMessage(
        FILSNAP_FILECOIN_PROVIDER_METADATA,
        new Error('Request cancelled'),
        'sign',
      ),
    ).toBe(
      'FilSnap signature request was rejected in MetaMask. No Filecoin message was submitted.',
    );

    expect(
      formatNativeFilecoinWalletErrorMessage(
        FILSNAP_FILECOIN_PROVIDER_METADATA,
        new Error('MetaMask is locked'),
        'sign',
      ),
    ).toBe(
      'FilSnap could not sign the Filecoin message. Unlock MetaMask, make sure FilSnap is enabled, and try again.',
    );
  });
});
