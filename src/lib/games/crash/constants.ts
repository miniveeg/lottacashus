import { GAME_RTP } from "../rtp";

export const CRASH_MIN_WAGER = 0.01;
export const CRASH_RTP = GAME_RTP;
// 96.5% RTP: crash point multiplier = 1 - CRASH_HOUSE_EDGE = 0.965.
// Matches the server (supabase/functions/place-crash-bet/index.ts).
export const CRASH_HOUSE_EDGE = 0.035;
export const TWO_POW_24 = 16777216;
