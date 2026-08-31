export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type CasePrize = {
  id: string;
  label: string;
  amount: number;
  weight: number;
  rarity: Rarity;
};

export type CaseDef = {
  id: string;
  name: string;
  tagline: string;
  price: number;
  accent: string;
  prizes: CasePrize[];
};

/**
 * Prize ladder as a fraction of case price. Weights tuned so
 * EV = 96.54% of price (house ~3.5%):
 *   0.4x w445 + 0.8x w278 + 1.0x w168 + 2x w76 + 5x w25 + 15x w8
 *   over 1000 = 965.4 / 1000.
 */
const WEIGHTS = [445, 278, 168, 76, 25, 8] as const;
const MULTIS = [0.4, 0.8, 1.0, 2.0, 5.0, 15.0] as const;
const RARITIES: Rarity[] = ["common", "common", "uncommon", "rare", "epic", "legendary"];
const LABELS = [
  "Dust",
  "Chip stack",
  "Even money",
  "Hot streak",
  "Vault spill",
  "Jackpot",
];

function prizesFor(price: number, prefix: string): CasePrize[] {
  return MULTIS.map((m, i) => ({
    id: `${prefix}-${i}`,
    label: LABELS[i]!,
    amount: Math.round(price * m * 100) / 100,
    weight: WEIGHTS[i]!,
    rarity: RARITIES[i]!,
  }));
}

export const CASES: CaseDef[] = [
  {
    id: "starter",
    name: "Starter Crate",
    tagline: "Dip a toe. Cheap thrills.",
    price: 10,
    accent: "#3cbf8a",
    prizes: prizesFor(10, "starter"),
  },
  {
    id: "neon",
    name: "Neon Box",
    tagline: "Electric pink nights.",
    price: 25,
    accent: "#8a2430",
    prizes: prizesFor(25, "neon"),
  },
  {
    id: "gold",
    name: "Gold Vault",
    tagline: "House gold, house rules.",
    price: 50,
    accent: "#c9a24a",
    prizes: prizesFor(50, "gold"),
  },
  {
    id: "obsidian",
    name: "Obsidian",
    tagline: "Black glass, sharp edges.",
    price: 100,
    accent: "#c9a24a",
    prizes: prizesFor(100, "obsidian"),
  },
  {
    id: "diamond",
    name: "Diamond",
    tagline: "Cold, clear, expensive.",
    price: 250,
    accent: "#ead28a",
    prizes: prizesFor(250, "diamond"),
  },
  {
    id: "jackpot",
    name: "Jackpot",
    tagline: "The room goes quiet.",
    price: 500,
    accent: "#8a2430",
    prizes: prizesFor(500, "jackpot"),
  },
];

export function caseById(id: string): CaseDef | undefined {
  return CASES.find((c) => c.id === id);
}

export function rollPrize(def: CaseDef, float01: number): CasePrize {
  const total = def.prizes.reduce((s, p) => s + p.weight, 0);
  let cursor = float01 * total;
  for (const p of def.prizes) {
    cursor -= p.weight;
    if (cursor < 0) return p;
  }
  return def.prizes[def.prizes.length - 1]!;
}

export function caseEv(def: CaseDef): number {
  const total = def.prizes.reduce((s, p) => s + p.weight, 0);
  return def.prizes.reduce((s, p) => s + p.amount * (p.weight / total), 0);
}
