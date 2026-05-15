import type { FilecoinMessage, SignedMessage } from '../DataProvider/types';
import { getBalance, submitTransaction } from '../DataProvider';
import { createNativeFilecoinConnectedSender } from './senderModel';
import type {
  NativeFilecoinAccount,
  NativeFilecoinSendResult,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from './types';

export interface LedgerFilecoinAddressResponse {
  addrString: string;
}

export interface LedgerFilecoinSignResponse {
  signature_compact: Uint8Array;
}

export interface LedgerFilecoinTransport {
  close?: () => Promise<void>;
}

export interface LedgerFilecoinApp {
  getAddressAndPubKey: (path: string) => Promise<LedgerFilecoinAddressResponse>;
  showAddressAndPubKey: (path: string) => Promise<LedgerFilecoinAddressResponse>;
  sign: (
    path: string,
    serializedMessage: Uint8Array,
  ) => Promise<LedgerFilecoinSignResponse>;
}

export interface LedgerFilecoinRuntime {
  createTransport: () => Promise<LedgerFilecoinTransport>;
  createApp: (transport: LedgerFilecoinTransport) => LedgerFilecoinApp;
  serializeTransaction: (message: LedgerFilecoinTransactionRaw) => string;
  bufferFromHex: (hex: string) => Uint8Array;
  bytesToBase64: (bytes: Uint8Array) => string;
}

export interface LedgerFilecoinTransactionRaw {
  To: string;
  From: string;
  Nonce: number;
  Value: string;
  GasLimit: number;
  GasFeeCap: string;
  GasPremium: string;
  Method: number;
  Params: string;
}

export interface CreateLedgerFilecoinCalibrationProviderOptions {
  accountIndex?: number;
  confirmAddressOnConnect?: boolean;
  isWebHidAvailable?: () => boolean;
  loadRuntime?: () => Promise<LedgerFilecoinRuntime>;
  readBalance?: (address: string, networkKey: 'calibration') => Promise<string>;
  submitSignedMessage?: (
    message: SignedMessage,
    networkKey: 'calibration',
  ) => Promise<{ '/': string }>;
}

interface LedgerSerializationRuntime {
  addressToBytes: (address: string) => Uint8Array;
  base64ToBytes: (base64: string) => Uint8Array;
  encodeDagCbor: (value: unknown) => Uint8Array;
  bytesToHex: (bytes: Uint8Array) => string;
}

const LEDGER_CALIBRATION_COIN_TYPE = 1;
const LEDGER_SECP256K1_SIGNATURE_TYPE = 1;
const DEFAULT_ACCOUNT_INDEX = 0;

const LEDGER_CALIBRATION_UNAVAILABLE_REASON =
  'Ledger Filecoin Calibration sends require a Chromium browser with WebHID, a connected Ledger, and the Filecoin app open. This testnet path is not hardware-verified in CI.';

function getBrowserWebHidAvailability(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return false;
  }

  return typeof Reflect.get(navigator, 'hid') === 'object';
}

export function createLedgerFilecoinPath(accountIndex = DEFAULT_ACCOUNT_INDEX): string {
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
    throw new Error('Ledger Filecoin account index must be a non-negative integer.');
  }

  return `m/44'/${LEDGER_CALIBRATION_COIN_TYPE}'/0'/0/${accountIndex}`;
}

