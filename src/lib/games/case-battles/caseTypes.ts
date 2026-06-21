export type CaseRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type CaseItem = {
  id: string;
  name: string;
  value: number;
  rarity: CaseRarity;
  weight: number;
};

export type LootCase = {
  id: string;
  name: string;
  price: number;
  accent: string;
  items: CaseItem[];
};

/** Rarity → display color, mapped to the Obsidian Luxury theme palette.
 *
 *  Progression ascends through the theme's semantic accents:
 *    common    → muted gray  (--lc-text-muted)
 *    uncommon  → emerald     (--lc-emerald)
 *    rare      → cyan        (--lc-cyan)
 *    epic      → violet      (--lc-violet)
 *    legendary → crimson     (--lc-crimson — the brand color, most prestigious)
 */
export const RARITY_COLORS: Record<CaseRarity, string> = {
  common: "#7a7a98",
  uncommon: "#00e87a",
  rare: "#38bdf8",
  epic: "#8b5cf6",
  legendary: "#dc143c",
};
