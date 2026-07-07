import { describe, expect, it } from 'vitest';
import {
  MULTISIG_STORAGE_KEY,
  readSavedMultisigs,
  removeSavedMultisig,
  saveMultisig,
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
});

