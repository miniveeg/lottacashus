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

export const RARITY_COLORS: Record<CaseRarity, string> = {
  common: "#94a3b8",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};
