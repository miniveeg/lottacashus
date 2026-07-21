/**
 * Hardened-edge-function helpers (shared across all 7 game edge functions).
 *
 * Every game edge function follows the same idempotent-placement pattern:
 *  1. Extract `clientRequestId` from the request body (the client supplies
 *     the deterministic UUID so retries collapse to ONE row in SQL).
 *  2. Pass it to the atomic `place_*_bet` SQL function which:
 *     - Short-circuits on existing (user_id, client_request_id) row
 *     - Caps wager per-coin (GC: 10,000 / SC: 100)
 *     - Caps max payout via per-game worst-case multiplier
 *     - Debits balance atomically with SELECT FOR UPDATE
 *     - Inserts the game row in the same transaction
 *     - Calls reject_if_self_excluded (defense-in-depth)
 *     - Returns (out_balance, bet_id)
 *
 * Why a helper: the order of operations (idempotency-first, then
 * self-exclusion, then caps, then debit) and the idempotency-key contract
 * are easy to drift on. Centralising the key generation guarantees every
 * placer reads/writes `client_request_id` the same way.
 */

/**
 * Deterministic, idempotency-key extraction.
 *
 * Client-supplied key is preferred (so retries collapse); falls back to a
 * fresh UUID if absent. The fresh-fallback path is still safe because:
 *  - The unique index is (user_id, client_request_id) — a fresh UUID per
 *    request will never collide.
 *  - Concurrent retries with a CLIENT-supplied key WILL collapse (the
 *    intended behaviour).
 *
 * @param body The request body (parsed JSON).
 * @returns A non-null string. Empty string is reserved as "client omitted
 *          AND we are not in a browser context" — callers should treat
 *          empty as "skip idempotency" for non-game endpoints.
 */
export function extractClientRequestId(body: Record<string, unknown> | null): string {
  if (!body) return "";
  const fromBody = body.clientRequestId ?? body.client_request_id;
  if (typeof fromBody === "string" && fromBody.trim().length > 0) {
    // Bound length — a malicious client could otherwise supply megabytes.
    return fromBody.slice(0, 200);
  }
  // Fresh UUID per placement — unique index makes this safe.
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for old runtimes: timestamp + random.
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}
