import { getNetworkConfig, type SendFilNetworkKey } from '../networks';
import { Protocol, newFromString } from '@glif/filecoin-address';
import { isCanonicalFilecoinMessageCid } from '../DataProvider/filecoinMessageCid';
import type { MultisigCreateActionState, MultisigProposalActionState } from './useMultisigs';

export const MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY = 'sendfil.multisig-uncertain-actions.v1';

export interface MultisigUncertainActionSnapshot {
  creates: MultisigCreateActionState[];
  proposals: MultisigProposalActionState[];
  error?: string;
}

export interface MultisigUncertainActionMutationResult {
  snapshot: MultisigUncertainActionSnapshot;
  error?: string;
}

interface StoredUncertainActions {
  creates: unknown[];
  proposals: unknown[];
}

interface StorageResolution {
  storage?: Storage;
  error?: string;
}

const STORAGE_READ_ERROR =
  'SendFIL could not safely read its saved uncertain multisig actions. Restore browser storage access or clear the malformed safety record only after inspecting recent wallet messages, then reload SendFIL.';

const STORAGE_WRITE_ERROR =
  'SendFIL could not save the uncertainty safety lock in this browser. Keep this page open and inspect the submitted message before retrying.';
const STORAGE_CONFLICT_ERROR =
  'Another unresolved multisig action with a different CID already exists for this identity. Inspect both browser tabs and submitted messages before continuing.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveStorage(storage?: Storage): StorageResolution {
  if (storage) {
    return { storage };
  }

  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const browserStorage = window.localStorage;
    return browserStorage ? { storage: browserStorage } : { error: STORAGE_READ_ERROR };
  } catch {
    return { error: STORAGE_READ_ERROR };
  }
}

function parseNetworkKey(value: unknown): SendFilNetworkKey | undefined {
  return value === 'mainnet' || value === 'calibration' ? value : undefined;
}

function isCanonicalAddress(
  value: unknown,
  networkKey: SendFilNetworkKey,
  protocol: Protocol,
): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = newFromString(value);
    const network = getNetworkConfig(networkKey);
    return (
      parsed.protocol() === protocol &&
      parsed.coinType() === network.coinType &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function sanitizeCreateAction(value: unknown): MultisigCreateActionState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const networkKey = parseNetworkKey(value.networkKey);

  if (!networkKey) {
    return undefined;
  }

  const network = getNetworkConfig(networkKey);

  if (
    value.status !== 'uncertain' ||
    !isCanonicalFilecoinMessageCid(value.cid) ||
    !isCanonicalAddress(value.signerAddress, networkKey, Protocol.SECP256K1) ||
    typeof value.warning !== 'string'
  ) {
    return undefined;
  }

  return {
    networkKey,
    chainId: network.chainId,
    networkLabel: network.walletLabel,
    signerAddress: value.signerAddress,
    status: 'uncertain',
    cid: value.cid,
    warning: value.warning,
  };
}

function sanitizeProposalAction(value: unknown): MultisigProposalActionState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const networkKey = parseNetworkKey(value.networkKey);

  if (!networkKey) {
    return undefined;
  }

  const network = getNetworkConfig(networkKey);

  if (
    value.status !== 'uncertain' ||
    (value.action !== 'approve' && value.action !== 'cancel') ||
    !Number.isInteger(value.proposalId) ||
    Number(value.proposalId) < 0 ||
    !isCanonicalFilecoinMessageCid(value.cid) ||
    !isCanonicalAddress(value.signerAddress, networkKey, Protocol.SECP256K1) ||
    !isCanonicalAddress(value.multisigAddress, networkKey, Protocol.ACTOR) ||
    typeof value.error !== 'string'
  ) {
    return undefined;
  }

  return {
    action: value.action,
    proposalId: Number(value.proposalId),
    multisigAddress: value.multisigAddress as MultisigProposalActionState['multisigAddress'],
    networkKey,
    chainId: network.chainId,
    networkLabel: network.walletLabel,
    signerAddress: value.signerAddress,
    status: 'uncertain',
    cid: value.cid,
    error: value.error,
  };
}

export function getCreateUncertainActionIdentity(state: MultisigCreateActionState): string {
  return `${state.networkKey}:${state.signerAddress}`;
}

export function getProposalUncertainActionIdentity(state: MultisigProposalActionState): string {
  return `${state.networkKey}:${state.multisigAddress}:${state.signerAddress}`;
}

