import { Buffer } from 'buffer';
import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import type { FilecoinMessage } from '../../DataProvider/types';
import {
  createLedgerFilecoinCalibrationProvider,
  createLedgerFilecoinPath,
  serializeLedgerFilecoinTransaction,
  type LedgerFilecoinRuntime,
} from '../ledgerFilecoinProvider';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 70),
  CoinType.TEST,
).toString();

const SECOND_CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 90),
  CoinType.TEST,
).toString();

const MAINNET_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 5),
  CoinType.MAIN,
).toString();

const NATIVE_BATCH_MESSAGE: FilecoinMessage = {
  Version: 0,
  To: 't410f2lpnnzscfg4zbfo5verki2as6tpsrmb6m4a2lby',
  From: CALIBRATION_T1,
  Nonce: 42,
  Value: '1000000000000000000',
  GasLimit: 345678,
  GasFeeCap: '101',
  GasPremium: '11',
  Method: 3844450837,
  Params: 'RA==',
};

function createMockLedgerRuntime({
  address = CALIBRATION_T1,
  serializedHex = '01020304',
  signature = Uint8Array.from([1, 2, 3, 4, 5]),
}: {
  address?: string;
  serializedHex?: string;
  signature?: Uint8Array;
} = {}) {
  const transport = {
    close: vi.fn(async () => undefined),
  };
  const app = {
    getAddressAndPubKey: vi.fn(async () => ({ addrString: address })),
    showAddressAndPubKey: vi.fn(async () => ({ addrString: address })),
    sign: vi.fn(async () => ({
      signature_compact: signature,
    })),
  };
  const runtime: LedgerFilecoinRuntime = {
    createTransport: vi.fn(async () => transport),
    createApp: vi.fn(() => app),
    serializeTransaction: vi.fn(() => serializedHex),
    bufferFromHex: vi.fn((hex: string) => Buffer.from(hex, 'hex')),
    bytesToBase64: vi.fn((bytes: Uint8Array) =>
      Buffer.from(bytes).toString('base64'),
    ),
  };

  return { runtime, transport, app, signature };
}

