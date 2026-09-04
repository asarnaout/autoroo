const STORAGE_KEY = 'autoroo.best.v1';
const MAX_PERSISTED_SCORE = 999_999_999;

export interface StoredBest {
  readonly version: 1;
  readonly best: number;
}

export function parseStoredBest(raw: string | null): number {
  if (!raw) return 0;
  try {
    const value = JSON.parse(raw) as Partial<StoredBest>;
    if (
      value.version !== 1 ||
      typeof value.best !== 'number' ||
      !Number.isFinite(value.best) ||
      value.best < 0 ||
      value.best > MAX_PERSISTED_SCORE ||
      !Number.isInteger(value.best)
    ) {
      return 0;
    }
    return value.best;
  } catch {
    return 0;
  }
}

export function loadBest(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): number {
  if (!storage) return 0;
  try {
    return parseStoredBest(storage.getItem(STORAGE_KEY));
  } catch {
    return 0;
  }
}

export function saveBest(
  score: number,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): boolean {
  if (!storage || !Number.isFinite(score)) return false;
  const best = Math.min(MAX_PERSISTED_SCORE, Math.max(0, Math.floor(score)));
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, best } satisfies StoredBest),
    );
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
