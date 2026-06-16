export type CaseItem = {
  id: string;
  name: string;
  value: number;
  rarity: string;
  weight: number;
};

export type LootCase = {
  id: string;
  name: string;
  price: number;
  accent: string;
  items: CaseItem[];
};
