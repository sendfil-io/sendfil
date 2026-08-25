import { describe, expect, it, vi } from 'vitest';
import {
  TERMS_ACCEPTANCE_STORAGE_KEY,
  TERMS_VERSION,
  hasAcceptedCurrentTerms,
  recordCurrentTermsAcceptance,
} from '../termsAcceptance';

function createStorage(initialValue: string | null = null) {
  let storedValue = initialValue;

  return {
    getItem: vi.fn((key: string) => (key === TERMS_ACCEPTANCE_STORAGE_KEY ? storedValue : null)),
    setItem: vi.fn((key: string, value: string) => {
      if (key === TERMS_ACCEPTANCE_STORAGE_KEY) {
        storedValue = value;
      }
    }),
  };
}

describe('terms acceptance storage', () => {
  it('accepts only a parseable record for the current Terms version', () => {
    const storage = createStorage(
      JSON.stringify({
        acceptedAt: '2026-08-25T14:30:00.000Z',
        version: TERMS_VERSION,
      }),
    );

    expect(hasAcceptedCurrentTerms(storage)).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith(TERMS_ACCEPTANCE_STORAGE_KEY);
  });

  it.each([
    ['missing storage', undefined],
    ['missing record', createStorage()],
    ['malformed JSON', createStorage('{not-json')],
    [
      'an older Terms version',
      createStorage(
        JSON.stringify({
          acceptedAt: '2026-07-21T14:30:00.000Z',
          version: '2026-01-01',
        }),
      ),
    ],
    [
      'an invalid acceptance timestamp',
      createStorage(
        JSON.stringify({
          acceptedAt: 'not-a-date',
          version: TERMS_VERSION,
        }),
      ),
    ],
  ])('rejects %s', (_label, storage) => {
    expect(hasAcceptedCurrentTerms(storage)).toBe(false);
  });

  it('writes the current version and an exact ISO acceptance timestamp', () => {
    const storage = createStorage();
    const acceptedAt = new Date('2026-08-25T18:45:12.345Z');

    recordCurrentTermsAcceptance(storage, acceptedAt);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      TERMS_ACCEPTANCE_STORAGE_KEY,
      JSON.stringify({
        acceptedAt: acceptedAt.toISOString(),
        version: TERMS_VERSION,
      }),
    );
    expect(hasAcceptedCurrentTerms(storage)).toBe(true);
  });

  it('fails closed on reads and does not throw on unavailable writes', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('Storage unavailable');
      }),
      setItem: vi.fn(() => {
        throw new Error('Storage unavailable');
      }),
    };

    expect(hasAcceptedCurrentTerms(storage)).toBe(false);
    expect(() => recordCurrentTermsAcceptance(storage)).not.toThrow();
  });
});
