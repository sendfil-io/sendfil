import { getBalance, submitTransaction } from '../DataProvider';
import type { FilecoinMessage, SignedMessage } from '../DataProvider/types';
import {
  getDefaultNetworkKey,
  getNetworkConfig,
  type SendFilNetworkKey,
} from '../networks';
import type {
  NativeFilecoinAccount,
  NativeFilecoinConnectedSender,
  NativeFilecoinProviderSupportStatus,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from './types';
import type { AccountNetwork, WalletAdapter, WalletSupportType } from 'iso-filecoin-wallets/types';
import type { MessageObj, Network as IsoFilecoinNetwork } from 'iso-filecoin/types';

type NativeFilecoinFeatureEnv = Record<string, string | undefined>;

type NativeWalletAdapterFactory = (
  network: IsoFilecoinNetwork,
) => WalletAdapter | Promise<WalletAdapter>;

interface IsoWalletProviderConfig {
  metadata: SenderProviderMetadata & { kind: 'native-filecoin-wallet' };
  createAdapter: NativeWalletAdapterFactory;
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

async function createLedgerTransport() {
  const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb');
  return TransportWebUSB.create();
}

async function isLedgerTransportSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined') {
    return false;
  }

  try {
    const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb');
    return TransportWebUSB.isSupported();
  } catch {
    return false;
  }
}

function createIsoWalletProvider({
  metadata,
  createAdapter,
}: IsoWalletProviderConfig): NativeFilecoinWalletProvider {
  let adapter: WalletAdapter | undefined;
  let connectedAccount: NativeFilecoinAccount | null = null;

  async function getAdapter(networkKey: SendFilNetworkKey): Promise<WalletAdapter> {
    if (!adapter) {
      adapter = await createAdapter(toIsoFilecoinNetwork(networkKey));
    }

    return adapter;
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
    async checkSupport() {
      const activeAdapter = await getAdapter(getDefaultNetworkKey());
      await activeAdapter.checkSupport();
      return mapWalletSupportStatus(activeAdapter.support);
    },
    async connect(options = {}) {
      return connectAccount(options.networkKey ?? getDefaultNetworkKey());
    },
    async disconnect() {
      if (adapter) {
        await adapter.disconnect();
      }

      connectedAccount = null;
    },
    getAccount: getConnectedAccount,
    getBalance: readNativeBalance,
    async signAndSubmitMessage(message) {
      const account = await getConnectedAccount();

      if (!account || !adapter?.connected) {
        throw new Error(`${metadata.name} is not connected.`);
      }

      const signature = await adapter.signMessage(toIsoMessage(message));
      const signedMessage: SignedMessage = {
        Message: message,
        Signature: signature.toLotus(),
      };
      const cid = await submitTransaction(signedMessage, account.networkKey);

      return {
        cid: cid['/'],
      };
    },
  };
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
    async createAdapter(network) {
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
