import { CoinType } from '@glif/filecoin-address';
import { filecoin, filecoinCalibration } from 'viem/chains';

export type SendFilNetworkKey = 'mainnet' | 'calibration';
export type SupportedChainId = 314 | 314159;
export type NetworkPrefix = 'f' | 't';

export interface SendFilFeePolicy {
  enabled: boolean;
  percent: number;
  split: number;
  recipientA?: string;
  recipientB?: string;
}

export interface SendFilNetworkConfig {
  key: SendFilNetworkKey;
  chainId: SupportedChainId;
  chainName: string;
  walletLabel: string;
  nativePrefix: NetworkPrefix;
  isTestnet: boolean;
  coinType: CoinType;
  filfoxMessageBaseUrl: string;
  fevmRpcUrl: string;
  lotusRpcPrimaryUrl: string;
  lotusRpcFallbackUrl: string;
  lotusRpcTimeoutMs: number;
  multicall3Address: `0x${string}`;
  filForwarderAddress: `0x${string}`;
  thinBatchAddress?: `0x${string}`;
  feePolicy: SendFilFeePolicy;
}

const MULTICALL3_DEFAULT = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const FIL_FORWARDER_DEFAULT = '0x2b3ef6906429b580b7b2080de5ca893bc282c225' as const;
const THINBATCH_MAINNET_DEFAULT =
  '0x647395311D78314075dd7b0eAdF9bcD26Eb75a04' as const;
const THINBATCH_CALIBRATION_DEFAULT =
  '0x67fE9e377CD2F554629E266Ba91F53AA652EAdEB' as const;

const RETIRED_MAINNET_LOTUS_RPC_URLS = new Set([
  'https://rpc.node.glif.io/rpc/v1',
]);

const LEGACY_ENV_WARNINGS = new Set<string>();

const NETWORK_METADATA: Record<
  SendFilNetworkKey,
  Omit<
    SendFilNetworkConfig,
    | 'filfoxMessageBaseUrl'
    | 'fevmRpcUrl'
    | 'lotusRpcPrimaryUrl'
    | 'lotusRpcFallbackUrl'
    | 'lotusRpcTimeoutMs'
    | 'multicall3Address'
    | 'filForwarderAddress'
    | 'thinBatchAddress'
    | 'feePolicy'
  > & {
    defaultFilfoxMessageBaseUrl: string;
    defaultFevmRpcUrl: string;
    defaultLotusRpcUrl: string;
    defaultLotusStateReadFallbackUrl?: string;
  }
> = {
  mainnet: {
    key: 'mainnet',
    chainId: 314,
    chainName: 'Filecoin Mainnet',
    walletLabel: 'Filecoin Mainnet',
    nativePrefix: 'f',
    isTestnet: false,
    coinType: CoinType.MAIN,
    defaultFilfoxMessageBaseUrl: 'https://filfox.info/en/message/',
    defaultFevmRpcUrl: filecoin.rpcUrls.default.http[0]!,
    defaultLotusRpcUrl: 'https://api.node.glif.io/rpc/v1',
    defaultLotusStateReadFallbackUrl: 'https://rpc.ankr.com/filecoin',
  },
  calibration: {
    key: 'calibration',
    chainId: 314159,
    chainName: 'Calibration',
    walletLabel: 'Calibration Testnet',
    nativePrefix: 't',
    isTestnet: true,
    coinType: CoinType.TEST,
    defaultFilfoxMessageBaseUrl: 'https://calibration.filfox.info/en/message/',
    defaultFevmRpcUrl: filecoinCalibration.rpcUrls.default.http[0]!,
    defaultLotusRpcUrl: 'https://api.calibration.node.glif.io/rpc/v1',
  },
};

export const SUPPORTED_WAGMI_CHAINS = [filecoin, filecoinCalibration] as const;

function readEnv(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value && value.length > 0 ? value : undefined;
}

