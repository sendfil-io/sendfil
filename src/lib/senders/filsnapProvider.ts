import type { FilecoinMessage } from '../DataProvider/types';
import { getBalance } from '../DataProvider';
import { getNetworkConfig } from '../networks';
import { createNativeFilecoinConnectedSender } from './senderModel';
import type {
  NativeFilecoinAccount,
  NativeFilecoinSendResult,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from './types';

export interface FilsnapEthereumProvider {
  isMetaMask?: boolean;
  request: (request: {
    method: string;
    params?: unknown;
  }) => Promise<unknown>;
}

export interface CreateFilsnapCalibrationProviderOptions {
  ethereumProvider?: FilsnapEthereumProvider;
  snapId?: string;
  snapVersion?: string;
  readBalance?: (address: string, networkKey: 'calibration') => Promise<string>;
}

interface FilsnapResponse<T> {
  error: null | {
    message?: string;
    data?: unknown;
  };
  result: T | null;
}

interface FilsnapAccountResponse {
  address: string;
  publicKey?: string;
  path?: string;
  type?: 'SECP256K1';
}

interface FilsnapMessageStatus {
  cid?: string;
  message?: unknown;
}

const FILSNAP_DEFAULT_SNAP_ID = 'npm:filsnap';
const FILSNAP_CALIBRATION_UNAVAILABLE_REASON =
  'MetaMask with FilSnap was not detected. Install MetaMask with Snaps support to test native Calibration sends.';

function getBrowserEthereumProvider(): FilsnapEthereumProvider | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const ethereum = Reflect.get(window, 'ethereum');

  if (
    typeof ethereum === 'object' &&
    ethereum !== null &&
    typeof Reflect.get(ethereum, 'request') === 'function'
  ) {
    return ethereum as FilsnapEthereumProvider;
  }

  return undefined;
}

function createFilsnapMetadata(
  ethereumProvider?: FilsnapEthereumProvider,
): SenderProviderMetadata & { kind: 'native-filecoin-wallet' } {
  const isAvailable = Boolean(ethereumProvider);

  return {
    id: 'filsnap-calibration',
    name: 'FilSnap Calibration',
    kind: 'native-filecoin-wallet',
    status: isAvailable ? 'available' : 'disabled',
    unavailableReason: isAvailable
      ? undefined
      : FILSNAP_CALIBRATION_UNAVAILABLE_REASON,
    capabilities: {
      canConnect: isAvailable,
      canDisconnect: false,
      canDetectNetwork: true,
      canReadBalance: true,
      canSignBatch: isAvailable,
      canSubmit: isAvailable,
      oneApprovalPerBatch: true,
    },
  };
}

function assertEthereumProvider(
  ethereumProvider?: FilsnapEthereumProvider,
): FilsnapEthereumProvider {
  if (!ethereumProvider) {
    throw new Error(FILSNAP_CALIBRATION_UNAVAILABLE_REASON);
  }

  return ethereumProvider;
}

function unwrapFilsnapResponse<T>(method: string, response: unknown): T {
  if (typeof response !== 'object' || response === null) {
    throw new Error(`${method} returned an invalid response.`);
  }

  const maybeResponse = response as FilsnapResponse<T>;

  if (maybeResponse.error) {
    throw new Error(
      `${method} failed: ${maybeResponse.error.message ?? 'Unknown FilSnap error'}`,
    );
  }

  if (maybeResponse.result === null || maybeResponse.result === undefined) {
    throw new Error(`${method} returned no result.`);
  }

  return maybeResponse.result;
}

function getFilsnapCid(status: unknown): string {
  if (typeof status === 'string' && status.length > 0) {
    return status;
  }

  if (typeof status === 'object' && status !== null) {
    const cid = Reflect.get(status, 'cid');
    if (typeof cid === 'string' && cid.length > 0) {
      return cid;
    }

    const slashCid = Reflect.get(status, '/');
    if (typeof slashCid === 'string' && slashCid.length > 0) {
      return slashCid;
    }
  }

  throw new Error('FilSnap did not return a message CID.');
}

function toFilsnapUnsignedMessage(message: FilecoinMessage): Record<string, unknown> {
  return {
    to: message.To,
    value: message.Value,
    nonce: message.Nonce,
    gasLimit: message.GasLimit,
    gasFeeCap: message.GasFeeCap,
    gasPremium: message.GasPremium,
    method: message.Method,
    params: message.Params ?? '',
  };
}

function normalizeCalibrationAccount(
  account: FilsnapAccountResponse,
  metadata: SenderProviderMetadata,
): NativeFilecoinAccount {
  const result = createNativeFilecoinConnectedSender({
    address: account.address,
    provider: metadata,
    expectedNetworkKey: 'calibration',
  });

  if (!result.sender) {
    throw new Error(
      result.error ?? 'FilSnap did not return a supported Calibration t1 account.',
    );
  }

  return {
    address: result.sender.address,
    networkKey: result.sender.networkKey,
    nativePrefix: result.sender.nativePrefix,
  };
}

export function createFilsnapCalibrationProvider({
  ethereumProvider = getBrowserEthereumProvider(),
  snapId = import.meta.env.VITE_FILSNAP_SNAP_ID ?? FILSNAP_DEFAULT_SNAP_ID,
  snapVersion = import.meta.env.VITE_FILSNAP_VERSION,
  readBalance = getBalance,
}: CreateFilsnapCalibrationProviderOptions = {}): NativeFilecoinWalletProvider {
  const metadata = createFilsnapMetadata(ethereumProvider);
  const calibration = getNetworkConfig('calibration');

  const invokeSnap = async <T>(method: string, params?: unknown): Promise<T> => {
    const ethereum = assertEthereumProvider(ethereumProvider);
    const response = await ethereum.request({
      method: 'wallet_invokeSnap',
      params: {
        snapId,
        request: params === undefined ? { method } : { method, params },
      },
    });

    return unwrapFilsnapResponse<T>(method, response);
  };

  return {
    metadata,
    async connect() {
      const ethereum = assertEthereumProvider(ethereumProvider);

      await ethereum.request({
        method: 'wallet_requestSnaps',
        params: {
          [snapId]: snapVersion ? { version: snapVersion } : {},
        },
      });

      await invokeSnap('fil_configure', {
        network: 'testnet',
        rpc: {
          url: calibration.lotusRpcPrimaryUrl,
          token: '',
        },
      });

      const account = await invokeSnap<FilsnapAccountResponse>('fil_getAccount');
      return normalizeCalibrationAccount(account, metadata);
    },
    async disconnect() {
      return undefined;
    },
    async getAccount() {
      try {
        const account = await invokeSnap<FilsnapAccountResponse>('fil_getAccount');
        return normalizeCalibrationAccount(account, metadata);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('No configuration found')) {
          return null;
        }

        throw error;
      }
    },
    async getBalance(account) {
      if (account.networkKey !== 'calibration') {
        throw new Error('FilSnap Calibration balance reads require a t1 account.');
      }

      const balance = await readBalance(account.address, 'calibration');
      return BigInt(balance);
    },
    async signAndSubmitMessage(message): Promise<NativeFilecoinSendResult> {
      if (!message.From.startsWith('t1')) {
        throw new Error('FilSnap testnet sends require a Calibration t1 sender.');
      }

      const signedMessage = await invokeSnap<unknown>(
        'fil_signMessage',
        toFilsnapUnsignedMessage(message),
      );
      const status = await invokeSnap<FilsnapMessageStatus>(
        'fil_sendMessage',
        signedMessage,
      );

      return { cid: getFilsnapCid(status) };
    },
  };
}
