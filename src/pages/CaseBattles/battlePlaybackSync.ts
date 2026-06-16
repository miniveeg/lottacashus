/** Matches post-round settle delay in CaseBattleArena. */
export const ROUND_SETTLE_GAP_MS = 350;

export type PlaybackSyncDecision = {
  settledRounds: number;
  activeRound: number;
  waitForNextRound: boolean;
  waitMs: number;
  allRoundsDone: boolean;
};

export function getPlaybackAnchorMs(results: unknown): number | null {
  const anchor = (results as { playbackAnchorAt?: string } | null)?.playbackAnchorAt;
  if (!anchor) return null;
  const ms = new Date(anchor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function getPlaybackSyncDecision(
  anchorMs: number,
  spinMs: number,
  totalRounds: number,
  nowMs = Date.now()
): PlaybackSyncDecision {
  const roundDuration = spinMs + ROUND_SETTLE_GAP_MS;
  const elapsed = nowMs - anchorMs;

  if (totalRounds <= 0) {
    return {
      settledRounds: 0,
      activeRound: 0,
      waitForNextRound: false,
      waitMs: 0,
      allRoundsDone: true,
    };
  }

  if (elapsed < 0) {
    return {
      settledRounds: 0,
      activeRound: 0,
      waitForNextRound: true,
      waitMs: -elapsed,
      allRoundsDone: false,
    };
  }

  const roundIndex = Math.floor(elapsed / roundDuration);

  if (roundIndex >= totalRounds) {
    return {
      settledRounds: totalRounds,
      activeRound: Math.max(0, totalRounds - 1),
      waitForNextRound: false,
      waitMs: 0,
      allRoundsDone: true,
    };
  }

  const msIntoRound = elapsed % roundDuration;
  const inSpinWindow = msIntoRound < spinMs;

  if (inSpinWindow) {
    const waitMs = spinMs - msIntoRound + ROUND_SETTLE_GAP_MS;
    const joinAtRoundStart = roundIndex === 0 && msIntoRound < 150;

    if (joinAtRoundStart) {
      return {
        settledRounds: 0,
        activeRound: 0,
        waitForNextRound: false,
        waitMs: 0,
        allRoundsDone: false,
      };
    }

    return {
      settledRounds: roundIndex,
      activeRound: roundIndex,
      waitForNextRound: true,
      waitMs,
      allRoundsDone: false,
    };
  }

  const nextRound = Math.min(roundIndex + 1, totalRounds - 1);
  return {
    settledRounds: roundIndex + 1,
    activeRound: nextRound,
    waitForNextRound: false,
    waitMs: 0,
    allRoundsDone: false,
  };
}

