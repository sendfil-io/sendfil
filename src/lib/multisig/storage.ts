import type { SendFilNetworkKey } from '../networks';
import type { NativeMultisigAddress, SavedMultisig } from './types';

export const MULTISIG_STORAGE_KEY = 'sendfil.multisigs.v1';

interface StoredMultisigsByNetwork {
  mainnet: SavedMultisig[];
  calibration: SavedMultisig[];
}

export interface SavedMultisigsStorageResult {
  multisigs: SavedMultisig[];
  error?: string;
  persisted: boolean;
}

interface StorageResolution {
  storage?: Storage;
  error?: string;
}

interface StoredMultisigsReadResult {
  store: StoredMultisigsByNetwork;
  storage?: Storage;
  error?: string;
}

function createEmptyStore(): StoredMultisigsByNetwork {
  return {
    mainnet: [],
    calibration: [],
  };
}

function createStorageError(action: 'read' | 'save' | 'remove'): string {
  if (action === 'read') {
    return 'Saved multisigs could not be read from this browser. Local storage may be unavailable.';
  }

  if (action === 'save') {
    return 'This multisig could not be saved in this browser. Check local storage access and try again.';
  }

  return 'This multisig could not be removed from this browser. Check local storage access and try again.';
}

function resolveBrowserStorage(storage?: Storage): StorageResolution {
  if (storage) {
    return { storage };
  }

  if (typeof window === 'undefined') {
    return {};
  }

  try {
    return { storage: window.localStorage };
  } catch {
    return { error: createStorageError('read') };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function sanitizeSavedMultisig(
  value: unknown,
  networkKey: SendFilNetworkKey,
): SavedMultisig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const expectedPrefix = networkKey === 'mainnet' ? 'f2' : 't2';
  const { address, robustAddress, idAddress, label, addedAt, updatedAt } = value;

  if (
    typeof address !== 'string' ||
    !address.startsWith(expectedPrefix) ||
    value.networkKey !== networkKey ||
    typeof addedAt !== 'string' ||
    typeof updatedAt !== 'string' ||
    !isOptionalString(robustAddress) ||
    !isOptionalString(idAddress) ||
    !isOptionalString(label) ||
    (robustAddress !== undefined && !robustAddress.startsWith(expectedPrefix))
  ) {
    return undefined;
  }

  return {
    address: address as NativeMultisigAddress,
    networkKey,
    robustAddress: robustAddress as NativeMultisigAddress | undefined,
    idAddress,
    label,
    addedAt,
    updatedAt,
  };
}

function sanitizeNetworkEntries(value: unknown, networkKey: SendFilNetworkKey): SavedMultisig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenAddresses = new Set<string>();
  const multisigs: SavedMultisig[] = [];

  for (const entry of value) {
    const multisig = sanitizeSavedMultisig(entry, networkKey);

    if (!multisig || seenAddresses.has(multisig.address)) {
      continue;
    }

    seenAddresses.add(multisig.address);
    multisigs.push(multisig);
  }

  return multisigs;
}

function parseStoredMultisigs(rawValue: string | null): StoredMultisigsByNetwork {
  if (!rawValue) {
    return createEmptyStore();
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (!isRecord(parsed)) {
      return createEmptyStore();
    }

    return {
      mainnet: sanitizeNetworkEntries(parsed.mainnet, 'mainnet'),
      calibration: sanitizeNetworkEntries(parsed.calibration, 'calibration'),
    };
  } catch {
    return createEmptyStore();
  }
}

function readStoredMultisigs(storage?: Storage): StoredMultisigsReadResult {
  const resolved = resolveBrowserStorage(storage);

  if (resolved.error) {
    return {
      store: createEmptyStore(),
      error: resolved.error,
    };
  }

  if (!resolved.storage) {
    return {
      store: createEmptyStore(),
    };
  }

  try {
    return {
      store: parseStoredMultisigs(resolved.storage.getItem(MULTISIG_STORAGE_KEY)),
      storage: resolved.storage,
    };
  } catch {
    return {
      store: createEmptyStore(),
      storage: resolved.storage,
      error: createStorageError('read'),
    };
  }
}

function writeStoredMultisigs(
  store: StoredMultisigsByNetwork,
  storage: Storage | undefined,
  action: 'save' | 'remove',
): string | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    storage.setItem(MULTISIG_STORAGE_KEY, JSON.stringify(store));
    return undefined;
  } catch {
    return createStorageError(action);
  }
}

export function readSavedMultisigsResult(
  networkKey: SendFilNetworkKey,
  storage?: Storage,
): SavedMultisigsStorageResult {
  const result = readStoredMultisigs(storage);

  return {
    multisigs: result.store[networkKey],
    error: result.error,
    persisted: Boolean(result.storage) && !result.error,
  };
}

export function readSavedMultisigs(
  networkKey: SendFilNetworkKey,
  storage?: Storage,
): SavedMultisig[] {
  return readSavedMultisigsResult(networkKey, storage).multisigs;
}

type SaveMultisigInput = Omit<SavedMultisig, 'addedAt' | 'updatedAt'> & {
  addedAt?: string;
  updatedAt?: string;
};

export function saveMultisigResult(
  multisig: SaveMultisigInput,
  storage?: Storage,
): SavedMultisigsStorageResult {
  const result = readStoredMultisigs(storage);

  if (result.error) {
    return {
      multisigs: result.store[multisig.networkKey],
      error: result.error,
      persisted: false,
    };
  }

  const timestamp = new Date().toISOString();
  const current = result.store[multisig.networkKey];
  const existing = current.find((item) => item.address === multisig.address);
  const saved: SavedMultisig = {
    ...existing,
    ...multisig,
    addedAt: multisig.addedAt ?? existing?.addedAt ?? timestamp,
    updatedAt: multisig.updatedAt ?? timestamp,
  };
  const validatedSaved = sanitizeSavedMultisig(saved, multisig.networkKey);

  if (!validatedSaved) {
    return {
      multisigs: current,
      error: 'This multisig contains invalid local storage data and was not saved.',
      persisted: false,
    };
  }

  const next = [validatedSaved, ...current.filter((item) => item.address !== multisig.address)];
  const nextStore = {
    ...result.store,
    [multisig.networkKey]: next,
  };
  const error = writeStoredMultisigs(nextStore, result.storage, 'save');

  return {
    multisigs: error ? current : next,
    error,
    persisted: Boolean(result.storage) && !error,
  };
}

export function saveMultisig(multisig: SaveMultisigInput, storage?: Storage): SavedMultisig[] {
  return saveMultisigResult(multisig, storage).multisigs;
}

export function removeSavedMultisigResult(
  networkKey: SendFilNetworkKey,
  address: NativeMultisigAddress,
  storage?: Storage,
): SavedMultisigsStorageResult {
  const result = readStoredMultisigs(storage);

  if (result.error) {
    return {
      multisigs: result.store[networkKey],
      error: result.error,
      persisted: false,
    };
  }

  const current = result.store[networkKey];
  const next = current.filter((item) => item.address !== address);
  const nextStore = {
    ...result.store,
    [networkKey]: next,
  };
  const error = writeStoredMultisigs(nextStore, result.storage, 'remove');

  return {
    multisigs: error ? current : next,
    error,
    persisted: Boolean(result.storage) && !error,
  };
}

export function removeSavedMultisig(
  networkKey: SendFilNetworkKey,
  address: NativeMultisigAddress,
  storage?: Storage,
): SavedMultisig[] {
  return removeSavedMultisigResult(networkKey, address, storage).multisigs;
}
