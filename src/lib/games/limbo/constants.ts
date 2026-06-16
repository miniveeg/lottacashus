import { GAME_RTP } from "../rtp";

export const LIMBO_MIN_TARGET = 1.01;
export const LIMBO_MAX_TARGET = 1_000_000;
/** Distribution shape only; target RTP is enforced via win odds. */
export const LIMBO_HOUSE_EDGE = 0.01;
export const LIMBO_RTP = GAME_RTP;
