import { createElement, type ReactNode } from "react";
import { Target, Trophy, Users, Dice5 } from "lucide-react";
import type { BattleGamemode } from "../../lib/games/case-battles/config";
import { GAMEMODES, isTeamMode, teamIndexForMode } from "../../lib/games/case-battles/config";
import type { OpenBattleRow } from "../../lib/caseBattles";

/** Slot groups for lobby layout. Group gamemode = one row, no dividers. Team modes = per team. Solo = one slot per group. */
export function battleSlotGroups(
  playerMode: string,
  gamemode: string,
  maxPlayers: number
): number[][] {
  if (gamemode === "group") {
    return [Array.from({ length: maxPlayers }, (_, i) => i)];
  }
  if (isTeamMode(playerMode)) {
    const teams = new Map<number, number[]>();
    for (let slot = 0; slot < maxPlayers; slot++) {
      const team = teamIndexForMode(playerMode, slot);
      const list = teams.get(team) ?? [];
      list.push(slot);
      teams.set(team, list);
    }
    return [...teams.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, slots]) => slots);
  }
  return Array.from({ length: maxPlayers }, (_, slot) => [slot]);
}

export function gamemodeLabel(id: string): string {
  return GAMEMODES.find((m) => m.id === id)?.name ?? id;
}

/**
 * Returns a decorative lucide-react icon element for a Case Battle gamemode.
 * Icons are rendered with `aria-hidden` by the caller (they sit alongside a
 * visible text label, so screen readers don't need them). Replaces the prior
 * emoji-as-icon implementation (👥 🎯 🎰 🏆) which violated the
 * "emoji used as functional icon" anti-pattern.
 *
 * Uses `createElement` rather than JSX because this module is `.ts` (no JSX
 * parse) — keeps the existing file name + import paths intact.
 */
export function gamemodeIcon(id: string): ReactNode {
  switch (id as BattleGamemode) {
    case "group":
      return createElement(Users, { "aria-hidden": true, size: 16 });
    case "terminal":
      return createElement(Target, { "aria-hidden": true, size: 16 });
    case "jackpot":
      return createElement(Dice5, { "aria-hidden": true, size: 16 });
    default:
      return createElement(Trophy, { "aria-hidden": true, size: 16 });
  }
}

export function formatBattleAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "Just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function uniqueCaseIdsFromRow(ids: string[] | null | undefined, fallback: string): string[] {
  const list = ids?.length ? ids : [fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function battleStatusLabel(status: string): string {
  switch (status) {
    case "pending_eos":
      return "Mining EOS";
    case "running":
      return "Live";
    case "completed":
      return "Ended";
    default:
      return "Open";
  }
}

export function battleIsJoinable(row: OpenBattleRow): boolean {
  return row.status === "waiting";
}
