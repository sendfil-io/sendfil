import {
  CoinType,
  newActorAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import { getNetworkConfig } from '../../networks';
import { toF4 } from '../../../utils/toF4';
import type { MultisigRpc } from '../rpc';
import {
  getMultisigCodeCid,
  loadMultisigActorState,
  loadMultisigPendingProposals,
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
    lookupID: vi.fn(async (address: string) =>
      address === SIGNER_T1 ? 't01001' : address,
    ),
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

  it('enables approval only for compatible SendFIL proposals targeting known contracts', async () => {
    const rpc = createRpc();
    const network = getNetworkConfig('calibration');
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
        Value: '100',
        Method: 3_844_450_837,
        Params: 'RBI0',
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
    expect(proposals[1]?.isSendFilCompatible).toBe(false);
    expect(proposals[1]?.canApprove).toBe(false);
  });
});
