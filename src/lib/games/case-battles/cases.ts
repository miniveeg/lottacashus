export type { CaseItem, CaseRarity, LootCase } from "./caseTypes";
export { RARITY_COLORS } from "./caseTypes";
export { GENERATED_CASE_CATALOG as CASE_CATALOG } from "./caseCatalog.generated";

import type { LootCase } from "./caseTypes";
import { GENERATED_CASE_CATALOG } from "./caseCatalog.generated";

export function getCaseById(id: string): LootCase | undefined {
  return GENERATED_CASE_CATALOG.find((c) => c.id === id);
}

export function battleEntryCost(caseId: string, rounds: number): number {
  const lootCase = getCaseById(caseId);
  if (!lootCase || rounds < 1) return 0;
  return Math.round(lootCase.price * rounds * 100) / 100;
}

export function battleEntryCostFromCaseIds(caseIds: string[]): number {
  let total = 0;
  for (const id of caseIds) {
    const lootCase = getCaseById(id);
    if (lootCase) total += lootCase.price;
  }
  return Math.round(total * 100) / 100;
}
