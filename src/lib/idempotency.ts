/**
 * Client-side idempotency key helper for game place-bet requests.
 *
 * Purpose: collapse network-level retries into ONE row in the SQL placer
 * (which has UNIQUE (user_id, client_request_id)). Without this, a network
 * blip AFTER the SQL commit but BEFORE the response reaches the client would
 * cause a duplicate retry that creates a SECOND debit row.
 *
 * Lifecycle:
 *
 *   User clicks "Place Bet" → getOrCreateRequestId("crash-bet") returns UUID-A
 *                            → SQL debits + inserts row keyed UUID-A
 *                            → commit happens server-side
 *   Network blips — no response → retry
 *   User clicks "Place Bet" again → getOrCreateRequestId("crash-bet") returns
 *   STILL UUID-A (from sessionStorage) → SQL idempotency short-circuits →
 *   same row, no double-debit
 *   Response arrives, UI updates → clearRequestId("crash-bet") so the next
 *   round gets a fresh UUID-B
 *
 * Failure semantics:
 *   • On transient error (network, 500, balance-mismatch), the helper
 *     KEEPS the UUID so retries stay idempotent. The user can click again
 *     to retry the same logical action.
 *   • On success, the helper CLEARS the UUID so the next round's button
 *     press gets a fresh key.
 *   • On "user error" (validation, illegal state), the caller should clear
 *     manually since the prior UUID is no longer valid — the action is
 *     fundamentally different (e.g. wrong wager amount).
 *
 * Storage: sessionStorage (not localStorage) so a fresh browser session
 * starts with a clean slate. Stale keys older than `TTL_MS` are treated as
 * expired and a new UUID is generated — defeats the case where a user
 * returns to a stale tab after hours.
 */

const STORAGE_PREFIX = "lc:idem:";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

type StoredEntry = { id: string; createdAt: number };

/**
 * In-memory fallback for browsers where sessionStorage throws or is
 * disabled (private browsing with "block all cookies", sandboxed iframes,
 * etc.). Without this, every retry of `placeCrashBet()` would generate a
 * fresh UUID — defeating server-side idempotency and risking double-debit.
 *
 * Lives at module scope so it survives across multiple calls in the same
 * JS runtime. A page reload clears it (intentional — fresh session should
 * reset the idempotency window).
 */
const memFallback = new Map<string, StoredEntry>();

function storageAvailable(): boolean {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    // Probe write to confirm storage isn't disabled (e.g. incognito quota).
    const probe = `${STORAGE_PREFIX}__probe__`;
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readEntry(actionKey: string): StoredEntry | null {
  // 1) In-memory check first — works even when sessionStorage is disabled.
  const mem = memFallback.get(actionKey);
  if (mem) {
    if (Date.now() - mem.createdAt > TTL_MS) {
      memFallback.delete(actionKey);
      // Also clear from sessionStorage if available.
      if (storageAvailable()) {
        try { window.sessionStorage.removeItem(STORAGE_PREFIX + actionKey); } catch { /* ignore */ }
      }
      return null;
    }
    return mem;
  }
  // 2) sessionStorage fallback — survives a page reload within the same tab.
  if (!storageAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + actionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEntry>;
    if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "number") return null;
    if (Date.now() - parsed.createdAt > TTL_MS) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + actionKey);
      return null;
    }
    const entry = { id: parsed.id, createdAt: parsed.createdAt };
    // Backfill the in-memory mirror so subsequent calls in the same JS
    // runtime don't have to round-trip to sessionStorage.
    memFallback.set(actionKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeEntry(actionKey: string, id: string): void {
  const entry: StoredEntry = { id, createdAt: Date.now() };
  // Mirror to in-memory first (always succeeds, even when storage is disabled).
  memFallback.set(actionKey, entry);
  // Then attempt sessionStorage so a page reload within the same tab still
  // sees the same UUID.
  if (storageAvailable()) {
    try {
      window.sessionStorage.setItem(
        STORAGE_PREFIX + actionKey,
        JSON.stringify(entry)
      );
    } catch {
      /* quota / privacy mode — in-memory mirror is our fallback */
    }
  }
}

function freshUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // Fallback for older browsers / non-secure contexts.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Returns the existing request ID for `actionKey` if one is stored and
 * still within TTL; otherwise generates a fresh UUID, stores it, and
 * returns it. Safe to call repeatedly — idempotent until `clearRequestId`
 * is invoked (typically on success).
 */
export function getOrCreateRequestId(actionKey: string): string {
  const existing = readEntry(actionKey);
  if (existing) return existing.id;
  const id = freshUuid();
  writeEntry(actionKey, id);
  return id;
}

/**
 * Removes the stored request ID for `actionKey`. Call this after a
 * successful place-bet so that the next round gets a fresh UUID. Safe to
 * call even if no ID is stored. Clears BOTH the in-memory mirror AND
 * sessionStorage so the next round starts cleanly regardless of which
 * tier was used on the prior call.
 */
export function clearRequestId(actionKey: string): void {
  memFallback.delete(actionKey);
  if (storageAvailable()) {
    try {
      window.sessionStorage.removeItem(STORAGE_PREFIX + actionKey);
    } catch {
      /* ignore */
    }
  }
}

/* ─── Canonical action-key names (referenced from each game wrapper) ───── */

/** Crash betting round. Cleared on every successful `placeCrashBet`. */
export const IDEM_KEY_CRASH_BET = "crash-bet";
/** Keno betting round. Cleared on every successful `placeKenoBet`. */
export const IDEM_KEY_KENO_BET = "keno-bet";
/** Limbo betting round. Cleared on every successful `placeLimboBet`. */
export const IDEM_KEY_LIMBO_BET = "limbo-bet";
/** Roulette betting round. Cleared on every successful `placeRouletteBet`. */
export const IDEM_KEY_ROULETTE_BET = "roulette-bet";
/** Slots betting round. Cleared on every successful `placeSlotsBet`. */
export const IDEM_KEY_SLOTS_BET = "slots-bet";
/** Mines start-handshake. Cleared on every successful `startMinesGame`. */
export const IDEM_KEY_MINES_START = "mines-start";
/** Blackjack start-handshake. Cleared on every successful `startBlackjack`. */
export const IDEM_KEY_BLACKJACK_START = "blackjack-start";
