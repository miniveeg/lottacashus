import { CASES, caseById, type CaseDef } from "./cases";

export type BattleSeat = {
  id: string;
  name: string;
  bot: boolean;
  totals: number[];
  prizeTotal: number;
};

export type BattleRound = {
  caseId: string;
  results: { seatId: string; amount: number; prizeLabel: string }[];
};

export type Battle = {
  id: string;
  caseId: string;
  seats: number;
  rounds: number;
  createdAt: number;
  status: "waiting" | "running" | "done";
  players: BattleSeat[];
  history: BattleRound[];
  winnerId?: string;
  pot: number;
};

const KEY = "lc_demo_battles";
const BOT_NAMES = ["Vex", "Nyx", "Rune", "Kite", "Sol", "Hex", "Ivy", "Zero"];

function loadAll(): Battle[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedLobby();
    const parsed = JSON.parse(raw) as Battle[];
    if (!Array.isArray(parsed)) return seedLobby();
    return parsed;
  } catch {
    return seedLobby();
  }
}

function saveAll(list: Battle[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

function seedLobby(): Battle[] {
  const now = Date.now();
  const seeded: Battle[] = [
    makeBattle("gold", 2, 1, now - 40_000, true),
    makeBattle("neon", 4, 3, now - 90_000, true),
    makeBattle("starter", 2, 2, now - 12_000, false),
  ];
  saveAll(seeded);
  return seeded;
}

function makeId(): string {
  return `btl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length]!;
}

function makeBattle(
  caseId: string,
  seats: number,
  rounds: number,
  createdAt: number,
  fillBots: boolean,
): Battle {
  const def = caseById(caseId) ?? CASES[0]!;
  const players: BattleSeat[] = fillBots
    ? Array.from({ length: seats }, (_, i) => ({
        id: `bot_${i}_${createdAt}`,
        name: botName(i),
        bot: true,
        totals: [],
        prizeTotal: 0,
      }))
    : [];
  const house = 0.02;
  const pot = Math.round(def.price * seats * rounds * (1 - house) * 100) / 100;
  return {
    id: makeId(),
    caseId: def.id,
    seats,
    rounds,
    createdAt,
    status: fillBots ? "done" : "waiting",
    players,
    history: [],
    winnerId: fillBots ? players[0]?.id : undefined,
    pot,
  };
}

export function listBattles(): Battle[] {
  return loadAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function getBattle(id: string): Battle | undefined {
  return loadAll().find((b) => b.id === id);
}

export function createBattle(opts: {
  caseId: string;
  seats: 2 | 4;
  rounds: 1 | 2 | 3;
  hostName: string;
}): Battle {
  const def = caseById(opts.caseId) ?? CASES[0]!;
  const battle = makeBattle(def.id, opts.seats, opts.rounds, Date.now(), false);
  battle.players = [
    {
      id: "you",
      name: opts.hostName || "You",
      bot: false,
      totals: [],
      prizeTotal: 0,
    },
  ];
  const all = loadAll();
  all.unshift(battle);
  saveAll(all.slice(0, 40));
  return battle;
}

export function saveBattle(battle: Battle): void {
  const all = loadAll();
  const i = all.findIndex((b) => b.id === battle.id);
  if (i >= 0) all[i] = battle;
  else all.unshift(battle);
  saveAll(all);
}

export function fillBots(battle: Battle): Battle {
  let i = 0;
  while (battle.players.length < battle.seats) {
    battle.players.push({
      id: `bot_${Date.now()}_${i}`,
      name: botName(battle.players.length + i),
      bot: true,
      totals: [],
      prizeTotal: 0,
    });
    i += 1;
  }
  return battle;
}

export function battleCase(battle: Battle): CaseDef {
  return caseById(battle.caseId) ?? CASES[0]!;
}

export function housePot(price: number, seats: number, rounds: number): number {
  return Math.round(price * seats * rounds * 0.98 * 100) / 100;
}