function parseStore(rawValue: string | null): { store: StoredUncertainActions; error?: string } {
  if (rawValue === null) {
    return { store: { creates: [], proposals: [] } };
  }

  try {
    const value: unknown = JSON.parse(rawValue);

    if (!isRecord(value) || !Array.isArray(value.creates) || !Array.isArray(value.proposals)) {
      return {
        store: { creates: [], proposals: [] },
        error: STORAGE_READ_ERROR,
      };
    }

    return {
      store: {
        creates: value.creates,
        proposals: value.proposals,
      },
    };
  } catch {
    return {
      store: { creates: [], proposals: [] },
      error: STORAGE_READ_ERROR,
    };
  }
}

export function readUncertainMultisigActions(storage?: Storage): MultisigUncertainActionSnapshot {
  const resolution = resolveStorage(storage);

  if (resolution.error) {
    return { creates: [], proposals: [], error: resolution.error };
  }

  if (!resolution.storage) {
    return { creates: [], proposals: [] };
  }

  try {
    const parsed = parseStore(resolution.storage.getItem(MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY));
    const creates = parsed.store.creates
      .map(sanitizeCreateAction)
      .filter((value): value is MultisigCreateActionState => Boolean(value));
    const proposals = parsed.store.proposals
      .map(sanitizeProposalAction)
      .filter((value): value is MultisigProposalActionState => Boolean(value));
    const droppedUnsafeEntry =
      creates.length !== parsed.store.creates.length ||
      proposals.length !== parsed.store.proposals.length;
    const hasDuplicateIdentity =
      new Set(creates.map(getCreateUncertainActionIdentity)).size !== creates.length ||
      new Set(proposals.map(getProposalUncertainActionIdentity)).size !== proposals.length;

    return {
      creates,
      proposals,
      error:
        parsed.error ??
        (droppedUnsafeEntry || hasDuplicateIdentity ? STORAGE_READ_ERROR : undefined),
    };
  } catch {
    return {
      creates: [],
      proposals: [],
      error: STORAGE_READ_ERROR,
    };
  }
}

export function verifyUncertainMultisigActionStorage(storage?: Storage): string | undefined {
  const snapshot = readUncertainMultisigActions(storage);

  if (snapshot.error) {
    return snapshot.error;
  }

  return writeUncertainMultisigActions(snapshot.creates, snapshot.proposals, storage);
}

export function upsertUncertainCreateAction(
  state: MultisigCreateActionState,
  storage?: Storage,
): MultisigUncertainActionMutationResult {
  const snapshot = readUncertainMultisigActions(storage);

  if (snapshot.error) {
    return { snapshot, error: snapshot.error };
  }

  if (!isCanonicalFilecoinMessageCid(state.cid)) {
    return { snapshot, error: STORAGE_WRITE_ERROR };
  }

  const identity = getCreateUncertainActionIdentity(state);
  const existing = snapshot.creates.find(
    (candidate) => getCreateUncertainActionIdentity(candidate) === identity,
  );

  if (existing?.cid !== undefined && existing.cid !== state.cid) {
    return { snapshot, error: STORAGE_CONFLICT_ERROR };
  }

  const nextSnapshot = {
    creates: [
      state,
      ...snapshot.creates.filter(
        (candidate) => getCreateUncertainActionIdentity(candidate) !== identity,
      ),
    ],
    proposals: snapshot.proposals,
  };
  const error = writeUncertainMultisigActions(
    nextSnapshot.creates,
    nextSnapshot.proposals,
    storage,
  );

  return { snapshot: nextSnapshot, error };
}

export function upsertUncertainProposalAction(
  state: MultisigProposalActionState,
  storage?: Storage,
): MultisigUncertainActionMutationResult {
  const snapshot = readUncertainMultisigActions(storage);

  if (snapshot.error) {
    return { snapshot, error: snapshot.error };
  }

  if (!isCanonicalFilecoinMessageCid(state.cid)) {
    return { snapshot, error: STORAGE_WRITE_ERROR };
  }

  const identity = getProposalUncertainActionIdentity(state);
  const existing = snapshot.proposals.find(
    (candidate) => getProposalUncertainActionIdentity(candidate) === identity,
  );

  if (existing?.cid !== undefined && existing.cid !== state.cid) {
    return { snapshot, error: STORAGE_CONFLICT_ERROR };
  }

  const nextSnapshot = {
    creates: snapshot.creates,
    proposals: [
      state,
      ...snapshot.proposals.filter(
        (candidate) => getProposalUncertainActionIdentity(candidate) !== identity,
      ),
    ],
  };
  const error = writeUncertainMultisigActions(
    nextSnapshot.creates,
    nextSnapshot.proposals,
    storage,
  );

  return { snapshot: nextSnapshot, error };
}

