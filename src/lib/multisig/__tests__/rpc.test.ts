import {
  CoinType,
  newActorAddress,
  newDelegatedAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import { getNetworkConfig } from '../../networks';
import { encodeInvokeEvmParams } from '../../transaction/nativeBatchMessage';
import { buildMulticallBatch } from '../../transaction/multicall';
import { toF4 } from '../../../utils/toF4';
import type { MultisigRpc } from '../rpc';
import {
  getMultisigCodeCid,
  loadMultisigActorState,
  loadMultisigPendingProposals,
  parseEvmCodeResult,
  validateNativeMultisigAddress,
} from '../rpc';

const SIGNER_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();
const MULTISIG_F2 = newActorAddress(
  Uint8Array.from({ length: 16 }, (_, index) => index + 1),
  CoinType.MAIN,
).toString();
const MULTISIG_T2 = newActorAddress(
  Uint8Array.from({ length: 16 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const MULTISIG_CODE = 'bafk2bzaceamultisigactorcode';

function createRpc(): MultisigRpc {
  return {
    getActor: vi.fn(async () => ({
      Code: { '/': MULTISIG_CODE },
      Head: { '/': 'bafyhead' },
      Nonce: 0,
      Balance: '0',
    })),
    readState: vi.fn(async () => ({
      Balance: '3000',
      State: {
        Signers: ['t01001'],
        NumApprovalsThreshold: 1,
        PendingTxns: {},
      },
    })),
    lookupID: vi.fn(async (address: string) => (address === SIGNER_T1 ? 't01001' : address)),
    lookupRobustAddress: vi.fn(async () => MULTISIG_T2),
    getBalance: vi.fn(async () => 3000n),
    getAvailableBalance: vi.fn(async () => 2000n),
    getVestingSchedule: vi.fn(async () => ({
      lockedBalanceAttoFil: 1000n,
    })),
    getPending: vi.fn(async () => []),
    getNetworkVersion: vi.fn(async () => 25),
    getActorCodeCids: vi.fn(async () => ({
      'fil/25/multisig': { '/': MULTISIG_CODE },
    })),
    estimateGas: vi.fn(),
    getEvmCode: vi.fn(async () => '0x' as const),
  };
}

describe('multisig RPC helpers', () => {
  it('validates f2/t2 imports against the selected network', () => {
    expect(() => validateNativeMultisigAddress(MULTISIG_F2, 'mainnet')).not.toThrow();
    expect(() => validateNativeMultisigAddress(MULTISIG_T2, 'calibration')).not.toThrow();
    expect(() => validateNativeMultisigAddress(MULTISIG_F2, 'calibration')).toThrow('t2');
    expect(() => validateNativeMultisigAddress(SIGNER_T1, 'calibration')).toThrow('t2');
    expect(() => validateNativeMultisigAddress('t2abc', 'calibration')).toThrow('t2');
  });

  it('finds the multisig actor code CID from StateActorCodeCIDs output', () => {
    expect(
      getMultisigCodeCid({
        account: { '/': 'bafyaccount' },
        multisig: { '/': MULTISIG_CODE },
      }),
    ).toBe(MULTISIG_CODE);
  });

  it('rejects malformed eth_getCode payloads instead of treating them as EOAs', () => {
    expect(parseEvmCodeResult('0x')).toBe('0x');
    expect(parseEvmCodeResult('0x6000')).toBe('0x6000');
    expect(() => parseEvmCodeResult(null)).toThrow('malformed bytecode');
    expect(() => parseEvmCodeResult('')).toThrow('malformed bytecode');
    expect(() => parseEvmCodeResult('0x0')).toThrow('malformed bytecode');
    expect(() => parseEvmCodeResult('0xzz')).toThrow('malformed bytecode');
  });

  it('compares connected signer membership through StateLookupID', async () => {
    const rpc = createRpc();
    const state = await loadMultisigActorState({
      address: MULTISIG_T2,
      connectedSignerAddress: SIGNER_T1,
      networkKey: 'calibration',
      rpc,
    });

    expect(state.connectedSignerIdAddress).toBe('t01001');
    expect(state.connectedSignerCanApprove).toBe(true);
    expect(state.availableBalanceAttoFil).toBe(2000n);
    expect(state.lockedBalanceAttoFil).toBe(1000n);
  });

  it('rejects a non-multisig CodeCID even when decoded state exposes signers', async () => {
    const rpc = createRpc();
    vi.mocked(rpc.getActor).mockResolvedValueOnce({
      Code: { '/': 'bafynotmultisig' },
      Head: { '/': 'bafyhead' },
      Nonce: 0,
      Balance: '0',
    });

    await expect(
      loadMultisigActorState({
        address: MULTISIG_T2,
        connectedSignerAddress: SIGNER_T1,
        networkKey: 'calibration',
        rpc,
      }),
    ).rejects.toThrow('does not appear to be a Filecoin native multisig');
  });

  it.each([
    {
      label: 'partially malformed signer list',
      state: { Signers: ['t01001', 42], NumApprovalsThreshold: 1 },
    },
    {
      label: 'fractional approval threshold',
      state: { Signers: ['t01001'], NumApprovalsThreshold: 0.5 },
    },
  ])('rejects $label in actor state', async ({ state }) => {
    const rpc = createRpc();
    vi.mocked(rpc.readState).mockResolvedValueOnce({
      Balance: '3000',
      State: state,
    });

    await expect(
      loadMultisigActorState({
        address: MULTISIG_T2,
        connectedSignerAddress: SIGNER_T1,
        networkKey: 'calibration',
        rpc,
      }),
    ).rejects.toThrow('actor state is malformed');
  });

  it('rejects impossible actor balance relationships', async () => {
    const rpc = createRpc();
    vi.mocked(rpc.getAvailableBalance).mockResolvedValueOnce(3001n);

    await expect(
      loadMultisigActorState({
        address: MULTISIG_T2,
        connectedSignerAddress: SIGNER_T1,
        networkKey: 'calibration',
        rpc,
      }),
    ).rejects.toThrow('actor state is malformed');
  });

  it('enables approval only for fully decoded canonical SendFIL proposals', async () => {
    const rpc = createRpc();
    const network = getNetworkConfig('calibration');
    const batch = buildMulticallBatch([{ address: SIGNER_T1, amount: 100n }], 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });
    const multisig = await loadMultisigActorState({
      address: MULTISIG_T2,
      connectedSignerAddress: SIGNER_T1,
      networkKey: 'calibration',
      rpc,
    });

    vi.mocked(rpc.getPending).mockResolvedValueOnce([
      {
        ID: 3,
        To: toF4(network.multicall3Address, 't'),
        Value: batch.value.toString(),
        Method: 3_844_450_837,
        Params: encodeInvokeEvmParams(batch.data),
        Approved: ['t01002'],
        Proposer: 't01002',
      },
      {
        ID: 4,
        To: 't410funknown',
        Value: '100',
        Method: 0,
        Params: '',
        Approved: [],
        Proposer: 't01002',
      },
    ]);

    const proposals = await loadMultisigPendingProposals({
      multisig,
      network,
      connectedSignerAddress: SIGNER_T1,
      rpc,
    });

    expect(proposals[0]?.isSendFilCompatible).toBe(true);
    expect(proposals[0]?.canApprove).toBe(true);
    expect(proposals[0]?.proposalHash).toHaveLength(32);
    expect(proposals[0]?.decodedBatch).toMatchObject({
      executionMethod: 'STANDARD',
      errorMode: 'ATOMIC',
      recipientCount: 1,
      totalValueAttoFil: '100',
    });
    expect(proposals[1]?.isSendFilCompatible).toBe(false);
    expect(proposals[1]?.canApprove).toBe(false);
  });

  it('isolates malformed delegated proposals without hiding safe siblings', async () => {
    const rpc = createRpc();
    const network = getNetworkConfig('calibration');
    const batch = buildMulticallBatch([{ address: SIGNER_T1, amount: 100n }], 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });
    const multisig = await loadMultisigActorState({
      address: MULTISIG_T2,
      connectedSignerAddress: SIGNER_T1,
      networkKey: 'calibration',
      rpc,
    });
    const nonEvmDelegated = newDelegatedAddress(
      11,
      Uint8Array.from({ length: 20 }, (_, index) => index + 1),
      CoinType.TEST,
    ).toString();

    vi.mocked(rpc.getPending).mockResolvedValueOnce([
      {
        ID: 7,
        To: toF4(network.multicall3Address, 't'),
        Value: '100',
        Method: 3_844_450_837,
        Params: '@@@not-base64@@@',
        Approved: ['t01002'],
      },
      {
        ID: 8,
        To: nonEvmDelegated,
        Value: '100',
        Method: 3_844_450_837,
        Params: encodeInvokeEvmParams(batch.data),
        Approved: ['t01002'],
      },
      {
        ID: 9,
        To: toF4(network.multicall3Address, 't'),
        Value: '100',
        Method: 3_844_450_837,
        Params: encodeInvokeEvmParams(batch.data),
        Approved: ['t01002'],
      },
    ]);

    const proposals = await loadMultisigPendingProposals({
      multisig,
      network,
      connectedSignerAddress: SIGNER_T1,
      rpc,
    });

    expect(proposals).toHaveLength(3);
    expect(proposals[0]).toMatchObject({
      id: 7,
      isSendFilCompatible: false,
      canApprove: false,
      compatibilityReason: expect.stringContaining('valid base64'),
    });
    expect(proposals[1]).toMatchObject({
      id: 8,
      isSendFilCompatible: false,
      canApprove: false,
      compatibilityReason: expect.stringContaining('namespace-10'),
    });
    expect(proposals[2]).toMatchObject({
      id: 9,
      isSendFilCompatible: true,
      canApprove: true,
    });
  });

  it('fails a pending proposal closed when its approval list is missing', async () => {
    const rpc = createRpc();
    const network = getNetworkConfig('calibration');
    const batch = buildMulticallBatch([{ address: SIGNER_T1, amount: 100n }], 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });
    const multisig = await loadMultisigActorState({
      address: MULTISIG_T2,
      connectedSignerAddress: SIGNER_T1,
      networkKey: 'calibration',
      rpc,
    });

    vi.mocked(rpc.getPending).mockResolvedValueOnce([
      {
        ID: 12,
        To: toF4(network.multicall3Address, 't'),
        Value: batch.value.toString(),
        Method: 3_844_450_837,
        Params: encodeInvokeEvmParams(batch.data),
        Proposer: 't01001',
      },
    ]);

    const [proposal] = await loadMultisigPendingProposals({
      multisig,
      network,
      connectedSignerAddress: SIGNER_T1,
      rpc,
    });

    expect(proposal).toMatchObject({
      id: 12,
      isSendFilCompatible: false,
      canApprove: false,
      canCancel: true,
      compatibilityReason: expect.stringContaining('approvals are missing or invalid'),
    });
  });

  it('fails closed when a decoded EVM payment has deployed contract code', async () => {
    const rpc = createRpc();
    const network = getNetworkConfig('calibration');
    const contractRecipient = '0x1111111111111111111111111111111111111111';
    const batch = buildMulticallBatch([{ address: contractRecipient, amount: 100n }], 'ATOMIC', {
      multicall3Address: network.multicall3Address,
      filForwarderAddress: network.filForwarderAddress,
    });
    const multisig = await loadMultisigActorState({
      address: MULTISIG_T2,
      connectedSignerAddress: SIGNER_T1,
      networkKey: 'calibration',
      rpc,
    });
    const getEvmCode = rpc.getEvmCode;

    if (!getEvmCode) {
      throw new Error('Expected contract-code mock');
    }

    vi.mocked(getEvmCode).mockResolvedValueOnce('0x6000');
    vi.mocked(rpc.getPending).mockResolvedValueOnce([
      {
        ID: 10,
        To: toF4(network.multicall3Address, 't'),
        Value: batch.value.toString(),
        Method: 3_844_450_837,
        Params: encodeInvokeEvmParams(batch.data),
        Approved: ['t01002'],
        Proposer: 't01001',
      },
    ]);

    const [proposal] = await loadMultisigPendingProposals({
      multisig,
      network,
      connectedSignerAddress: SIGNER_T1,
      rpc,
    });

    expect(proposal).toMatchObject({
      isSendFilCompatible: false,
      canApprove: false,
      canCancel: true,
      compatibilityReason: expect.stringContaining('EVM contract recipients are not supported'),
    });
    expect(rpc.getEvmCode).toHaveBeenCalledWith(contractRecipient, 'calibration');
  });

  it('fails closed when EVM contract-recipient verification is unavailable', async () => {
    const rpc = createRpc();
    const network = getNetworkConfig('calibration');
    const batch = buildMulticallBatch(
      [{ address: '0x2222222222222222222222222222222222222222', amount: 100n }],
      'ATOMIC',
      {
        multicall3Address: network.multicall3Address,
        filForwarderAddress: network.filForwarderAddress,
      },
    );
    const multisig = await loadMultisigActorState({
      address: MULTISIG_T2,
      connectedSignerAddress: SIGNER_T1,
      networkKey: 'calibration',
      rpc,
    });

    delete rpc.getEvmCode;
    vi.mocked(rpc.getPending).mockResolvedValueOnce([
      {
        ID: 11,
        To: toF4(network.multicall3Address, 't'),
        Value: batch.value.toString(),
        Method: 3_844_450_837,
        Params: encodeInvokeEvmParams(batch.data),
        Approved: ['t01002'],
        Proposer: 't01002',
      },
    ]);

    const [proposal] = await loadMultisigPendingProposals({
      multisig,
      network,
      connectedSignerAddress: SIGNER_T1,
      rpc,
    });

    expect(proposal).toMatchObject({
      isSendFilCompatible: false,
      canApprove: false,
      compatibilityReason: expect.stringContaining('Could not verify whether 0x or f4 recipients'),
    });
  });
});
