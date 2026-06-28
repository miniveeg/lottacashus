export type { CaseItem, CaseRarity, LootCase } from "./caseTypes";
export { RARITY_COLORS } from "./caseTypes";
export { GENERATED_CASE_CATALOG as CASE_CATALOG } from "./caseCatalog.generated";

import type { LootCase } from "./caseTypes";
import { GENERATED_CASE_CATALOG } from "./caseCatalog.generated";

// Pre-index the case catalog by ID at module load (audit M5). The previous
// linear `.find()` scanned up to 248 entries per call, and `getCaseById` is
// invoked ~250× per lobby render (50 rows × ~5 thumbnails) plus once per
// `caseId` in `battleEntryCostFromCaseIds`. The Map turns each lookup into
// an O(1) hash probe.
const CASE_BY_ID: ReadonlyMap<string, LootCase> = new Map(
  GENERATED_CASE_CATALOG.map((c) => [c.id, c]),
);

export function getCaseById(id: string): LootCase | undefined {
  return CASE_BY_ID.get(id);
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