export function removeUncertainCreateAction(
  state: Pick<MultisigCreateActionState, 'networkKey' | 'signerAddress' | 'cid'>,
  storage?: Storage,
): MultisigUncertainActionMutationResult {
  const snapshot = readUncertainMultisigActions(storage);

  if (snapshot.error) {
    return { snapshot, error: snapshot.error };
  }

  if (!isCanonicalFilecoinMessageCid(state.cid)) {
    return { snapshot, error: STORAGE_CONFLICT_ERROR };
  }

  const identity = `${state.networkKey}:${state.signerAddress}`;
  const existing = snapshot.creates.find(
    (candidate) => getCreateUncertainActionIdentity(candidate) === identity,
  );

  if (existing?.cid !== undefined && existing.cid !== state.cid) {
    return { snapshot, error: STORAGE_CONFLICT_ERROR };
  }

  const nextSnapshot = {
    creates: snapshot.creates.filter(
      (candidate) => getCreateUncertainActionIdentity(candidate) !== identity,
    ),
    proposals: snapshot.proposals,
  };
  const error = writeUncertainMultisigActions(
    nextSnapshot.creates,
    nextSnapshot.proposals,
    storage,
  );

  return { snapshot: nextSnapshot, error };
}

export function removeUncertainProposalAction(
  state: Pick<
    MultisigProposalActionState,
    'networkKey' | 'multisigAddress' | 'signerAddress' | 'cid'
  >,
  storage?: Storage,
): MultisigUncertainActionMutationResult {
  const snapshot = readUncertainMultisigActions(storage);

  if (snapshot.error) {
    return { snapshot, error: snapshot.error };
  }

  if (!isCanonicalFilecoinMessageCid(state.cid)) {
    return { snapshot, error: STORAGE_CONFLICT_ERROR };
  }

  const identity = `${state.networkKey}:${state.multisigAddress}:${state.signerAddress}`;
  const existing = snapshot.proposals.find(
    (candidate) => getProposalUncertainActionIdentity(candidate) === identity,
  );

  if (existing?.cid !== undefined && existing.cid !== state.cid) {
    return { snapshot, error: STORAGE_CONFLICT_ERROR };
  }

  const nextSnapshot = {
    creates: snapshot.creates,
    proposals: snapshot.proposals.filter(
      (candidate) => getProposalUncertainActionIdentity(candidate) !== identity,
    ),
  };
  const error = writeUncertainMultisigActions(
    nextSnapshot.creates,
    nextSnapshot.proposals,
    storage,
  );

  return { snapshot: nextSnapshot, error };
}

export function writeUncertainMultisigActions(
  creates: Iterable<MultisigCreateActionState>,
  proposals: Iterable<MultisigProposalActionState>,
  storage?: Storage,
): string | undefined {
  const resolution = resolveStorage(storage);

  if (resolution.error) {
    return STORAGE_WRITE_ERROR;
  }

  if (!resolution.storage) {
    return undefined;
  }

  const createValues = Array.from(creates);
  const proposalValues = Array.from(proposals);
  const sanitizedCreates = createValues.map(sanitizeCreateAction);
  const sanitizedProposals = proposalValues.map(sanitizeProposalAction);

  if (
    sanitizedCreates.some((state) => state === undefined) ||
    sanitizedProposals.some((state) => state === undefined)
  ) {
    return STORAGE_WRITE_ERROR;
  }

  const safeCreates = sanitizedCreates as MultisigCreateActionState[];
  const safeProposals = sanitizedProposals as MultisigProposalActionState[];

  if (
    new Set(safeCreates.map(getCreateUncertainActionIdentity)).size !== safeCreates.length ||
    new Set(safeProposals.map(getProposalUncertainActionIdentity)).size !==
      safeProposals.length
  ) {
    return STORAGE_CONFLICT_ERROR;
  }

  try {
    resolution.storage.setItem(
      MULTISIG_UNCERTAIN_ACTION_STORAGE_KEY,
      JSON.stringify({
        creates: safeCreates,
        proposals: safeProposals,
      }),
    );
    return undefined;
  } catch {
    return STORAGE_WRITE_ERROR;
  }
}
