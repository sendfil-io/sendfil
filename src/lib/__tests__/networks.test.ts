import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SUPPORTED_WAGMI_CHAINS,
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

  it('exposes both Filecoin chains to wagmi', () => {
    expect(SUPPORTED_WAGMI_CHAINS.map((chain) => chain.id)).toEqual([314, 314159]);
  });

  it('resolves FEVM RPC URLs per supported network', () => {
    vi.stubEnv('VITE_FEVM_RPC_URL_MAINNET', 'http://fevm-mainnet');
    vi.stubEnv('VITE_FEVM_RPC_URL_CALIBRATION', 'http://fevm-calibration');

    expect(getNetworkConfig('mainnet').fevmRpcUrl).toBe('http://fevm-mainnet');
    expect(getNetworkConfig('calibration').fevmRpcUrl).toBe('http://fevm-calibration');
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

  it('enables calibration fees only when the calibration env says so', () => {
    vi.stubEnv('VITE_FEE_ENABLED_CALIBRATION', 'true');
    vi.stubEnv('VITE_FEE_ADDR_A_CALIBRATION', 't1fee-a');
    vi.stubEnv('VITE_FEE_ADDR_B_CALIBRATION', 't1fee-b');

    const calibration = getNetworkConfig('calibration');

    expect(calibration.feePolicy.enabled).toBe(true);
    expect(calibration.feePolicy.recipientA).toBe('t1fee-a');
    expect(calibration.feePolicy.recipientB).toBe('t1fee-b');
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

  it('uses the recorded ThinBatch deployments by default', () => {
    expect(getNetworkConfig('mainnet').thinBatchAddress).toBe(
      '0x647395311D78314075dd7b0eAdF9bcD26Eb75a04',
    );
    expect(getNetworkConfig('calibration').thinBatchAddress).toBe(
      '0x67fE9e377CD2F554629E266Ba91F53AA652EAdEB',
    );
  });

  it('resolves network-specific ThinBatch addresses when configured', () => {
    vi.stubEnv(
      'VITE_THINBATCH_ADDRESS_MAINNET',
      '0x5555555555555555555555555555555555555555',
    );
    vi.stubEnv(
      'VITE_THINBATCH_ADDRESS_CALIBRATION',
      '0x6666666666666666666666666666666666666666',
    );

    expect(getNetworkConfig('mainnet').thinBatchAddress).toBe(
      '0x5555555555555555555555555555555555555555',
    );
    expect(getNetworkConfig('calibration').thinBatchAddress).toBe(
      '0x6666666666666666666666666666666666666666',
    );
  });
});
