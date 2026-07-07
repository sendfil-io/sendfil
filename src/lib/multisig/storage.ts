import type { SendFilNetworkKey } from '../networks';
import type { NativeMultisigAddress, SavedMultisig } from './types';

export const MULTISIG_STORAGE_KEY = 'sendfil.multisigs.v1';

interface StoredMultisigsByNetwork {
  mainnet: SavedMultisig[];
  calibration: SavedMultisig[];
}

function createEmptyStore(): StoredMultisigsByNetwork {
  return {
    mainnet: [],
    calibration: [],
  };
}

function getBrowserStorage(storage?: Storage): Storage | undefined {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.localStorage;
}

function parseStoredMultisigs(rawValue: string | null): StoredMultisigsByNetwork {
  if (!rawValue) {
    return createEmptyStore();
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredMultisigsByNetwork>;

    return {
      mainnet: Array.isArray(parsed.mainnet) ? parsed.mainnet : [],
      calibration: Array.isArray(parsed.calibration) ? parsed.calibration : [],
    };
  } catch {
    return createEmptyStore();
  }
}

function writeStoredMultisigs(store: StoredMultisigsByNetwork, storage?: Storage): void {
  getBrowserStorage(storage)?.setItem(MULTISIG_STORAGE_KEY, JSON.stringify(store));
}

export function readSavedMultisigs(
  networkKey: SendFilNetworkKey,
  storage?: Storage,
): SavedMultisig[] {
  const store = parseStoredMultisigs(
    getBrowserStorage(storage)?.getItem(MULTISIG_STORAGE_KEY) ?? null,
  );

  return store[networkKey];
}

export function saveMultisig(
  multisig: Omit<SavedMultisig, 'addedAt' | 'updatedAt'> & {
    addedAt?: string;
    updatedAt?: string;
  },
  storage?: Storage,
): SavedMultisig[] {
  const browserStorage = getBrowserStorage(storage);
  const store = parseStoredMultisigs(
    browserStorage?.getItem(MULTISIG_STORAGE_KEY) ?? null,
  );
  const timestamp = new Date().toISOString();
  const current = store[multisig.networkKey];
  const existing = current.find((item) => item.address === multisig.address);
  const saved: SavedMultisig = {
    ...existing,
    ...multisig,
    addedAt: multisig.addedAt ?? existing?.addedAt ?? timestamp,
    updatedAt: multisig.updatedAt ?? timestamp,
  };

  store[multisig.networkKey] = [
    saved,
    ...current.filter((item) => item.address !== multisig.address),
  ];
  writeStoredMultisigs(store, browserStorage);
  return store[multisig.networkKey];
}

export function removeSavedMultisig(
  networkKey: SendFilNetworkKey,
  address: NativeMultisigAddress,
  storage?: Storage,
): SavedMultisig[] {
  const browserStorage = getBrowserStorage(storage);
  const store = parseStoredMultisigs(
    browserStorage?.getItem(MULTISIG_STORAGE_KEY) ?? null,
  );

  store[networkKey] = store[networkKey].filter((item) => item.address !== address);
  writeStoredMultisigs(store, browserStorage);
  return store[networkKey];
}

