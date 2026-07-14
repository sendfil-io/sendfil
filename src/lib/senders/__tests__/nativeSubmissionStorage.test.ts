import { describe, expect, it } from 'vitest';
import {
  CoinType,
  newActorAddress,
  newSecp256k1Address,
} from '@glif/filecoin-address';
import {
  NATIVE_SUBMISSION_STORAGE_KEY,
  getNativeBatchSubmissionIdentity,
  getMultisigProposalSubmissionIdentity,
  readNativeSubmissionRecords,
  removeNativeSubmissionRecord,
  writeNativeSubmissionRecord,
  type NativeBatchSubmissionRecord,
  type MultisigProposalSubmissionRecord,
} from '../nativeSubmissionStorage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const SIGNER = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const MULTISIG = newActorAddress(
  Uint8Array.from({ length: 20 }, (_, index) => index + 1),
  CoinType.TEST,
).toString();
const NATIVE_CID = 'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';
const PROPOSAL_CID = 'bafy2bzacebpekbxp7qyk4xx5r7es3t77sqcgdq5c7osfow4ayvbyyafwl4sxk';
const OTHER_CID = 'bafy2bzacecltcibo6i2aewv7b3fz4f7cie26c5jminwhxs7iuttgzbtaptvui';

function nativeRecord(cid = NATIVE_CID): NativeBatchSubmissionRecord {
  const identity = getNativeBatchSubmissionIdentity({
    networkKey: 'calibration',
    signerAddress: SIGNER,
  });

  return {
    kind: 'native-batch',
    identity,
    cid,
    networkKey: 'calibration',
    signerAddress: SIGNER,
    providerId: 'filsnap',
    errorMode: 'ATOMIC',
    executionMethod: 'STANDARD',
    recipientCount: 2,
    totalValueAttoFil: '123',
    createdAt: 1,
  };
}

function proposalRecord(): MultisigProposalSubmissionRecord {
  const identity = getMultisigProposalSubmissionIdentity({
    networkKey: 'calibration',
    signerAddress: SIGNER,
    multisigAddress: MULTISIG,
  });

  return {
    kind: 'multisig-proposal',
    identity,
    cid: PROPOSAL_CID,
    networkKey: 'calibration',
    signerAddress: SIGNER,
    providerId: 'ledger-filecoin',
    multisigAddress: MULTISIG,
    errorMode: 'PARTIAL',
    executionMethod: 'THINBATCH',
    recipientCount: 3,
    totalValueAttoFil: '456',
    createdAt: 2,
  };
}

describe('native submission safety storage', () => {
  it('round-trips both record kinds and removes only an exact identity/CID pair', () => {
    const nativeStorage = new MemoryStorage();
    const proposalStorage = new MemoryStorage();
    const native = nativeRecord();
    const proposal = proposalRecord();

    expect(writeNativeSubmissionRecord(native, nativeStorage)).toBeUndefined();
    expect(writeNativeSubmissionRecord(proposal, proposalStorage)).toBeUndefined();
    expect(readNativeSubmissionRecords(nativeStorage)).toEqual({ records: [native] });
    expect(readNativeSubmissionRecords(proposalStorage)).toEqual({ records: [proposal] });

    expect(
      removeNativeSubmissionRecord(native.identity, OTHER_CID, nativeStorage),
    ).toContain('Another unresolved native submission');
    expect(readNativeSubmissionRecords(nativeStorage).records).toContainEqual(native);

    expect(
      removeNativeSubmissionRecord(native.identity, native.cid, nativeStorage),
    ).toBeUndefined();
    expect(readNativeSubmissionRecords(nativeStorage).records).toEqual([]);
  });

  it('fails closed on empty, malformed, or noncanonical stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem(NATIVE_SUBMISSION_STORAGE_KEY, '');
    expect(readNativeSubmissionRecords(storage).error).toBeTruthy();

    storage.setItem(
      NATIVE_SUBMISSION_STORAGE_KEY,
      JSON.stringify({
        records: [{ ...nativeRecord(), signerAddress: 't1not-an-address' }],
      }),
    );
    expect(readNativeSubmissionRecords(storage).error).toBeTruthy();

    storage.setItem(
      NATIVE_SUBMISSION_STORAGE_KEY,
      JSON.stringify({ records: [{ ...nativeRecord(), cid: 'bafy2bzacednativeone' }] }),
    );
    expect(readNativeSubmissionRecords(storage).error).toBeTruthy();

    const cleanStorage = new MemoryStorage();
    expect(
      writeNativeSubmissionRecord(nativeRecord('bafy2bzacednativeone'), cleanStorage),
    ).toContain('could not update');
    expect(readNativeSubmissionRecords(cleanStorage).records).toEqual([]);
  });

  it('does not let another provider overwrite the same signer identity with a new CID', () => {
    const storage = new MemoryStorage();
    const first = nativeRecord();
    const second = {
      ...nativeRecord(OTHER_CID),
      providerId: 'ledger-filecoin',
    };

    expect(writeNativeSubmissionRecord(first, storage)).toBeUndefined();
    expect(writeNativeSubmissionRecord(second, storage)).toContain(
      'Another unresolved native submission',
    );
    expect(readNativeSubmissionRecords(storage).records).toEqual([first]);
  });

  it('allows at most one unresolved native submission across operation identities', () => {
    const storage = new MemoryStorage();
    const native = nativeRecord();
    const proposal = proposalRecord();

    expect(writeNativeSubmissionRecord(native, storage)).toBeUndefined();
    expect(writeNativeSubmissionRecord(proposal, storage)).toContain(
      'Another unresolved native submission',
    );
    expect(readNativeSubmissionRecords(storage).records).toEqual([native]);
  });
});
