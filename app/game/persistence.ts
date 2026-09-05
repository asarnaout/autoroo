const STORAGE_KEY = 'autoroo.best.v1';
const DOUBLE_JUMP_HINT_KEY = 'autoroo.double-jump-hint.v1';
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

/** Claim the first-collection hint once per browser, or per session if storage fails. */
export function createDoubleJumpHintClaim(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(),
): () => boolean {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    try {
      if (storage?.getItem(DOUBLE_JUMP_HINT_KEY) === 'seen') return false;
    } catch {
      // The in-memory claim still prevents repeats when reads are blocked.
    }
    try {
      storage?.setItem(DOUBLE_JUMP_HINT_KEY, 'seen');
    } catch {
      // Quota/private-mode errors must not interrupt a pickup or repeat its hint.
    }
    return true;
  };
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