function assertUnsignedDecimal(value: string, fieldName: string): void {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be a non-negative decimal string.`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function serializeBigNum(value: string, fieldName: string): Uint8Array {
  assertUnsignedDecimal(value, fieldName);

  if (value === '0') {
    return new Uint8Array();
  }

  const bytes = hexToBytes(BigInt(value).toString(16));
  const withPositiveSign = new Uint8Array(bytes.length + 1);
  withPositiveSign[0] = 0;
  withPositiveSign.set(bytes, 1);
  return withPositiveSign;
}

export function serializeLedgerFilecoinTransaction(
  message: LedgerFilecoinTransactionRaw,
  runtime: LedgerSerializationRuntime,
): string {
  const encoded = runtime.encodeDagCbor([
    0,
    runtime.addressToBytes(message.To),
    runtime.addressToBytes(message.From),
    message.Nonce,
    serializeBigNum(message.Value, 'Value'),
    message.GasLimit,
    serializeBigNum(message.GasFeeCap, 'GasFeeCap'),
    serializeBigNum(message.GasPremium, 'GasPremium'),
    message.Method,
    runtime.base64ToBytes(message.Params),
  ]);

  return runtime.bytesToHex(encoded);
}

function createLedgerMetadata(
  isAvailable: boolean,
): SenderProviderMetadata & { kind: 'native-filecoin-wallet' } {
  return {
    id: 'ledger-filecoin-calibration',
    name: 'Ledger Calibration',
    kind: 'native-filecoin-wallet',
    status: isAvailable ? 'available' : 'disabled',
    notice: isAvailable
      ? 'Ledger Calibration support is a hardware-wallet test path. Verify the on-device prompt carefully before approving.'
      : undefined,
    unavailableReason: isAvailable ? undefined : LEDGER_CALIBRATION_UNAVAILABLE_REASON,
    capabilities: {
      canConnect: isAvailable,
      canDisconnect: true,
      canDetectNetwork: true,
      canReadBalance: true,
      canSignBatch: isAvailable,
      canSubmit: isAvailable,
      oneApprovalPerBatch: true,
    },
  };
}

async function loadDefaultLedgerRuntime(): Promise<LedgerFilecoinRuntime> {
  const { Buffer: BrowserBuffer } = await import('buffer/');

  if (typeof Reflect.get(globalThis, 'Buffer') === 'undefined') {
    Reflect.set(globalThis, 'Buffer', BrowserBuffer);
  }

  const transportModule = await import('@ledgerhq/hw-transport-webhid');
  const ledgerModule = await import('@zondax/ledger-filecoin');
  const addressModule = await import('@glif/filecoin-address');
  const dagCbor = await import('@ipld/dag-cbor');

  return {
    createTransport: () => transportModule.default.request(),
    createApp: (transport) => {
      const filecoinApp = new ledgerModule.FilecoinApp(transport as never);

      return {
        getAddressAndPubKey: (path) => filecoinApp.getAddressAndPubKey(path),
        showAddressAndPubKey: (path) => filecoinApp.showAddressAndPubKey(path),
        sign: (path, serializedMessage) =>
          filecoinApp.sign(
            path,
            BrowserBuffer.from(serializedMessage) as never,
          ),
      };
    },
    serializeTransaction: (message) =>
      serializeLedgerFilecoinTransaction(message, {
        addressToBytes: (address) => addressModule.newFromString(address).bytes,
        base64ToBytes: (base64) => BrowserBuffer.from(base64, 'base64'),
        encodeDagCbor: dagCbor.encode,
        bytesToHex: (bytes) => BrowserBuffer.from(bytes).toString('hex'),
      }),
    bufferFromHex: (hex) => BrowserBuffer.from(hex, 'hex'),
    bytesToBase64: (bytes) => BrowserBuffer.from(bytes).toString('base64'),
  };
}

function normalizeLedgerErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown Ledger error';
  const message = rawMessage.toLowerCase();

  if (
    message.includes('no device selected') ||
    message.includes('access denied') ||
    message.includes('denied by user') ||
    message.includes('permission')
  ) {
    return 'Ledger connection permission was not granted. Reconnect the device and approve the browser prompt when you are ready.';
  }

  if (
    message.includes('app does not seem to be open') ||
    message.includes('28161') ||
    message.includes('0x6e00') ||
    message.includes('invalid channel')
  ) {
    return 'Open the Filecoin app on your Ledger, unlock the device, then try again.';
  }

  if (
    message.includes('transaction rejected') ||
    message.includes('condition of use not satisfied') ||
    message.includes('0x6985')
  ) {
    return 'Ledger signing was rejected on the device.';
  }

  if (
    message.includes('unable to claim interface') ||
    message.includes('failed to open the device') ||
    message.includes('device is already open')
  ) {
    return 'Ledger is already in use by another browser tab or app. Close the other session, reconnect the device, and try again.';
  }

  return `Ledger Filecoin operation failed: ${rawMessage}`;
}

function toLedgerTransactionRaw(message: FilecoinMessage): LedgerFilecoinTransactionRaw {
  return {
    To: message.To,
    From: message.From,
    Nonce: message.Nonce,
    Value: message.Value,
    GasLimit: message.GasLimit,
    GasFeeCap: message.GasFeeCap,
    GasPremium: message.GasPremium,
    Method: message.Method,
    Params: message.Params ?? '',
  };
}

function normalizeCalibrationAccount(
  address: string,
  metadata: SenderProviderMetadata,
): NativeFilecoinAccount {
  const result = createNativeFilecoinConnectedSender({
    address,
    provider: metadata,
    expectedNetworkKey: 'calibration',
  });

  if (!result.sender) {
    throw new Error(
      result.error ??
        'Ledger did not return a supported Calibration t1 account for the configured path.',
    );
  }

  return {
    address: result.sender.address,
    networkKey: result.sender.networkKey,
    nativePrefix: result.sender.nativePrefix,
  };
}

function getSubmittedCid(result: { '/': string }): string {
  if (typeof result['/'] !== 'string' || result['/'].length === 0) {
    throw new Error('Lotus did not return a message CID after Ledger submit.');
  }

  return result['/'];
}

export function createLedgerFilecoinCalibrationProvider({
  accountIndex = DEFAULT_ACCOUNT_INDEX,
  confirmAddressOnConnect = true,
  isWebHidAvailable = getBrowserWebHidAvailability,
  loadRuntime = loadDefaultLedgerRuntime,
  readBalance = getBalance,
  submitSignedMessage = submitTransaction,
}: CreateLedgerFilecoinCalibrationProviderOptions = {}): NativeFilecoinWalletProvider {
  const derivationPath = createLedgerFilecoinPath(accountIndex);
  const metadata = createLedgerMetadata(isWebHidAvailable());
  let runtime: LedgerFilecoinRuntime | undefined;
  let transport: LedgerFilecoinTransport | undefined;
  let app: LedgerFilecoinApp | undefined;
  let account: NativeFilecoinAccount | null = null;
  let isBusy = false;

  async function getRuntime(): Promise<LedgerFilecoinRuntime> {
    runtime ??= await loadRuntime();
    return runtime;
  }

  async function closeTransport(): Promise<void> {
    await transport?.close?.();
    transport = undefined;
    app = undefined;
  }

  async function withLedgerDevice<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (isBusy) {
      throw new Error(
        'Ledger is already processing a Filecoin request. Finish the current device prompt before trying again.',
      );
    }

    isBusy = true;

    try {
      return await operation();
    } catch (error) {
      throw new Error(normalizeLedgerErrorMessage(error));
    } finally {
      isBusy = false;
    }
  }

  async function getConnectedApp(): Promise<LedgerFilecoinApp> {
    if (app) {
      return app;
    }

    const loadedRuntime = await getRuntime();
    transport = await loadedRuntime.createTransport();
    app = loadedRuntime.createApp(transport);
    return app;
  }

  return {
    metadata,
    async connect() {
      if (!metadata.capabilities.canConnect) {
        throw new Error(LEDGER_CALIBRATION_UNAVAILABLE_REASON);
      }

      return withLedgerDevice(async () => {
        const ledger = await getConnectedApp();
        const addressResponse = confirmAddressOnConnect
          ? await ledger.showAddressAndPubKey(derivationPath)
          : await ledger.getAddressAndPubKey(derivationPath);
        account = normalizeCalibrationAccount(
          addressResponse.addrString,
          metadata,
        );
        return account;
      });
    },
    async disconnect() {
      await closeTransport();
      account = null;
    },
    async getAccount() {
      return account;
    },
    async getBalance(nativeAccount) {
      if (nativeAccount.networkKey !== 'calibration') {
        throw new Error('Ledger Calibration balance reads require a t1 account.');
      }

      const balance = await readBalance(nativeAccount.address, 'calibration');
      return BigInt(balance);
    },
    async signAndSubmitMessage(
      message: FilecoinMessage,
    ): Promise<NativeFilecoinSendResult> {
      if (!account) {
        throw new Error('Connect a Ledger Filecoin t1 account before signing.');
      }

      if (message.From !== account.address) {
        throw new Error(
          'Ledger refused to sign because the reviewed sender no longer matches the connected t1 account.',
        );
      }

      if (!message.From.startsWith('t1')) {
        throw new Error('Ledger Calibration sends require a t1 sender.');
      }

      return withLedgerDevice(async () => {
        const loadedRuntime = await getRuntime();
        const ledger = await getConnectedApp();
        const rawMessage = toLedgerTransactionRaw(message);
        const serializedHex = loadedRuntime.serializeTransaction(rawMessage);
        const signed = await ledger.sign(
          derivationPath,
          loadedRuntime.bufferFromHex(serializedHex),
        );
        const signedMessage: SignedMessage = {
          Message: message,
          Signature: {
            Type: LEDGER_SECP256K1_SIGNATURE_TYPE,
            Data: loadedRuntime.bytesToBase64(signed.signature_compact),
          },
        };
        const cid = await submitSignedMessage(signedMessage, 'calibration');

        return { cid: getSubmittedCid(cid) };
      });
    },
  };
}