function normalizeRpcUrl(url: string): string {
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function resolveConfiguredLotusFallback(
  key: SendFilNetworkKey,
  primary: string,
  configuredFallback: string | undefined,
): string {
  if (!configuredFallback) {
    return primary;
  }

  if (
    key === 'mainnet' &&
    RETIRED_MAINNET_LOTUS_RPC_URLS.has(normalizeRpcUrl(configuredFallback))
  ) {
    return primary;
  }

  return configuredFallback;
}

function warnLegacyEnvUsage(legacyEnvName: string, replacementEnvName: string): void {
  if (!import.meta.env.DEV || LEGACY_ENV_WARNINGS.has(legacyEnvName)) {
    return;
  }

  LEGACY_ENV_WARNINGS.add(legacyEnvName);
  console.warn(
    `[sendfil] ${legacyEnvName} is deprecated. Prefer ${replacementEnvName}.`,
  );
}

function readEnvWithLegacy(
  envName: string,
  legacyEnvName?: string,
): string | undefined {
  const currentValue = readEnv(envName);
  if (currentValue) {
    return currentValue;
  }

  if (!legacyEnvName) {
    return undefined;
  }

  const legacyValue = readEnv(legacyEnvName);
  if (!legacyValue) {
    return undefined;
  }

  warnLegacyEnvUsage(legacyEnvName, envName);
  return legacyValue;
}

function readNumberEnvWithLegacy(
  envName: string,
  fallback: number,
  legacyEnvName?: string,
): number {
  const rawValue = readEnvWithLegacy(envName, legacyEnvName);
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function readBooleanEnv(envName: string, fallback: boolean): boolean {
  const rawValue = readEnv(envName);
  if (!rawValue) {
    return fallback;
  }

  return rawValue === 'true';
}

function resolveThinBatchAddress(
  key: SendFilNetworkKey,
): `0x${string}` | undefined {
  const configuredAddress = readEnv(
    key === 'mainnet'
      ? 'VITE_THINBATCH_ADDRESS_MAINNET'
      : 'VITE_THINBATCH_ADDRESS_CALIBRATION',
  ) as `0x${string}` | undefined;

  return configuredAddress ??
    (key === 'mainnet'
      ? THINBATCH_MAINNET_DEFAULT
      : THINBATCH_CALIBRATION_DEFAULT);
}

export function getDefaultNetworkKey(): SendFilNetworkKey {
  return readEnv('VITE_DEFAULT_NETWORK') === 'calibration'
    ? 'calibration'
    : 'mainnet';
}

export function isSupportedSendChainId(chainId?: number): chainId is SupportedChainId {
  return chainId === NETWORK_METADATA.mainnet.chainId || chainId === NETWORK_METADATA.calibration.chainId;
}

export function getNetworkKeyForChainId(
  chainId?: number,
): SendFilNetworkKey | undefined {
  if (chainId === NETWORK_METADATA.mainnet.chainId) {
    return 'mainnet';
  }

  if (chainId === NETWORK_METADATA.calibration.chainId) {
    return 'calibration';
  }

  return undefined;
}

export function getExpectedAddressPrefix(
  chainId?: number,
): NetworkPrefix | undefined {
  const network = getSupportedNetworkByChainId(chainId);
  return network?.nativePrefix;
}

export function getCoinTypeForChainId(chainId?: number): CoinType {
  return getSupportedNetworkByChainId(chainId)?.coinType ?? getDefaultNetworkConfig().coinType;
}

export function getSupportedNetworkListLabel(): string {
  return 'Filecoin Mainnet or Calibration';
}

export function getFilfoxMessageUrl(hash: string, chainId?: number): string {
  const network = getSupportedNetworkByChainId(chainId) ?? getDefaultNetworkConfig();
  return `${network.filfoxMessageBaseUrl}${hash}`;
}

export function resolveFeePolicy(key: SendFilNetworkKey): SendFilFeePolicy {
  const isMainnet = key === 'mainnet';
  const percent = readNumberEnvWithLegacy(
    isMainnet ? 'VITE_FEE_PERCENT_MAINNET' : 'VITE_FEE_PERCENT_CALIBRATION',
    1,
    isMainnet ? 'VITE_FEE_PERCENT' : undefined,
  );
  const split = readNumberEnvWithLegacy(
    isMainnet ? 'VITE_FEE_SPLIT_MAINNET' : 'VITE_FEE_SPLIT_CALIBRATION',
    0.5,
    isMainnet ? 'VITE_FEE_SPLIT' : undefined,
  );

  return {
    enabled: readBooleanEnv(
      isMainnet ? 'VITE_FEE_ENABLED_MAINNET' : 'VITE_FEE_ENABLED_CALIBRATION',
      isMainnet,
    ),
    percent,
    split,
    recipientA: readEnvWithLegacy(
      isMainnet ? 'VITE_FEE_ADDR_A_MAINNET' : 'VITE_FEE_ADDR_A_CALIBRATION',
      isMainnet ? 'VITE_FEE_ADDR_A' : undefined,
    ),
    recipientB: readEnvWithLegacy(
      isMainnet ? 'VITE_FEE_ADDR_B_MAINNET' : 'VITE_FEE_ADDR_B_CALIBRATION',
      isMainnet ? 'VITE_FEE_ADDR_B' : undefined,
    ),
  };
}

function resolveFevmRpcUrl(key: SendFilNetworkKey): string {
  const envName =
    key === 'mainnet' ? 'VITE_FEVM_RPC_URL_MAINNET' : 'VITE_FEVM_RPC_URL_CALIBRATION';
  const legacyEnvName = key === 'mainnet' ? 'VITE_RPC_URL' : undefined;
  return (
    readEnvWithLegacy(envName, legacyEnvName) ??
    NETWORK_METADATA[key].defaultFevmRpcUrl
  );
}

export function resolveLotusRpcConfig(key: SendFilNetworkKey): {
  primary: string;
  fallback: string;
  stateReadFallback?: string;
  timeout: number;
} {
  const isMainnet = key === 'mainnet';
  const primary =
    readEnvWithLegacy(
      isMainnet ? 'VITE_LOTUS_RPC_URL_MAINNET' : 'VITE_LOTUS_RPC_URL_CALIBRATION',
      isMainnet ? 'VITE_GLIF_RPC_URL_PRIMARY' : undefined,
    ) ?? NETWORK_METADATA[key].defaultLotusRpcUrl;
  const configuredFallback =
    readEnvWithLegacy(
      isMainnet
        ? 'VITE_LOTUS_RPC_FALLBACK_MAINNET'
        : 'VITE_LOTUS_RPC_FALLBACK_CALIBRATION',
      isMainnet ? 'VITE_GLIF_RPC_URL_FALLBACK' : undefined,
    );
  const fallback = resolveConfiguredLotusFallback(key, primary, configuredFallback);
  const stateReadFallback =
    readEnv(
      isMainnet
        ? 'VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET'
        : 'VITE_LOTUS_RPC_STATE_READ_FALLBACK_CALIBRATION',
    ) ?? NETWORK_METADATA[key].defaultLotusStateReadFallbackUrl;

  return {
    primary,
    fallback,
    stateReadFallback,
    timeout: readNumberEnvWithLegacy(
      'VITE_LOTUS_RPC_TIMEOUT_MS',
      10_000,
      'VITE_GLIF_RPC_TIMEOUT_MS',
    ),
  };
}

export function getNetworkConfig(key: SendFilNetworkKey): SendFilNetworkConfig {
  const metadata = NETWORK_METADATA[key];
  const lotusRpc = resolveLotusRpcConfig(key);

  return {
    key,
    chainId: metadata.chainId,
    chainName: metadata.chainName,
    walletLabel: metadata.walletLabel,
    nativePrefix: metadata.nativePrefix,
    isTestnet: metadata.isTestnet,
    coinType: metadata.coinType,
    filfoxMessageBaseUrl:
      readEnv(
        key === 'mainnet'
          ? 'VITE_FILFOX_BASE_MAINNET'
          : 'VITE_FILFOX_BASE_CALIBRATION',
      ) ?? metadata.defaultFilfoxMessageBaseUrl,
    fevmRpcUrl: resolveFevmRpcUrl(key),
    lotusRpcPrimaryUrl: lotusRpc.primary,
    lotusRpcFallbackUrl: lotusRpc.fallback,
    lotusRpcTimeoutMs: lotusRpc.timeout,
    multicall3Address:
      (readEnv(
        key === 'mainnet'
          ? 'VITE_MULTICALL3_ADDRESS_MAINNET'
          : 'VITE_MULTICALL3_ADDRESS_CALIBRATION',
      ) as `0x${string}` | undefined) ?? MULTICALL3_DEFAULT,
    filForwarderAddress:
      (readEnv(
        key === 'mainnet'
          ? 'VITE_FILFORWARDER_ADDRESS_MAINNET'
          : 'VITE_FILFORWARDER_ADDRESS_CALIBRATION',
      ) as `0x${string}` | undefined) ?? FIL_FORWARDER_DEFAULT,
    thinBatchAddress: resolveThinBatchAddress(key),
    feePolicy: resolveFeePolicy(key),
  };
}

export function getDefaultNetworkConfig(): SendFilNetworkConfig {
  return getNetworkConfig(getDefaultNetworkKey());
}

export function getSupportedNetworkByChainId(
  chainId?: number,
): SendFilNetworkConfig | undefined {
  const key = getNetworkKeyForChainId(chainId);
  return key ? getNetworkConfig(key) : undefined;
}
