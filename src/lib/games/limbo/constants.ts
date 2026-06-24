import { GAME_RTP } from "../rtp";

export const LIMBO_MIN_TARGET = 1.01;
export const LIMBO_MAX_TARGET = 1_000_000;
/** Distribution shape only; target RTP is enforced via win odds. */
export const LIMBO_HOUSE_EDGE = 0.01;
export const LIMBO_RTP = GAME_RTP;

/**
 * Maximum payout per Limbo round, in the player's chosen coin currency
 * (GC or SC). Without this cap, a player could wager their entire balance
 * at the 1,000,000× max target for an unbounded payout (audit Games agent
 * #7 flagged this as a $100B risk). The cap is enforced client-side
 * (disable the bet button + show a message) AND must be enforced
 * server-side in the `place-limbo-bet` edge function — never trust the
 * client. 100,000 is generous for a sweepstakes product and keeps treasury
 * risk bounded.
 */
export const LIMBO_MAX_PAYOUT = 100_000;
