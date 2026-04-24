import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultNetworkKey,
  getFilfoxMessageUrl,
  getNetworkConfig,
  getSupportedNetworkByChainId,
  resolveLotusRpcConfig,
} from '../networks';

describe('networks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves supported network metadata by chain id', () => {
    expect(getSupportedNetworkByChainId(314)?.key).toBe('mainnet');
    expect(getSupportedNetworkByChainId(314159)?.key).toBe('calibration');
    expect(getSupportedNetworkByChainId(1)).toBeUndefined();
  });

  it('builds Filfox message URLs for both supported networks', () => {
    const hash = `0x${'a'.repeat(64)}`;

    expect(getFilfoxMessageUrl(hash, 314)).toBe(`https://filfox.info/en/message/${hash}`);
    expect(getFilfoxMessageUrl(hash, 314159)).toBe(
      `https://calibration.filfox.info/en/message/${hash}`,
    );
  });

  it('honors the default network env when present', () => {
    vi.stubEnv('VITE_DEFAULT_NETWORK', 'calibration');
    expect(getDefaultNetworkKey()).toBe('calibration');
  });

  it('resolves network-specific fee policy and keeps calibration disabled by default', () => {
    vi.stubEnv('VITE_FEE_ADDR_A_MAINNET', 'f1mainfeea');
    vi.stubEnv('VITE_FEE_ADDR_B_MAINNET', 'f1mainfeeb');

    const mainnet = getNetworkConfig('mainnet');
    const calibration = getNetworkConfig('calibration');

    expect(mainnet.feePolicy.enabled).toBe(true);
    expect(mainnet.feePolicy.recipientA).toBe('f1mainfeea');
    expect(mainnet.feePolicy.recipientB).toBe('f1mainfeeb');
    expect(calibration.feePolicy.enabled).toBe(false);
  });

  it('resolves lotus rpc config per network', () => {
    vi.stubEnv('VITE_LOTUS_RPC_URL_MAINNET', 'http://lotus-mainnet');
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', 'http://lotus-mainnet-fallback');
    vi.stubEnv('VITE_LOTUS_RPC_URL_CALIBRATION', 'http://lotus-calibration');
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_CALIBRATION', 'http://lotus-calibration-fallback');
    vi.stubEnv('VITE_LOTUS_RPC_TIMEOUT_MS', '4321');

    expect(resolveLotusRpcConfig('mainnet')).toEqual({
      primary: 'http://lotus-mainnet',
      fallback: 'http://lotus-mainnet-fallback',
      timeout: 4321,
    });
    expect(resolveLotusRpcConfig('calibration')).toEqual({
      primary: 'http://lotus-calibration',
      fallback: 'http://lotus-calibration-fallback',
      timeout: 4321,
    });
  });
});
