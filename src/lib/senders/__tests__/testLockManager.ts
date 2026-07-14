export function createTestLockManager(): LockManager {
  const heldLocks = new Set<string>();

  const request = async <T>(
    name: string,
    options: { ifAvailable?: boolean; mode?: 'exclusive' | 'shared' },
    callback: (
      lock: { name: string; mode: 'exclusive' | 'shared' } | null,
    ) => Promise<T> | T,
  ): Promise<T> => {
    if (options.ifAvailable && heldLocks.has(name)) {
      return callback(null);
    }

    heldLocks.add(name);

    try {
      return await callback({ name, mode: options.mode ?? 'exclusive' });
    } finally {
      heldLocks.delete(name);
    }
  };

  return { request } as unknown as LockManager;
}
