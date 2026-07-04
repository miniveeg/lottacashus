import { GAME_RTP } from "../rtp";

export const CRASH_MIN_WAGER = 1;
// Regulatory max-payout cap: 100,000 in the player's coin currency. Applies
// equally to GC and SC — same real-money cap regardless of which currency
// the player wagered in. Matches the server cap (place-crash-bet/index.ts).
export const CRASH_MAX_PAYOUT = 100_000;
// Crash point worst-case multiplier used by the cap formula. The crash-point
// distribution tops out around 1000× (the 99.99th-percentile outcome). The
// server enforces the cap as `wager × CRASH_WORST_CASE_MULTIPLIER ≤
// CRASH_MAX_PAYOUT`, which means CRASH_MAX_PAYOUT / CRASH_WORST_CASE_MULTIPLIER
// is the largest wager the server will ever accept (100 in either currency).
// Matches the server (place-crash-bet/index.ts) and local-play.ts.
export const CRASH_WORST_CASE_MULTIPLIER = 1_000;
// Derived from the two values above. Keep this in sync — if you change one
// of the two constants, recompute this.
export const CRASH_MAX_WAGER = CRASH_MAX_PAYOUT / CRASH_WORST_CASE_MULTIPLIER;
export const CRASH_RTP = GAME_RTP;
// 96.5% RTP: crash point multiplier = 1 - CRASH_HOUSE_EDGE = 0.965.
// Matches the server (supabase/functions/place-crash-bet/index.ts).
export const CRASH_HOUSE_EDGE = 0.035;
export const TWO_POW_24 = 16777216;
