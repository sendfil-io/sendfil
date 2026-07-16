import type { ExecutionMethod } from '../batchConfiguration';
import { CoinType, Protocol, newFromString } from '@glif/filecoin-address';
import { isCanonicalFilecoinMessageCid } from '../DataProvider/filecoinMessageCid';
import type { SendFilNetworkKey } from '../networks';
import type { ErrorMode } from '../transaction/multicall';

export const NATIVE_SUBMISSION_STORAGE_KEY = 'sendfil.native-submissions.v1';

interface NativeSubmissionRecordBase {
  cid: string;
  identity: string;
  networkKey: SendFilNetworkKey;
  signerAddress: string;
  providerId: string;
  errorMode: ErrorMode;
  executionMethod: ExecutionMethod;
  createdAt: number;
}

export interface NativeBatchSubmissionRecord extends NativeSubmissionRecordBase {
  kind: 'native-batch';
  recipientCount: number;
  totalValueAttoFil: string;
}

export interface MultisigProposalSubmissionRecord
  extends NativeSubmissionRecordBase {
  kind: 'multisig-proposal';
  multisigAddress: string;
  recipientCount: number;
  totalValueAttoFil: string;
}

export type NativeSubmissionRecord =
  | NativeBatchSubmissionRecord
  | MultisigProposalSubmissionRecord;

export interface NativeSubmissionStorageReadResult {
  records: NativeSubmissionRecord[];
  error?: string;
}

interface StorageResolution {
  storage?: Storage;
  error?: string;
}

const STORAGE_READ_ERROR =
  'SendFIL could not safely read its pending native submission record. Restore browser storage access or clear the malformed safety record only after inspecting recent wallet messages.';

const STORAGE_WRITE_ERROR =
  'SendFIL could not save its native submission safety lock. No native message was signed; restore browser storage access and try again.';

const STORAGE_UPDATE_ERROR =
  'SendFIL could not update its native submission safety lock. Keep this page open and inspect the recorded CID before retrying.';

const STORAGE_CONFLICT_ERROR =
  'Another unresolved native submission already exists. Inspect and reconcile its CID before signing another native message.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveStorage(storage?: Storage): StorageResolution {
  if (storage) {
    return { storage };
  }

  if (typeof window === 'undefined') {
    return { error: STORAGE_READ_ERROR };
  }

  try {
    return { storage: window.localStorage };
  } catch {
    return { error: STORAGE_READ_ERROR };
  }
}

export function getNativeBatchSubmissionIdentity({
  networkKey,
  signerAddress,
}: {
  networkKey: SendFilNetworkKey;
  signerAddress: string;
}): string {
  return `native-batch:${networkKey}:${signerAddress}`;
}

export function getMultisigProposalSubmissionIdentity({
  networkKey,
  signerAddress,
  multisigAddress,
}: {
  networkKey: SendFilNetworkKey;
  signerAddress: string;
  multisigAddress: string;
}): string {
  return `multisig-proposal:${networkKey}:${multisigAddress}:${signerAddress}`;
}

function parseNetworkKey(value: unknown): SendFilNetworkKey | undefined {
  return value === 'mainnet' || value === 'calibration' ? value : undefined;
}

function isCanonicalNativeAddress(
  value: unknown,
  networkKey: SendFilNetworkKey,
  protocol: Protocol,
): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = newFromString(value);
    const expectedCoinType =
      networkKey === 'mainnet' ? CoinType.MAIN : CoinType.TEST;

    return (
      parsed.protocol() === protocol &&
      parsed.coinType() === expectedCoinType &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function parseBaseRecord(
  value: Record<string, unknown>,
): Omit<NativeSubmissionRecordBase, 'identity'> | undefined {
  const networkKey = parseNetworkKey(value.networkKey);

  if (!networkKey) {
    return undefined;
  }

  if (
    !isCanonicalFilecoinMessageCid(value.cid) ||
    !isCanonicalNativeAddress(
      value.signerAddress,
      networkKey,
      Protocol.SECP256K1,
    ) ||
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    (value.errorMode !== 'ATOMIC' && value.errorMode !== 'PARTIAL') ||
    (value.executionMethod !== 'STANDARD' && value.executionMethod !== 'THINBATCH') ||
    !Number.isSafeInteger(value.createdAt) ||
    Number(value.createdAt) < 0
  ) {
    return undefined;
  }

  return {
    cid: value.cid,
    networkKey,
    signerAddress: value.signerAddress,
    providerId: value.providerId,
    errorMode: value.errorMode,
    executionMethod: value.executionMethod,
    createdAt: Number(value.createdAt),
  };
}

function sanitizeRecord(value: unknown): NativeSubmissionRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const base = parseBaseRecord(value);

  if (!base) {
    return undefined;
  }

  if (value.kind === 'native-batch') {
    if (
      !Number.isInteger(value.recipientCount) ||
      Number(value.recipientCount) < 1 ||
      typeof value.totalValueAttoFil !== 'string' ||
      !/^\d+$/.test(value.totalValueAttoFil)
    ) {
      return undefined;
    }

    const identity = getNativeBatchSubmissionIdentity(base);

    if (value.identity !== identity) {
      return undefined;
    }

    return {
      ...base,
      kind: 'native-batch',
      identity,
      recipientCount: Number(value.recipientCount),
      totalValueAttoFil: value.totalValueAttoFil,
    };
  }

  if (value.kind === 'multisig-proposal') {
    if (
      !isCanonicalNativeAddress(
        value.multisigAddress,
        base.networkKey,
        Protocol.ACTOR,
      ) ||
      !Number.isInteger(value.recipientCount) ||
      Number(value.recipientCount) < 1 ||
      typeof value.totalValueAttoFil !== 'string' ||
      !/^\d+$/.test(value.totalValueAttoFil)
    ) {
      return undefined;
    }

    const identity = getMultisigProposalSubmissionIdentity({
      ...base,
      multisigAddress: value.multisigAddress,
    });

    if (value.identity !== identity) {
      return undefined;
    }

    return {
      ...base,
      kind: 'multisig-proposal',
      identity,
      multisigAddress: value.multisigAddress,
      recipientCount: Number(value.recipientCount),
      totalValueAttoFil: value.totalValueAttoFil,
    };
  }

  return undefined;
}

