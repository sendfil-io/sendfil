import { getBalance, submitTransaction } from '../DataProvider';
import type { FilecoinMessage, SignedMessage } from '../DataProvider/types';
import {
  getDefaultNetworkKey,
  getNetworkConfig,
  type SendFilNetworkKey,
} from '../networks';
import { Buffer as BrowserBuffer } from 'buffer';
import type {
  NativeFilecoinAccount,
  NativeFilecoinConnectOptions,
  NativeFilecoinConnectedSender,
  NativeFilecoinProviderSupportStatus,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from './types';
import type { AccountNetwork, WalletAdapter, WalletSupportType } from 'iso-filecoin-wallets/types';
import type { MessageObj, Network as IsoFilecoinNetwork } from 'iso-filecoin/types';
import { submitSignedNativeFilecoinMessage } from './nativeFilecoinSubmission';

type NativeFilecoinFeatureEnv = Record<string, string | undefined>;

type NativeWalletAdapterFactory = (
  network: IsoFilecoinNetwork,
) => WalletAdapter | Promise<WalletAdapter>;

type BrowserGlobalWithBuffer = typeof globalThis & {
  Buffer?: typeof BrowserBuffer;
};

interface IsoWalletProviderConfig {
  metadata: SenderProviderMetadata & { kind: 'native-filecoin-wallet' };
  createAdapter: NativeWalletAdapterFactory;
  prepareBeforeConnect?: boolean;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function';
}

type LedgerTransportModule = typeof import('@ledgerhq/hw-transport-webhid');
type LedgerTransportClass = LedgerTransportModule['default'];

let ledgerTransportClass: LedgerTransportClass | undefined;
let ledgerTransportLoadPromise: Promise<LedgerTransportClass> | undefined;

async function loadLedgerTransport(): Promise<LedgerTransportClass> {
  if (ledgerTransportClass) {
    return ledgerTransportClass;
  }

  ledgerTransportLoadPromise ??= import('@ledgerhq/hw-transport-webhid').then(
    (module) => module.default,
  );
  ledgerTransportClass = await ledgerTransportLoadPromise;
  return ledgerTransportClass;
}

const nativeWalletCapabilities = {
  canConnect: true,
  canDisconnect: true,
  canDetectNetwork: true,
  canReadBalance: true,
  canSignBatch: true,
  canSubmit: true,
  oneApprovalPerBatch: true,
} as const;

export const FILSNAP_FILECOIN_PROVIDER_METADATA: SenderProviderMetadata & {
  kind: 'native-filecoin-wallet';
} = {
  id: 'filsnap-filecoin',
  name: 'FilSnap (Filecoin)',
  kind: 'native-filecoin-wallet',
  status: 'available',
  capabilities: nativeWalletCapabilities,
};

export const LEDGER_FILECOIN_PROVIDER_METADATA: SenderProviderMetadata & {
  kind: 'native-filecoin-wallet';
} = {
  id: 'ledger-filecoin',
  name: 'Ledger (Filecoin)',
  kind: 'native-filecoin-wallet',
  status: 'available',
  capabilities: nativeWalletCapabilities,
};

function toIsoFilecoinNetwork(networkKey: SendFilNetworkKey): IsoFilecoinNetwork {
  return networkKey === 'mainnet' ? 'mainnet' : 'testnet';
}

function fromIsoFilecoinNetwork(network: IsoFilecoinNetwork): SendFilNetworkKey {
  return network === 'mainnet' ? 'mainnet' : 'calibration';
}

function toNativeAccount({ account, network }: AccountNetwork): NativeFilecoinAccount {
  const networkKey = fromIsoFilecoinNetwork(network);
  const networkConfig = getNetworkConfig(networkKey);

  return {
    address: account.address.toString(),
    networkKey,
    nativePrefix: networkConfig.nativePrefix,
  };
}

function toIsoMessage(message: FilecoinMessage): MessageObj {
  return {
    version: 0,
    to: message.To,
    from: message.From,
    nonce: message.Nonce,
    value: message.Value,
    gasLimit: message.GasLimit,
    gasFeeCap: message.GasFeeCap,
    gasPremium: message.GasPremium,
    method: message.Method,
    params: message.Params ?? '',
  };
}

function mapWalletSupportStatus(
  support: WalletSupportType,
): NativeFilecoinProviderSupportStatus {
  switch (support) {
    case 'Detected':
      return 'detected';
    case 'NotDetected':
      return 'not-detected';
    case 'NotSupported':
      return 'not-supported';
    case 'NotChecked':
    default:
      return 'not-checked';
  }
}

async function readNativeBalance(account: NativeFilecoinAccount): Promise<bigint> {
  const balance = await getBalance(account.address, account.networkKey);
  return BigInt(balance);
}

export function ensureBrowserBuffer(): void {
  const browserGlobal = globalThis as BrowserGlobalWithBuffer;

  if (browserGlobal.Buffer) {
    return;
  }

  browserGlobal.Buffer = BrowserBuffer;
}

async function createLedgerTransport() {
  ensureBrowserBuffer();
  const TransportWebHID = ledgerTransportClass ?? await loadLedgerTransport();
  return TransportWebHID.create();
}

async function isLedgerTransportSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined') {
    return false;
  }

  try {
    const TransportWebHID = await loadLedgerTransport();
    return TransportWebHID.isSupported();
  } catch {
    return false;
  }
}

