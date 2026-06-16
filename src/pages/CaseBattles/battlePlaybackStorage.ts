const STORAGE_PREFIX = "lotta-cb-playback:";
const RELOAD_PREFIX = "lotta-cb-reload:";

export type SavedBattlePlayback = {
  settledRounds: number;
  activeRound: number;
  casesPlaybackDone: boolean;
  jackpotReelDone: boolean;
};

export function isPlaybackInProgress(
  saved: SavedBattlePlayback | null,
  isJackpot: boolean
): boolean {
  if (!saved) return false;
  return !saved.casesPlaybackDone || (isJackpot && !saved.jackpotReelDone);
}

export function peekPlaybackReload(battleId: string): boolean {
  try {
    return sessionStorage.getItem(RELOAD_PREFIX + battleId) === "1";
  } catch {
    return false;
  }
}

/** User refreshed the tab while case playback was still in progress. */
export function consumePlaybackReload(battleId: string): boolean {
  try {
    const key = RELOAD_PREFIX + battleId;
    const wasReload = sessionStorage.getItem(key) === "1";
    sessionStorage.removeItem(key);
    return wasReload;
  } catch {
    return false;
  }
}

export function markPlaybackReload(battleId: string): void {
  try {
    sessionStorage.setItem(RELOAD_PREFIX + battleId, "1");
  } catch {
    /* ignore */
  }
}

export function finishedPlaybackSnapshot(
  rounds: number
): SavedBattlePlayback {
  return {
    settledRounds: rounds,
    activeRound: Math.max(0, rounds - 1),
    casesPlaybackDone: true,
    jackpotReelDone: true,
  };
}

export function casesDoneJackpotPendingSnapshot(
  rounds: number
): SavedBattlePlayback {
  return {
    settledRounds: rounds,
    activeRound: Math.max(0, rounds - 1),
    casesPlaybackDone: true,
    jackpotReelDone: false,
  };
}

export function readBattlePlayback(battleId: string): SavedBattlePlayback | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + battleId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedBattlePlayback;
    if (typeof parsed.settledRounds !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBattlePlayback(battleId: string, state: SavedBattlePlayback): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + battleId, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function clearBattlePlayback(battleId: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + battleId);
  } catch {
    /* ignore */
  }
}
