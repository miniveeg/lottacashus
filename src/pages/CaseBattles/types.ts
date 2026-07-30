/**
 * Case Battles v2 — shared types.
 * Clean, minimal types for the rebuilt Case Battles game mode.
 *
 * 4 base gamemodes + a Crazy toggle:
 * - Standard: highest total value wins → Crazy: lowest total value wins
 * - Group: all humans split the pot → Crazy: NOT ALLOWED
 * - Terminal: highest last-round value wins → Crazy: lowest last-round value wins
 * - Jackpot: odds proportional to total value → Crazy: odds REVERSED (lowest = highest chance)
 */

export type BattleGamemode = "standard" | "group" | "terminal" | "jackpot";

export type BattleStatus = "waiting" | "committing" | "running" | "completed" | "cancelled";

export type BattlePlayer = {
  slot: number;
  userId: string | null;
  isBot: boolean;
  username: string;
  avatarSeed: string | null;
  /** Edge-computed credit for this slot after resolution (0 if none). */
  payoutAmount: number;
  /** ISO timestamp when the player claimed, if any. */
  claimedAt: string | null;
};

export type BattleDrop = {
  slot: number;
  round: number;
  caseId: string;
  itemId: string;
  itemName: string;
  itemValue: number;
  itemRarity: string;
};

export type CaseBattleView = {
  battleId: string;
  creatorId: string;
  gamemode: BattleGamemode;
  crazy: boolean;
  playerMode: string;
  maxPlayers: number;
  caseIds: string[];
  rounds: number;
  entryCost: number;
  coinType: "balance" | "sweeps_coins";
  borrowPercent: number;
  potTotal: number;
  status: BattleStatus;
  seedHash: string | null;
  eosBlockTarget: number | null;
  eosBlockId: string | null;
  battleSeed: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  players: BattlePlayer[];
  drops: BattleDrop[];
  /**
   * All slots that share the payout. For solo modes, tied slots for the
   * best score all appear here (50/50 or 33/33/33 split). For team modes
   * every human slot on a tied winning team. For Group every human. For
   * Jackpot typically a single slot. Optional because not all battles
   * backfill winningSlots (older rows in the DB may not have it).
   */
  winningSlots?: number[];
  /**
   * Number of players currently in the battle. Populated by the lobby
   * query (a separate batch count against `case_battle_players` — the
   * `BATTLE_COLUMNS` SELECT for the lobby intentionally omits the
   * `players` array to keep payload small). Defaults to 0 when unknown.
   */
  playerCount: number;
};

export type GamemodeInfo = {
  id: BattleGamemode;
  name: string;
  description: string;
  icon: string;
  canBeCrazy: boolean;
};

export const GAMEMODES: GamemodeInfo[] = [
  { id: "standard", name: "Standard", description: "Highest total value wins the pot.", icon: "🏆", canBeCrazy: true },
  { id: "group", name: "Group", description: "All players split the pot equally.", icon: "👥", canBeCrazy: false },
  { id: "terminal", name: "Terminal", description: "Only the final round counts.", icon: "🎯", canBeCrazy: true },
  { id: "jackpot", name: "Jackpot", description: "Odds proportional to your unboxed value.", icon: "💰", canBeCrazy: true },
];

export type PlayerModeOption = {
  id: string;
  label: string;
  maxPlayers: number;
};

// Solo + Team modes for Standard, Terminal, Jackpot
export const SOLO_TEAM_MODES: PlayerModeOption[] = [
  { id: "1v1", label: "1v1", maxPlayers: 2 },
  { id: "1v1v1", label: "1v1v1", maxPlayers: 3 },
  { id: "1v1v1v1", label: "1v1v1v1", maxPlayers: 4 },
  { id: "2v2", label: "2v2", maxPlayers: 4 },
  { id: "2v2v2", label: "2v2v2", maxPlayers: 6 },
  { id: "3v3", label: "3v3", maxPlayers: 6 },
];

// Group-only modes (includes 6p to match config/engine)
export const GROUP_MODES: PlayerModeOption[] = [
  { id: "2p", label: "2p", maxPlayers: 2 },
  { id: "3p", label: "3p", maxPlayers: 3 },
  { id: "4p", label: "4p", maxPlayers: 4 },
  { id: "6p", label: "6p", maxPlayers: 6 },
];

export function isTeamMode(mode: string): boolean {
  return mode === "2v2" || mode === "2v2v2" || mode === "3v3";
}

export function playerModeOptions(gamemode: BattleGamemode): PlayerModeOption[] {
  if (gamemode === "group") return GROUP_MODES;
  return SOLO_TEAM_MODES;
}

export function maxPlayersForMode(mode: string): number {
  const all = [...SOLO_TEAM_MODES, ...GROUP_MODES];
  return all.find((m) => m.id === mode)?.maxPlayers ?? 2;
}

export function gamemodeLabel(mode: BattleGamemode): string {
  return GAMEMODES.find((g) => g.id === mode)?.name ?? mode;
}

export function gamemodeLabelWithCrazy(mode: BattleGamemode, crazy: boolean): string {
  const base = gamemodeLabel(mode);
  return crazy ? `Crazy ${base}` : base;
}