export function readNativeSubmissionRecords(
  storage?: Storage,
): NativeSubmissionStorageReadResult {
  const resolution = resolveStorage(storage);

  if (resolution.error || !resolution.storage) {
    return { records: [], error: resolution.error ?? STORAGE_READ_ERROR };
  }

  try {
    const rawValue = resolution.storage.getItem(NATIVE_SUBMISSION_STORAGE_KEY);

    if (rawValue === null) {
      return { records: [] };
    }

    const parsed: unknown = JSON.parse(rawValue);

    if (!isRecord(parsed) || !Array.isArray(parsed.records)) {
      return { records: [], error: STORAGE_READ_ERROR };
    }

    const records = parsed.records
      .map(sanitizeRecord)
      .filter((record): record is NativeSubmissionRecord => Boolean(record));

    if (records.length !== parsed.records.length) {
      return { records: [], error: STORAGE_READ_ERROR };
    }

    const identities = new Set(records.map((record) => record.identity));

    if (identities.size !== records.length || records.length > 1) {
      return { records: [], error: STORAGE_READ_ERROR };
    }

    return { records };
  } catch {
    return { records: [], error: STORAGE_READ_ERROR };
  }
}

export function verifyNativeSubmissionStorage(
  storage?: Storage,
): string | undefined {
  const resolution = resolveStorage(storage);

  if (resolution.error || !resolution.storage) {
    return STORAGE_WRITE_ERROR;
  }

  const current = readNativeSubmissionRecords(resolution.storage);

  if (current.error) {
    return current.error;
  }

  try {
    resolution.storage.setItem(
      NATIVE_SUBMISSION_STORAGE_KEY,
      JSON.stringify({ records: current.records }),
    );
    return undefined;
  } catch {
    return STORAGE_WRITE_ERROR;
  }
}

export function writeNativeSubmissionRecord(
  record: NativeSubmissionRecord,
  storage?: Storage,
): string | undefined {
  const resolution = resolveStorage(storage);

  if (resolution.error || !resolution.storage) {
    return STORAGE_UPDATE_ERROR;
  }

  const current = readNativeSubmissionRecords(resolution.storage);

  if (current.error) {
    return current.error;
  }

  const sanitizedRecord = sanitizeRecord(record);

  if (!sanitizedRecord) {
    return STORAGE_UPDATE_ERROR;
  }

  const existing = current.records[0];

  if (
    existing &&
    (existing.identity !== sanitizedRecord.identity || existing.cid !== sanitizedRecord.cid)
  ) {
    return STORAGE_CONFLICT_ERROR;
  }

  try {
    const records = current.records.filter(
      (candidate) => candidate.identity !== sanitizedRecord.identity,
    );
    records.push(sanitizedRecord);
    resolution.storage.setItem(
      NATIVE_SUBMISSION_STORAGE_KEY,
      JSON.stringify({ records }),
    );
    return undefined;
  } catch {
    return STORAGE_UPDATE_ERROR;
  }
}

export function removeNativeSubmissionRecord(
  identity: string,
  cid: string,
  storage?: Storage,
): string | undefined {
  const resolution = resolveStorage(storage);

  if (resolution.error || !resolution.storage) {
    return STORAGE_UPDATE_ERROR;
  }

  const current = readNativeSubmissionRecords(resolution.storage);

  if (current.error) {
    return current.error;
  }

  if (!isCanonicalFilecoinMessageCid(cid)) {
    return STORAGE_CONFLICT_ERROR;
  }

  if (
    current.records.some(
      (record) => record.identity !== identity || record.cid !== cid,
    )
  ) {
    return STORAGE_CONFLICT_ERROR;
  }

  try {
    resolution.storage.setItem(
      NATIVE_SUBMISSION_STORAGE_KEY,
      JSON.stringify({
        records: current.records.filter(
          (record) => record.identity !== identity || record.cid !== cid,
        ),
      }),
    );
    return undefined;
  } catch {
    return STORAGE_UPDATE_ERROR;
  }
}
