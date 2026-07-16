import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinType, newActorAddress, newSecp256k1Address } from '@glif/filecoin-address';
import {
  MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY,
  readUncertainMultisigActions,
  removeUncertainCreateAction,
  upsertUncertainCreateAction,
  upsertUncertainProposalAction,
  writeUncertainMultisigActions,
} from '../actionStorage';
import type { MultisigCreateActionState, MultisigProposalActionState } from '../useMultisigs';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const SIGNER = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 10),
  CoinType.TEST,
).toString();
const MULTISIG = newActorAddress(
  Uint8Array.from({ length: 16 }, (_, index) => index + 80),
  CoinType.TEST,
).toString() as MultisigProposalActionState['multisigAddress'];
const CREATE_CID = 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';
const PROPOSAL_CID = 'bafy2bzacebpekbxp7qyk4xx5r7es3t77sqcgdq5c7osfow4ayvbyyafwl4sxk';
const OTHER_CID = 'bafy2bzacecltcibo6i2aewv7b3fz4f7cie26c5jminwhxs7iuttgzbtaptvui';

const CREATE_STATE: MultisigCreateActionState = {
  networkKey: 'calibration',
  chainId: 314159,
  networkLabel: 'Calibration Testnet',
  signerAddress: SIGNER,
  status: 'uncertain',
  cid: CREATE_CID,
  warning: 'Inspect before retrying.',
};

const PROPOSAL_STATE: MultisigProposalActionState = {
  action: 'approve',
  proposalId: 7,
  multisigAddress: MULTISIG,
  networkKey: 'calibration',
  chainId: 314159,
  networkLabel: 'Calibration Testnet',
  signerAddress: SIGNER,
  status: 'uncertain',
  cid: PROPOSAL_CID,
  error: 'Inspect before retrying.',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uncertain multisig action storage', () => {
  it('round-trips identity and CID records used to prevent duplicate submissions', () => {
    const storage = new MemoryStorage();

    expect(
      writeUncertainMultisigActions([CREATE_STATE], [PROPOSAL_STATE], storage),
    ).toBeUndefined();
    expect(readUncertainMultisigActions(storage)).toEqual({
      creates: [CREATE_STATE],
      proposals: [PROPOSAL_STATE],
    });
  });

  it.each(['', '{not-json'])('fails closed for a malformed safety record: %j', (rawValue) => {
    const storage = new MemoryStorage();
    storage.setItem(MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY, rawValue);

    const result = readUncertainMultisigActions(storage);

    expect(result.creates).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.error).toContain('could not safely read');
  });

  it('fails closed when a persisted identity only resembles a Filecoin address', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY,
      JSON.stringify({
        creates: [{ ...CREATE_STATE, signerAddress: 't1bogus' }],
        proposals: [],
      }),
    );

    expect(readUncertainMultisigActions(storage).error).toContain('could not safely read');
  });

  it('fails closed for a fake message CID on read and write', () => {
    const storage = new MemoryStorage();
    const invalidState = { ...CREATE_STATE, cid: 'bafycreate' };

    storage.setItem(
      MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY,
      JSON.stringify({ creates: [invalidState], proposals: [] }),
    );
    expect(readUncertainMultisigActions(storage).error).toContain('could not safely read');
    expect(writeUncertainMultisigActions([invalidState], [], storage)).toContain(
      'could not save',
    );
  });

  it('fails closed when one logical identity has multiple unresolved CIDs', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY,
      JSON.stringify({
        creates: [CREATE_STATE, { ...CREATE_STATE, cid: OTHER_CID }],
        proposals: [],
      }),
    );

    expect(readUncertainMultisigActions(storage).error).toContain('could not safely read');
  });

  it('merges stale-client writes and compare-clears only the matching identity and CID', () => {
    const storage = new MemoryStorage();

    expect(upsertUncertainCreateAction(CREATE_STATE, storage).error).toBeUndefined();
    expect(upsertUncertainProposalAction(PROPOSAL_STATE, storage).error).toBeUndefined();
    expect(readUncertainMultisigActions(storage)).toMatchObject({
      creates: [CREATE_STATE],
      proposals: [PROPOSAL_STATE],
    });

    const conflict = upsertUncertainCreateAction(
      { ...CREATE_STATE, cid: OTHER_CID },
      storage,
    );
    expect(conflict.error).toContain('different CID');
    expect(
      removeUncertainCreateAction({ ...CREATE_STATE, cid: OTHER_CID }, storage).error,
    ).toContain('different CID');
    expect(readUncertainMultisigActions(storage).creates).toEqual([CREATE_STATE]);

    expect(removeUncertainCreateAction(CREATE_STATE, storage).error).toBeUndefined();
    expect(readUncertainMultisigActions(storage)).toMatchObject({
      creates: [],
      proposals: [PROPOSAL_STATE],
    });
  });

  it('reports browser localStorage getter failures for both reads and writes', () => {
    const inaccessibleWindow = Object.defineProperty({}, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    vi.stubGlobal('window', inaccessibleWindow);

    expect(readUncertainMultisigActions().error).toContain('could not safely read');
    expect(writeUncertainMultisigActions([CREATE_STATE], [PROPOSAL_STATE])).toContain(
      'could not save the uncertainty safety lock',
    );
  });
});