describe('Ledger Filecoin Calibration provider', () => {
  it('serializes the exact Zondax transaction tuple Ledger signs', () => {
    let encodedValue: unknown;

    const serialized = serializeLedgerFilecoinTransaction(
      {
        To: 't410receiver',
        From: 't1sender',
        Nonce: 2,
        Value: '256',
        GasLimit: 3000,
        GasFeeCap: '0',
        GasPremium: '15',
        Method: 3844450837,
        Params: 'RA==',
      },
      {
        addressToBytes: (address) =>
          address === 't410receiver'
            ? Uint8Array.from([4, 10])
            : Uint8Array.from([1, 20]),
        base64ToBytes: () => Uint8Array.from([68]),
        encodeDagCbor: (value) => {
          encodedValue = value;
          return Uint8Array.from([0xaa, 0xbb]);
        },
        bytesToHex: (bytes) => Buffer.from(bytes).toString('hex'),
      },
    );

    expect(serialized).toBe('aabb');
    expect(encodedValue).toEqual([
      0,
      Uint8Array.from([4, 10]),
      Uint8Array.from([1, 20]),
      2,
      Uint8Array.from([0, 1, 0]),
      3000,
      Uint8Array.from([]),
      Uint8Array.from([0, 15]),
      3844450837,
      Uint8Array.from([68]),
    ]);
  });

  it('uses the Calibration Filecoin BIP44 path', () => {
    expect(createLedgerFilecoinPath()).toBe("m/44'/1'/0'/0/0");
    expect(createLedgerFilecoinPath(3)).toBe("m/44'/1'/0'/0/3");
    expect(() => createLedgerFilecoinPath(-1)).toThrow(
      'account index must be a non-negative integer',
    );
  });

  it('is disabled when WebHID is not available', async () => {
    const { runtime } = createMockLedgerRuntime();
    const provider = createLedgerFilecoinCalibrationProvider({
      isWebHidAvailable: () => false,
      loadRuntime: async () => runtime,
    });

    expect(provider.metadata).toMatchObject({
      id: 'ledger-filecoin-calibration',
      status: 'disabled',
      capabilities: {
        canConnect: false,
        canSignBatch: false,
        canSubmit: false,
        oneApprovalPerBatch: true,
      },
    });
    await expect(provider.connect()).rejects.toThrow(
      'Ledger Filecoin Calibration sends require a Chromium browser with WebHID',
    );
  });

  it('connects one confirmed Calibration t1 account from the configured Ledger path', async () => {
    const { runtime, app } = createMockLedgerRuntime();
    const provider = createLedgerFilecoinCalibrationProvider({
      accountIndex: 2,
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
    });

    const account = await provider.connect();

    expect(account).toEqual({
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(app.showAddressAndPubKey).toHaveBeenCalledWith("m/44'/1'/0'/0/2");
    expect(app.getAddressAndPubKey).not.toHaveBeenCalled();
  });

  it('can skip on-device address display only when explicitly configured', async () => {
    const { runtime, app } = createMockLedgerRuntime();
    const provider = createLedgerFilecoinCalibrationProvider({
      confirmAddressOnConnect: false,
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
    });

    await provider.connect();

    expect(app.getAddressAndPubKey).toHaveBeenCalledWith("m/44'/1'/0'/0/0");
    expect(app.showAddressAndPubKey).not.toHaveBeenCalled();
  });

  it('rejects a Ledger account that is not a Calibration t1 address', async () => {
    const { runtime } = createMockLedgerRuntime({ address: MAINNET_F1 });
    const provider = createLedgerFilecoinCalibrationProvider({
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
    });

    await expect(provider.connect()).rejects.toThrow(
      'does not match the current Calibration Testnet sender network',
    );
  });

  it('serializes, signs, and submits one native batch message through Ledger', async () => {
    const { runtime, app, signature } = createMockLedgerRuntime();
    const submitSignedMessage = vi.fn(async () => ({
      '/': 'bafy2bzacedledgercid',
    }));
    const provider = createLedgerFilecoinCalibrationProvider({
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
      submitSignedMessage,
    });

    await provider.connect();
    const result = await provider.signAndSubmitMessage!(NATIVE_BATCH_MESSAGE);

    expect(result).toEqual({ cid: 'bafy2bzacedledgercid' });
    expect(runtime.serializeTransaction).toHaveBeenCalledWith({
      To: NATIVE_BATCH_MESSAGE.To,
      From: NATIVE_BATCH_MESSAGE.From,
      Nonce: NATIVE_BATCH_MESSAGE.Nonce,
      Value: NATIVE_BATCH_MESSAGE.Value,
      GasLimit: NATIVE_BATCH_MESSAGE.GasLimit,
      GasFeeCap: NATIVE_BATCH_MESSAGE.GasFeeCap,
      GasPremium: NATIVE_BATCH_MESSAGE.GasPremium,
      Method: NATIVE_BATCH_MESSAGE.Method,
      Params: NATIVE_BATCH_MESSAGE.Params,
    });
    expect(runtime.bufferFromHex).toHaveBeenCalledWith('01020304');
    expect(app.sign).toHaveBeenCalledWith(
      "m/44'/1'/0'/0/0",
      Buffer.from('01020304', 'hex'),
    );
    expect(submitSignedMessage).toHaveBeenCalledWith(
      {
        Message: NATIVE_BATCH_MESSAGE,
        Signature: {
          Type: 1,
          Data: Buffer.from(signature).toString('base64'),
        },
      },
      'calibration',
    );
  });

  it('refuses to sign if the reviewed sender differs from the connected Ledger account', async () => {
    const { runtime } = createMockLedgerRuntime();
    const submitSignedMessage = vi.fn(async () => ({
      '/': 'bafy2bzacedledgercid',
    }));
    const provider = createLedgerFilecoinCalibrationProvider({
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
      submitSignedMessage,
    });

    await provider.connect();
    await expect(
      provider.signAndSubmitMessage!({
        ...NATIVE_BATCH_MESSAGE,
        From: SECOND_CALIBRATION_T1,
      }),
    ).rejects.toThrow('reviewed sender no longer matches');
    expect(submitSignedMessage).not.toHaveBeenCalled();
  });

  it('reads Ledger balances from the Calibration Lotus lane', async () => {
    const { runtime } = createMockLedgerRuntime();
    const readBalance = vi.fn(async () => '9000');
    const provider = createLedgerFilecoinCalibrationProvider({
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
      readBalance,
    });
    const account = await provider.connect();

    const balance = await provider.getBalance(account);

    expect(balance).toBe(9000n);
    expect(readBalance).toHaveBeenCalledWith(CALIBRATION_T1, 'calibration');
  });

  it('maps common Ledger device failures to actionable messages', async () => {
    const { runtime, app } = createMockLedgerRuntime();
    app.showAddressAndPubKey.mockRejectedValueOnce(
      new Error('TransportError: transaction rejected'),
    );
    const provider = createLedgerFilecoinCalibrationProvider({
      isWebHidAvailable: () => true,
      loadRuntime: async () => runtime,
    });

    await expect(provider.connect()).rejects.toThrow(
      'Ledger signing was rejected on the device',
    );
  });
});
