import { describe, expect, it } from 'vitest';
import {
  MULTISIG_STORAGE_KEY,
  readSavedMultisigs,
  readSavedMultisigsResult,
  removeSavedMultisig,
  removeSavedMultisigResult,
  saveMultisig,
  saveMultisigResult,
} from '../storage';

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

class FailingStorage extends MemoryStorage {
  constructor(private readonly failure: 'read' | 'write') {
    super();
  }

  override getItem(key: string): string | null {
    if (this.failure === 'read') {
      throw new DOMException('Storage access denied', 'SecurityError');
    }

    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    if (this.failure === 'write') {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    }

    super.setItem(key, value);
  }
}

describe('multisig local storage', () => {
  it('scopes saved multisigs by Filecoin network', () => {
    const storage = new MemoryStorage();

    saveMultisig(
      {
        address: 'f2mainnetmultisig' as `f2${string}`,
        networkKey: 'mainnet',
      },
      storage,
    );
    saveMultisig(
      {
        address: 't2calibrationmultisig' as `t2${string}`,
        networkKey: 'calibration',
      },
      storage,
    );

    expect(readSavedMultisigs('mainnet', storage)).toHaveLength(1);
    expect(readSavedMultisigs('calibration', storage)).toHaveLength(1);
    expect(storage.getItem(MULTISIG_STORAGE_KEY)).toContain('mainnet');
  });

  it('updates an existing saved multisig instead of duplicating it', () => {
    const storage = new MemoryStorage();
    const address = 't2calibrationmultisig' as `t2${string}`;

    saveMultisig({ address, networkKey: 'calibration', label: 'Old' }, storage);
    saveMultisig({ address, networkKey: 'calibration', label: 'New' }, storage);

    const saved = readSavedMultisigs('calibration', storage);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.label).toBe('New');
  });

  it('removes only the selected network entry', () => {
    const storage = new MemoryStorage();
    const mainnet = 'f2mainnetmultisig' as `f2${string}`;
    const calibration = 't2calibrationmultisig' as `t2${string}`;

    saveMultisig({ address: mainnet, networkKey: 'mainnet' }, storage);
    saveMultisig({ address: calibration, networkKey: 'calibration' }, storage);
    removeSavedMultisig('calibration', calibration, storage);

    expect(readSavedMultisigs('mainnet', storage)).toHaveLength(1);
    expect(readSavedMultisigs('calibration', storage)).toHaveLength(0);
  });

  it('discards null, malformed, wrong-network, and duplicate stored entries', () => {
    const storage = new MemoryStorage();
    const timestamp = new Date().toISOString();
    const valid = {
      address: 't2validmultisig',
      networkKey: 'calibration',
      label: 'Valid',
      addedAt: timestamp,
      updatedAt: timestamp,
    };

    storage.setItem(
      MULTISIG_STORAGE_KEY,
      JSON.stringify({
        mainnet: [null, valid],
        calibration: [
          null,
          valid,
          valid,
          { ...valid, address: 'f2wrongnetwork' },
          { ...valid, addedAt: null },
          'not-an-object',
        ],
      }),
    );

    expect(readSavedMultisigs('mainnet', storage)).toEqual([]);
    expect(readSavedMultisigs('calibration', storage)).toEqual([valid]);
  });

  it('recovers from invalid JSON without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(MULTISIG_STORAGE_KEY, '{not-json');

    expect(() => readSavedMultisigs('mainnet', storage)).not.toThrow();
    expect(readSavedMultisigs('mainnet', storage)).toEqual([]);
  });

  it('rejects invalid records before writing them', () => {
    const storage = new MemoryStorage();
    const result = saveMultisigResult(
      {
        address: 'f2wrongnetwork' as `t2${string}`,
        networkKey: 'calibration',
      },
      storage,
    );

    expect(result).toMatchObject({
      multisigs: [],
      persisted: false,
      error: expect.stringContaining('invalid local storage data'),
    });
    expect(storage.getItem(MULTISIG_STORAGE_KEY)).toBeNull();
  });

  it('returns useful failures instead of throwing when storage cannot be read', () => {
    const storage = new FailingStorage('read');

    expect(() => readSavedMultisigs('calibration', storage)).not.toThrow();
    expect(readSavedMultisigsResult('calibration', storage)).toMatchObject({
      multisigs: [],
      persisted: false,
      error: expect.stringContaining('could not be read'),
    });
    expect(
      saveMultisigResult(
        {
          address: 't2unpersisted' as `t2${string}`,
          networkKey: 'calibration',
        },
        storage,
      ),
    ).toMatchObject({
      multisigs: [],
      persisted: false,
      error: expect.any(String),
    });
  });

  it('preserves the last persisted list when storage writes fail', () => {
    const storage = new FailingStorage('write');

    expect(() =>
      saveMultisig(
        {
          address: 't2unpersisted' as `t2${string}`,
          networkKey: 'calibration',
        },
        storage,
      ),
    ).not.toThrow();
    expect(
      saveMultisigResult(
        {
          address: 't2unpersisted' as `t2${string}`,
          networkKey: 'calibration',
        },
        storage,
      ),
    ).toMatchObject({
      multisigs: [],
      persisted: false,
      error: expect.stringContaining('could not be saved'),
    });
    expect(
      removeSavedMultisigResult('calibration', 't2unpersisted' as `t2${string}`, storage),
    ).toMatchObject({
      multisigs: [],
      persisted: false,
      error: expect.stringContaining('could not be removed'),
    });
  });
});