function createIsoWalletProvider({
  metadata,
  createAdapter,
  prepareBeforeConnect = false,
}: IsoWalletProviderConfig): NativeFilecoinWalletProvider {
  let adapter: WalletAdapter | undefined;
  let connectedAccount: NativeFilecoinAccount | null = null;

  async function getAdapter(networkKey: SendFilNetworkKey): Promise<WalletAdapter> {
    if (!adapter) {
      const createdAdapter = createAdapter(toIsoFilecoinNetwork(networkKey));
      adapter = isPromiseLike(createdAdapter) ? await createdAdapter : createdAdapter;
    }

    return adapter;
  }

  async function prepareConnect(
    options: NativeFilecoinConnectOptions = {},
  ): Promise<void> {
    const activeAdapter = await getAdapter(options.networkKey ?? getDefaultNetworkKey());
    await activeAdapter.checkSupport();
  }

  async function connectAccount(networkKey: SendFilNetworkKey): Promise<NativeFilecoinAccount> {
    const activeAdapter = await getAdapter(networkKey);
    const isoNetwork = toIsoFilecoinNetwork(networkKey);
    const accountNetwork =
      activeAdapter.connected && connectedAccount
        ? connectedAccount.networkKey === networkKey
          ? { account: activeAdapter.account!, network: activeAdapter.network }
          : await activeAdapter.changeNetwork(isoNetwork)
        : await activeAdapter.connect({ network: isoNetwork });

    connectedAccount = toNativeAccount(accountNetwork);
    return connectedAccount;
  }

  async function getConnectedAccount(): Promise<NativeFilecoinAccount | null> {
    if (connectedAccount) {
      return connectedAccount;
    }

    if (!adapter?.account) {
      return null;
    }

    connectedAccount = toNativeAccount({
      account: adapter.account,
      network: adapter.network,
    });

    return connectedAccount;
  }

  return {
    metadata,
    ...(prepareBeforeConnect ? { prepareConnect } : {}),
    async checkSupport() {
      try {
        const activeAdapter = await getAdapter(getDefaultNetworkKey());
        await activeAdapter.checkSupport();
        return mapWalletSupportStatus(activeAdapter.support);
      } catch (error) {
        throw normalizeNativeWalletError(metadata, error);
      }
    },
    async connect(options = {}) {
      try {
        return await connectAccount(options.networkKey ?? getDefaultNetworkKey());
      } catch (error) {
        throw normalizeNativeWalletError(metadata, error);
      }
    },
    async disconnect() {
      if (adapter) {
        await adapter.disconnect();
      }

      connectedAccount = null;
    },
    getAccount: getConnectedAccount,
    getBalance: readNativeBalance,
    async signAndSubmitMessage(message, submissionOptions) {
      const account = await getConnectedAccount();

      if (!account || !adapter?.connected) {
        throw new Error(`${metadata.name} is not connected.`);
      }

      let signature: Awaited<ReturnType<WalletAdapter['signMessage']>>;
      try {
        signature = await adapter.signMessage(toIsoMessage(message));
      } catch (error) {
        throw normalizeNativeWalletError(metadata, error, 'sign');
      }

      const signedMessage: SignedMessage = {
        Message: message,
        Signature: signature.toLotus(),
      };

      return submitSignedNativeFilecoinMessage(
        signedMessage,
        account.networkKey,
        submitTransaction,
        submissionOptions,
      );
    },
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown error';
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const statusCode = Reflect.get(error, 'statusCode');
  return typeof statusCode === 'number' ? statusCode : undefined;
}

export function formatNativeFilecoinWalletErrorMessage(
  metadata: SenderProviderMetadata,
  error: unknown,
  operation: 'connect' | 'sign' = 'connect',
): string {
  const rawMessage = getErrorMessage(error);
  const normalizedMessage = rawMessage.toLowerCase();
  const statusCode = getErrorStatusCode(error);

  if (metadata.id === LEDGER_FILECOIN_PROVIDER_METADATA.id) {
    if (normalizedMessage.includes('buffer is not defined')) {
      return 'Ledger connection could not start. Refresh SendFIL and try again.';
    }

    if (
      normalizedMessage.includes('webhid') ||
      normalizedMessage.includes('hid') ||
      normalizedMessage.includes('webusb') ||
      normalizedMessage.includes('usb') ||
      normalizedMessage.includes('not supported')
    ) {
      return 'Ledger browser transport is not available here. Use Chrome, Brave, or Edge on desktop, then try again.';
    }

    if (
      operation !== 'sign' &&
      (normalizedMessage.includes('access denied') ||
        normalizedMessage.includes('denied') ||
        normalizedMessage.includes('cancel') ||
        normalizedMessage.includes('no device selected'))
    ) {
      return 'Ledger connection was cancelled or blocked. Unlock your Ledger, open the Filecoin app, choose it in the browser device prompt, and approve the connection.';
    }

    if (normalizedMessage.includes('version is too old')) {
      return 'Your Ledger Filecoin app is too old. Update the Filecoin app in Ledger Live, then try again.';
    }

    if (operation === 'sign') {
      if (
        statusCode === 0x5501 ||
        statusCode === 0x6986 ||
        normalizedMessage.includes('user rejected') ||
        normalizedMessage.includes('user denied') ||
        normalizedMessage.includes('user refused on device') ||
        normalizedMessage.includes('userrefusedondevice') ||
        normalizedMessage.includes('rejected the request') ||
        normalizedMessage.includes('request rejected') ||
        normalizedMessage.includes('request cancelled') ||
        normalizedMessage.includes('request canceled') ||
        normalizedMessage.includes('command not allowed') ||
        normalizedMessage.includes('command rejected') ||
        normalizedMessage.includes('0x5501') ||
        normalizedMessage.includes('0x6986')
      ) {
        return 'Ledger signature request was rejected on the device. No Filecoin message was submitted.';
      }

      if (
        statusCode === 0x6e01 ||
        normalizedMessage.includes('filecoin app not open') ||
        normalizedMessage.includes('0x6e01')
      ) {
        return 'Open the Filecoin app on your Ledger, then retry the signature. No Filecoin message was submitted.';
      }

      if (
        statusCode === 0x5515 ||
        statusCode === 0x6982 ||
        normalizedMessage.includes('locked device') ||
        normalizedMessage.includes('security not satisfied') ||
        normalizedMessage.includes('0x5515') ||
        normalizedMessage.includes('0x6982')
      ) {
        return 'Unlock your Ledger and open the Filecoin app, then retry the signature. No Filecoin message was submitted.';
      }

      if (
        statusCode === 0x6a80 ||
        normalizedMessage.includes('bad key handle') ||
        normalizedMessage.includes('0x6a80')
      ) {
        return 'Ledger could not use the selected Filecoin account key. Reconnect the Ledger account, verify the Filecoin app is open and up to date, then try again.';
      }

      if (
        statusCode === 0x6984 ||
        normalizedMessage.includes('invalid data') ||
        normalizedMessage.includes('data is invalid') ||
        normalizedMessage.includes('0x6984')
      ) {
        return 'The Ledger Filecoin app rejected the message data before signing. Confirm the app is up to date, then try again. No Filecoin message was submitted.';
      }

      return 'Ledger could not sign the Filecoin message. Keep your Ledger unlocked with the Filecoin app open, then try again.';
    }

    return 'Ledger could not connect. Unlock your Ledger, open the Filecoin app, choose it in the browser device prompt, and approve the connection.';
  }

  if (metadata.id === FILSNAP_FILECOIN_PROVIDER_METADATA.id) {
    if (
      normalizedMessage.includes('not found') ||
      normalizedMessage.includes('not installed') ||
      normalizedMessage.includes('no provider')
    ) {
      return 'FilSnap needs MetaMask with the FilSnap Snap installed. Open MetaMask, install or enable FilSnap, then try again.';
    }

    if (
      normalizedMessage.includes('denied') ||
      normalizedMessage.includes('reject') ||
      normalizedMessage.includes('cancelled') ||
      normalizedMessage.includes('canceled')
    ) {
      return operation === 'sign'
        ? 'FilSnap signature request was rejected in MetaMask. No Filecoin message was submitted.'
        : 'FilSnap connection was rejected in MetaMask. Approve the Snap connection to continue.';
    }

    if (operation === 'sign') {
      return 'FilSnap could not sign the Filecoin message. Unlock MetaMask, make sure FilSnap is enabled, and try again.';
    }

    return 'FilSnap could not connect. Open MetaMask, approve the FilSnap request, and try again.';
  }

  return rawMessage;
}

function normalizeNativeWalletError(
  metadata: SenderProviderMetadata,
  error: unknown,
  operation: 'connect' | 'sign' = 'connect',
): Error {
  const normalizedError = new Error(
    formatNativeFilecoinWalletErrorMessage(metadata, error, operation),
  ) as Error & { cause?: unknown };

  normalizedError.cause = error;
  return normalizedError;
}

export function createFilsnapFilecoinWalletProvider(): NativeFilecoinWalletProvider {
  return createIsoWalletProvider({
    metadata: FILSNAP_FILECOIN_PROVIDER_METADATA,
    async createAdapter(network) {
      const { WalletAdapterFilsnap } = await import('iso-filecoin-wallets/filsnap');

      return new WalletAdapterFilsnap({
        name: FILSNAP_FILECOIN_PROVIDER_METADATA.name,
        network,
        syncWithProvider: false,
      });
    },
  });
}

export function createLedgerFilecoinWalletProvider(): NativeFilecoinWalletProvider {
  return createIsoWalletProvider({
    metadata: LEDGER_FILECOIN_PROVIDER_METADATA,
    prepareBeforeConnect: true,
    async createAdapter(network) {
      ensureBrowserBuffer();
      const { WalletAdapterLedger } = await import('iso-filecoin-wallets/ledger');

      return new WalletAdapterLedger({
        name: LEDGER_FILECOIN_PROVIDER_METADATA.name,
        network,
        transport: {
          create: createLedgerTransport,
          isSupported: isLedgerTransportSupported,
        },
      });
    },
  });
}

function areNativeFilecoinWalletsEnabled(
  env: NativeFilecoinFeatureEnv = import.meta.env as unknown as NativeFilecoinFeatureEnv,
): boolean {
  return env.VITE_NATIVE_FILECOIN_WALLET_ENABLED !== 'false';
}

export function getNativeFilecoinWalletProviders({
  featureEnabled = areNativeFilecoinWalletsEnabled(),
}: {
  featureEnabled?: boolean;
} = {}): NativeFilecoinWalletProvider[] {
  if (!featureEnabled) {
    return [];
  }

  return [
    createFilsnapFilecoinWalletProvider(),
    createLedgerFilecoinWalletProvider(),
  ];
}

export async function getNativeFilecoinSenderBalanceAttoFil(
  sender: NativeFilecoinConnectedSender,
  readBalance: (address: string, networkKey: SendFilNetworkKey) => Promise<string> = getBalance,
): Promise<bigint> {
  const balance = await readBalance(sender.address, sender.networkKey);
  return BigInt(balance);
}
