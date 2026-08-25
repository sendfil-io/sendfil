export const TERMS_VERSION = '2026-08-25';
export const TERMS_LAST_UPDATED = 'August 25, 2026';
export const TERMS_ACCEPTANCE_STORAGE_KEY = 'sendfil.terms-acceptance.v1';

interface TermsAcceptanceRecord {
  acceptedAt: string;
  version: string;
}

type TermsAcceptanceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isTermsAcceptanceRecord(value: unknown): value is TermsAcceptanceRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TermsAcceptanceRecord>;

  return (
    candidate.version === TERMS_VERSION &&
    typeof candidate.acceptedAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.acceptedAt))
  );
}

export function hasAcceptedCurrentTerms(storage?: TermsAcceptanceStorage): boolean {
  if (!storage) {
    return false;
  }

  try {
    const storedValue = storage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY);

    if (!storedValue) {
      return false;
    }

    return isTermsAcceptanceRecord(JSON.parse(storedValue));
  } catch {
    return false;
  }
}

export function recordCurrentTermsAcceptance(
  storage?: TermsAcceptanceStorage,
  acceptedAt = new Date(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      TERMS_ACCEPTANCE_STORAGE_KEY,
      JSON.stringify({
        acceptedAt: acceptedAt.toISOString(),
        version: TERMS_VERSION,
      } satisfies TermsAcceptanceRecord),
    );
  } catch {
    // A storage failure must not turn acceptance into an app crash. The caller
    // keeps the in-memory acceptance for the current page session.
  }
}
