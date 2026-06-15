import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { getAddress } from 'viem';
import { getNetworkConfig } from '../../networks';
import { BatchExecutionError } from '../errorHandling';
import {
  prepareBatchExecution,
  type BatchExecutionRecipient,
} from '../batchExecution';
import {
  useExecuteBatch,
  type UseExecuteBatchReturn,
} from '../useExecuteBatch';

const ACCOUNT = getAddress('0x9999999999999999999999999999999999999999');
const RECIPIENT = getAddress('0x1234567890abcdef1234567890abcdef12345678');
const FEE_A = getAddress('0x1111111111111111111111111111111111111111');
const FEE_B = getAddress('0x2222222222222222222222222222222222222222');
const HASH = `0x${'a'.repeat(64)}` as `0x${string}`;

const recipientsWithFees: BatchExecutionRecipient[] = [
  { address: RECIPIENT, amount: 1 },
  { address: FEE_A, amount: 0.005 },
  { address: FEE_B, amount: 0.005 },
];

const estimateGasMock = vi.fn();
const getGasPriceMock = vi.fn();
const getBalanceMock = vi.fn();
const sendTransactionAsyncMock = vi.fn();
let mockChainId = 314;

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: ACCOUNT as `0x${string}`,
    isConnected: true,
  }),
  useChainId: () => mockChainId,
  usePublicClient: () => ({
    estimateGas: estimateGasMock,
    getGasPrice: getGasPriceMock,
    getBalance: getBalanceMock,
  }),
  useSendTransaction: () => ({
    sendTransactionAsync: sendTransactionAsyncMock,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: undefined,
  }),
}));

function HookHarness({ onValue }: { onValue: (value: UseExecuteBatchReturn) => void }) {
  onValue(useExecuteBatch());
  return null;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useExecuteBatch submit-time balance recheck', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;
  let latestHook: UseExecuteBatchReturn | undefined;

  beforeEach(async () => {
    mockChainId = 314;
    latestHook = undefined;
    estimateGasMock.mockReset();
    getGasPriceMock.mockReset();
    getBalanceMock.mockReset();
    sendTransactionAsyncMock.mockReset();

    estimateGasMock.mockResolvedValue(1_000n);
    getGasPriceMock.mockResolvedValue(10n);
    sendTransactionAsyncMock.mockResolvedValue(HASH);

    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
    });

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<HookHarness onValue={(value) => { latestHook = value; }} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  function getPreparedBatch() {
    return prepareBatchExecution(
      recipientsWithFees,
      'ATOMIC',
      getNetworkConfig('mainnet'),
    );
  }

  async function executeAndCaptureError() {
    let capturedError: unknown;

    await act(async () => {
      try {
        await latestHook?.executeBatch(recipientsWithFees, 'ATOMIC');
      } catch (error) {
        capturedError = error;
      }
    });

    await flushAsyncWork();
    return capturedError;
  }

  it('blocks submit when balance becomes insufficient after review', async () => {
    const prepared = getPreparedBatch();
    const submitNetworkFee = 1_100n * 10n;
    getBalanceMock.mockResolvedValue(prepared.totalValueAttoFil + submitNetworkFee - 1n);

    const capturedError = await executeAndCaptureError();

    expect(capturedError).toBeInstanceOf(BatchExecutionError);
    expect((capturedError as BatchExecutionError).message).toBe(
      'Balance changed. Please review again.',
    );
    expect(sendTransactionAsyncMock).not.toHaveBeenCalled();
    expect(latestHook?.state).toBe('failed');
    expect(latestHook?.error?.category).toBe('INSUFFICIENT_FUNDS');
  });

  it('allows submit when balance still covers transfers, fees, and network fee', async () => {
    const prepared = getPreparedBatch();
    const submitNetworkFee = 1_100n * 10n;
    getBalanceMock.mockResolvedValue(prepared.totalValueAttoFil + submitNetworkFee);

    await act(async () => {
      await expect(latestHook?.executeBatch(recipientsWithFees, 'ATOMIC')).resolves.toBe(HASH);
    });

    expect(getBalanceMock).toHaveBeenCalledWith({ address: ACCOUNT });
    expect(sendTransactionAsyncMock).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsyncMock).toHaveBeenCalledWith({
      to: prepared.batch.to,
      data: prepared.batch.data,
      value: prepared.batch.value,
    });
  });

  it('does not let an unsupported network bypass submit gating', async () => {
    mockChainId = 1;

    await act(async () => {
      root.render(<HookHarness onValue={(value) => { latestHook = value; }} />);
    });

    const capturedError = await executeAndCaptureError();

    expect(capturedError).toBeInstanceOf(BatchExecutionError);
    expect(estimateGasMock).not.toHaveBeenCalled();
    expect(getBalanceMock).not.toHaveBeenCalled();
    expect(sendTransactionAsyncMock).not.toHaveBeenCalled();
  });

  it('keeps the EVM send transaction request unchanged after the recheck passes', async () => {
    const prepared = getPreparedBatch();
    getBalanceMock.mockResolvedValue(prepared.totalValueAttoFil + 1_000_000n);

    await act(async () => {
      await latestHook?.executeBatch(recipientsWithFees, 'ATOMIC');
    });

    expect(estimateGasMock).toHaveBeenCalledWith({
      to: prepared.batch.to,
      data: prepared.batch.data,
      value: prepared.batch.value,
      account: ACCOUNT,
    });
    expect(sendTransactionAsyncMock).toHaveBeenCalledWith({
      to: prepared.batch.to,
      data: prepared.batch.data,
      value: prepared.batch.value,
    });
  });
});
