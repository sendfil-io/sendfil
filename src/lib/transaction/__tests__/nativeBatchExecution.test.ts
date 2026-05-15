import {
  CoinType,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import { getNetworkConfig } from '../../networks';
import type {
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
  SenderProviderMetadata,
} from '../../senders';
import type { PreparedBatchExecution } from '../batchExecution';
import { submitPreparedNativeBatch } from '../nativeBatchExecution';
import {
  INVOKE_EVM_METHOD_NUMBER,
  type PreparedNativeBatchMessage,
} from '../nativeBatchMessage';
import type { PreparedNativeBatchPreflight } from '../nativeBatchPreflight';

const CALIBRATION_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

const FILSNAP_METADATA: SenderProviderMetadata & { kind: 'native-filecoin-wallet' } = {
  id: 'filsnap-calibration',
  name: 'FilSnap Calibration',
  kind: 'native-filecoin-wallet',
  status: 'available',
  capabilities: {
    canConnect: true,
    canDisconnect: false,
    canDetectNetwork: true,
    canReadBalance: true,
    canSignBatch: true,
    canSubmit: true,
    oneApprovalPerBatch: true,
  },
};

function createSender(address = CALIBRATION_T1): NativeFilecoinConnectedSender {
  const network = getNetworkConfig('calibration');

  return {
    kind: 'native-filecoin',
    address,
    chainId: network.chainId,
    networkKey: network.key,
    nativePrefix: network.nativePrefix,
    network,
    networkStatus: 'supported',
    canSignBatch: true,
    provider: FILSNAP_METADATA,
  };
}

function createPreflight(
  sender: NativeFilecoinConnectedSender = createSender(),
): PreparedNativeBatchPreflight {
  const preparedBatch: PreparedBatchExecution = {
    batch: {
      to: getNetworkConfig('calibration').multicall3Address,
      data: '0x1234',
      value: 100n,
      calls: [],
      recipientCount: 1,
    },
    errorMode: 'PARTIAL',
    recipients: [{ address: 't1recipient', amount: 100 }],
    recipientCount: 1,
    totalValueAttoFil: 100n,
    networkKey: 'calibration',
    chainId: 314159,
  };
  const message = {
    Version: 0,
    To: 't410f2lpnnzscfg4zbfo5verki2as6tpsrmb6m4a2lby',
    From: sender.address,
    Nonce: 1,
    Value: '100',
    GasLimit: 10,
    GasFeeCap: '2',
    GasPremium: '1',
    Method: INVOKE_EVM_METHOD_NUMBER,
    Params: 'RA==',
  };
  const nativeMessage: PreparedNativeBatchMessage = {
    message,
    sender,
    preparedBatch,
    targetEvmAddress: preparedBatch.batch.to,
    targetFilecoinAddress: message.To,
    method: INVOKE_EVM_METHOD_NUMBER,
    paramsCodec: 'cbor-bytes-base64',
  };

  return {
    sender,
    preparedBatch,
    nonce: 1,
    draftNativeMessage: nativeMessage,
    estimatedNativeMessage: nativeMessage,
    gasEstimate: {
      gasLimit: 10n,
      gasFeeCap: 2n,
      gasPremium: 1n,
      estimatedFee: 20n,
    },
  };
}

function createProvider({
  accountAddress = CALIBRATION_T1,
  balance = 120n,
}: {
  accountAddress?: string;
  balance?: bigint;
} = {}): NativeFilecoinWalletProvider {
  return {
    metadata: FILSNAP_METADATA,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getAccount: vi.fn(async () => ({
      address: accountAddress,
      networkKey: 'calibration' as const,
      nativePrefix: 't' as const,
    })),
    getBalance: vi.fn(async () => balance),
    signAndSubmitMessage: vi.fn(async () => ({ cid: 'bafy2bzacednativecid' })),
  };
}

describe('native batch execution', () => {
  it('rechecks native balance, submits one prepared message, and polls Calibration status', async () => {
    const provider = createProvider();
    const onSubmitted = vi.fn();
    const pollStatus = vi.fn(async () => ({
      cid: 'bafy2bzacednativecid',
      status: 'confirmed' as const,
    }));
    const preflight = createPreflight();

    const result = await submitPreparedNativeBatch({
      preflight,
      provider,
      network: getNetworkConfig('calibration'),
      errorMode: 'PARTIAL',
      pollStatus,
      pollIntervalMs: 0,
      onSubmitted,
    });

    expect(provider.getBalance).toHaveBeenCalledWith({
      address: CALIBRATION_T1,
      networkKey: 'calibration',
      nativePrefix: 't',
    });
    expect(provider.signAndSubmitMessage).toHaveBeenCalledWith(
      preflight.estimatedNativeMessage.message,
    );
    expect(onSubmitted).toHaveBeenCalledWith({ cid: 'bafy2bzacednativecid' });
    expect(pollStatus).toHaveBeenCalledWith(
      'bafy2bzacednativecid',
      60,
      0,
      'calibration',
    );
    expect(result.status.status).toBe('confirmed');
  });

  it('blocks native submit when the reviewed sender changed before signing', async () => {
    const provider = createProvider({ accountAddress: `${CALIBRATION_T1.slice(0, -1)}a` });

    await expect(
      submitPreparedNativeBatch({
        preflight: createPreflight(),
        provider,
        network: getNetworkConfig('calibration'),
        errorMode: 'PARTIAL',
      }),
    ).rejects.toThrow('The connected native Filecoin sender changed after review');
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
  });

  it('blocks native submit before signing when submit-time balance is insufficient', async () => {
    const provider = createProvider({ balance: 119n });

    await expect(
      submitPreparedNativeBatch({
        preflight: createPreflight(),
        provider,
        network: getNetworkConfig('calibration'),
        errorMode: 'PARTIAL',
      }),
    ).rejects.toThrow('Balance changed. Please review again.');
    expect(provider.signAndSubmitMessage).not.toHaveBeenCalled();
  });
});
