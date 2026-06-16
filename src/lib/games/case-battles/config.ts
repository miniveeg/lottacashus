export type BattleGamemode = "normal" | "group" | "terminal" | "jackpot";

export type PlayerModeId =
  | "1v1"
  | "1v1v1"
  | "1v1v1v1"
  | "1v1v1v1v1v1"
  | "2v2"
  | "2v2v2"
  | "3v3"
  | "2p"
  | "3p"
  | "4p"
  | "6p";

export const GAMEMODES: {
  id: BattleGamemode;
  name: string;
  description: string;
  live: boolean;
}[] = [
  {
    id: "normal",
    name: "Normal",
    description: "The player with the greatest total unboxed wins.",
    live: true,
  },
  {
    id: "group",
    name: "Group",
    description: "Combined unboxed value is split equally among all human players.",
    live: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Only the final round unboxing counts — highest last drop wins.",
    live: true,
  },
  {
    id: "jackpot",
    name: "Jackpot",
    description: "One provably fair roll; odds proportional to total unboxed.",
    live: true,
  },
];

export const SOLO_PLAYER_MODES: { id: PlayerModeId; label: string; maxPlayers: number }[] = [
  { id: "1v1", label: "1v1", maxPlayers: 2 },
  { id: "1v1v1", label: "1v1v1", maxPlayers: 3 },
  { id: "1v1v1v1", label: "1v1v1v1", maxPlayers: 4 },
  { id: "1v1v1v1v1v1", label: "1v1v1v1v1v1", maxPlayers: 6 },
];

export const TEAM_PLAYER_MODES: { id: PlayerModeId; label: string; maxPlayers: number }[] = [
  { id: "2v2", label: "2v2", maxPlayers: 4 },
  { id: "2v2v2", label: "2v2v2", maxPlayers: 6 },
  { id: "3v3", label: "3v3", maxPlayers: 6 },
];

/** Group gamemode only — free-for-all with shared pot split. */
export const GROUP_PLAYER_MODES: { id: PlayerModeId; label: string; maxPlayers: number }[] = [
  { id: "2p", label: "2p", maxPlayers: 2 },
  { id: "3p", label: "3p", maxPlayers: 3 },
  { id: "4p", label: "4p", maxPlayers: 4 },
  { id: "6p", label: "6p", maxPlayers: 6 },
];

const GROUP_MODE_IDS = new Set(GROUP_PLAYER_MODES.map((m) => m.id));

export function isGroupPlayerMode(mode: string): boolean {
  return GROUP_MODE_IDS.has(mode as PlayerModeId);
}

export const MAX_CASES_PER_BATTLE = 50;
export const MAX_COPIES_PER_CASE_TYPE = 10;
export const MAX_BORROW_PERCENT = 80;

export function entryAfterBorrow(fullEntry: number, borrowPercent: number): number {
  const pct = Math.min(MAX_BORROW_PERCENT, Math.max(0, borrowPercent));
  return Math.round(fullEntry * (1 - pct / 100) * 100) / 100;
}

export function payoutKeepMultiplier(borrowPercent: number): number {
  const pct = Math.min(MAX_BORROW_PERCENT, Math.max(0, borrowPercent));
  return 1 - pct / 100;
}

export function caseSpinDelayMs(fastSpin: boolean): number {
  return fastSpin ? 2000 : 5000;
}

export function countCaseInSelection(caseIds: string[], caseId: string): number {
  return caseIds.filter((id) => id === caseId).length;
}

export function canAddCaseToSelection(caseIds: string[], caseId: string): boolean {
  if (caseIds.length >= MAX_CASES_PER_BATTLE) return false;
  if (countCaseInSelection(caseIds, caseId) >= MAX_COPIES_PER_CASE_TYPE) return false;
  return true;
}

export function maxPlayersForMode(mode: PlayerModeId | string): number {
  const all = [...SOLO_PLAYER_MODES, ...TEAM_PLAYER_MODES, ...GROUP_PLAYER_MODES];
  return all.find((m) => m.id === mode)?.maxPlayers ?? 0;
}

export function isTeamMode(mode: string): boolean {
  return mode === "2v2" || mode === "2v2v2" || mode === "3v3";
}

export const BATTLE_GAMEMODES = ["normal", "group", "terminal", "jackpot"] as const;

export function isValidGamemode(mode: string): mode is BattleGamemode {
  return (BATTLE_GAMEMODES as readonly string[]).includes(mode);
}

export function teamIndexForMode(mode: string, slot: number): number {
  switch (mode) {
    case "2v2":
      return slot < 2 ? 0 : 1;
    case "2v2v2":
      return Math.floor(slot / 2);
    case "3v3":
      return slot < 3 ? 0 : 1;
    default:
      return slot;
  }
}
