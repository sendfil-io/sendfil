import { getBalance } from '../DataProvider';
import type { SendFilNetworkKey } from '../networks';
import type {
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from './types';
import {
  createFilsnapCalibrationProvider,
  type FilsnapEthereumProvider,
} from './filsnapProvider';

type NativeFilecoinFeatureEnv = Record<string, string | undefined>;

const nativeFilecoinProviderUnavailableReason =
  'Native Filecoin wallet signing is scaffolded, but no browser provider has been verified for production use yet.';

export const NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA: SenderProviderMetadata & {
  kind: 'native-filecoin-wallet';
} = {
  id: 'native-filecoin-placeholder',
  name: 'Native Filecoin wallet',
  kind: 'native-filecoin-wallet',
  status: 'planned',
  unavailableReason: nativeFilecoinProviderUnavailableReason,
  capabilities: {
    canConnect: false,
    canDisconnect: false,
    canDetectNetwork: false,
    canReadBalance: true,
    canSignBatch: false,
    canSubmit: false,
    oneApprovalPerBatch: true,
  },
};

function createUnsupportedNativeFilecoinProvider(): NativeFilecoinWalletProvider {
  return {
    metadata: NATIVE_FILECOIN_PROVIDER_PLACEHOLDER_METADATA,
    async connect() {
      throw new Error(nativeFilecoinProviderUnavailableReason);
    },
    async disconnect() {
      return undefined;
    },
    async getAccount() {
      return null;
    },
    async getBalance(account) {
      const balance = await getBalance(account.address, account.networkKey);
      return BigInt(balance);
    },
  };
}

function isNativeFilecoinSenderFeatureEnabled(
  env: NativeFilecoinFeatureEnv = import.meta.env as unknown as NativeFilecoinFeatureEnv,
): boolean {
  return env.VITE_NATIVE_FILECOIN_WALLET_ENABLED === 'true';
}

function isNativeFilecoinTestnetSendEnabled(
  env: NativeFilecoinFeatureEnv = import.meta.env as unknown as NativeFilecoinFeatureEnv,
): boolean {
  return env.VITE_NATIVE_FILECOIN_TESTNET_SEND_ENABLED === 'true';
}

export function getNativeFilecoinWalletProviders({
  featureEnabled = isNativeFilecoinSenderFeatureEnabled(),
  calibrationTestnetSendEnabled = isNativeFilecoinTestnetSendEnabled(),
  ethereumProvider,
}: {
  featureEnabled?: boolean;
  calibrationTestnetSendEnabled?: boolean;
  ethereumProvider?: FilsnapEthereumProvider;
} = {}): NativeFilecoinWalletProvider[] {
  if (!featureEnabled) {
    return [];
  }

  if (calibrationTestnetSendEnabled) {
    return [createFilsnapCalibrationProvider({ ethereumProvider })];
  }

  return [createUnsupportedNativeFilecoinProvider()];
}

export async function getNativeFilecoinSenderBalanceAttoFil(
  sender: NativeFilecoinConnectedSender,
  readBalance: (address: string, networkKey: SendFilNetworkKey) => Promise<string> = getBalance,
): Promise<bigint> {
  const balance = await readBalance(sender.address, sender.networkKey);
  return BigInt(balance);
}
