import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { describe, expect, it, vi } from 'vitest';
import type { FilecoinMessage } from '../../DataProvider/types';
import { getNetworkConfig } from '../../networks';
import type { NativeFilecoinConnectedSender } from '../../senders';
import { preflightCreateMultisig } from '../preflight';
import { buildCreateMultisigMessage } from '../proposalBuilder';
import type { MultisigRpc } from '../rpc';

const CREATOR = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const SECOND_SIGNER = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();
const MANIFEST_CID = 'bafy2bzaceb22zyxdtqlmveumv7qibp6ncrwmfuskzldj2qiudmvn7bfeeaur6';
const HEAD_CID = 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';
const HEAD_TIPSET_KEY = [{ '/': HEAD_CID }] as const;
const MULTISIG_CODE_CID =
  'bafk2bzacechrsbw65ojbktr63swju5g7275fl3lxminrz7damr4me6wq6fjxm';
const ONE_ENTRY_MANIFEST_BASE64 =
  'gYJobXVsdGlzaWfYKlgnAAFVoOQCII8ZBt7rkhVOPtysmnTf1/pV7XdiGxz8YGR4wnrQ8VN2';

function createSender(): NativeFilecoinConnectedSender {
  const network = getNetworkConfig('calibration');

  return {
    kind: 'native-filecoin',
    address: CREATOR,
    chainId: network.chainId,
    networkKey: network.key,
    nativePrefix: network.nativePrefix,
    network,
    networkStatus: 'supported',
    canSignBatch: true,
    provider: {
      id: 'preflight-test',
      name: 'Preflight test',
      kind: 'native-filecoin-wallet',
      status: 'available',
      capabilities: {
        canConnect: true,
        canDisconnect: true,
        canDetectNetwork: true,
        canReadBalance: true,
        canSignBatch: true,
        canSubmit: true,
        oneApprovalPerBatch: true,
      },
    },
  };
}

function createManifestRpc() {
  const readState = vi.fn(async () => ({
    Balance: '0',
    State: { BuiltinActors: { '/': MANIFEST_CID } },
  }));
  const readObject = vi.fn(async () => ONE_ENTRY_MANIFEST_BASE64);
  const multisigRpc: MultisigRpc = {
    getChainHead: vi.fn(async () => ({ Cids: HEAD_TIPSET_KEY, Height: 1 })),
    readState,
    lookupID: vi.fn(async (address: string) => address),
    getAvailableBalance: vi.fn(async () => 0n),
    getVestingSchedule: vi.fn(async () => undefined),
    getPending: vi.fn(async () => []),
    readObject,
    estimateGas: vi.fn(async (message: FilecoinMessage) => message),
    getEvmCode: vi.fn(async () => '0x' as const),
  };

  return { multisigRpc, readObject, readState };
}

describe('multisig create preflight', () => {
  it('embeds the active-network manifest CodeCID and keeps nonce, manifest, and gas on that network', async () => {
    const sender = createSender();
    const signers = [CREATOR, SECOND_SIGNER];
    const initialDepositAttoFil = 500_000_000_000_000_000n;
    const nonce = 17;
    const getNonce = vi.fn(async () => nonce);
    const estimateGas = vi.fn(async (message: FilecoinMessage) => ({
      ...message,
      GasLimit: 123_456,
      GasFeeCap: '789',
      GasPremium: '12',
    }));
    const { multisigRpc, readObject, readState } = createManifestRpc();

    const result = await preflightCreateMultisig({
      sender,
      signers,
      threshold: 2,
      initialDepositAttoFil,
      rpc: { getNonce, estimateGas, multisig: multisigRpc },
    });
    const expectedDraft = buildCreateMultisigMessage({
      sender,
      nonce,
      signers,
      threshold: 2,
      initialDepositAttoFil,
      multisigActorCodeCid: MULTISIG_CODE_CID,
    });
    const expectedEstimated = buildCreateMultisigMessage({
      sender,
      nonce,
      signers,
      threshold: 2,
      initialDepositAttoFil,
      multisigActorCodeCid: MULTISIG_CODE_CID,
      gas: {
        gasLimit: 123_456,
        gasFeeCap: '789',
        gasPremium: '12',
      },
    });

    expect(getNonce).toHaveBeenCalledWith(CREATOR, 'calibration');
    expect(readState).toHaveBeenCalledWith('t00', 'calibration', HEAD_TIPSET_KEY);
    expect(readObject).toHaveBeenCalledWith({ '/': MANIFEST_CID }, 'calibration');
    expect(estimateGas).toHaveBeenCalledWith(expectedDraft, 'calibration');
    expect(result.multisigActorCodeCid).toBe(MULTISIG_CODE_CID);
    expect(result.draftMessage).toEqual(expectedDraft);
    expect(result.estimatedMessage).toEqual(expectedEstimated);
  });
});
