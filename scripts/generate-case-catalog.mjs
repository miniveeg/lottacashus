/**
 * One-off generator: diceblox_cases.json → caseCatalog.generated.ts
 * Preserves ticket weights & price ratios; new case/item names; no external images.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = process.argv[2] ?? "C:/Users/ajame/Downloads/diceblox_cases.json";
const OUT_CLIENT = path.join(ROOT, "src/lib/games/case-battles/caseCatalog.generated.ts");
const OUT_SERVER = path.join(ROOT, "supabase/functions/_shared/caseCatalog.generated.ts");

/** Diceblox balance units → USD (540 balance = $1). */
const BALANCE_PER_USD = 540;

const CASE_A = [
  "Velvet", "Crimson", "Azure", "Golden", "Shadow", "Neon", "Copper", "Ivory", "Onyx", "Scarlet",
  "Frost", "Ember", "Jade", "Silver", "Obsidian", "Solar", "Lunar", "Royal", "Mystic", "Prism",
  "Amber", "Sapphire", "Ruby", "Cobalt", "Platinum", "Bronze", "Arctic", "Volcanic", "Cosmic", "Rustic",
  "Silent", "Blazing", "Hidden", "Lucky", "Wild", "Grand", "Prime", "Ultra", "Hyper", "Mega",
  "Turbo", "Nova", "Echo", "Pulse", "Flux", "Zen", "Rogue", "Noble", "Ancient", "Future",
];
const CASE_B = [
  "Vault", "Cache", "Crate", "Hoard", "Reliquary", "Strongbox", "Trove", "Stash", "Chest", "Bundle",
  "Reserve", "Collection", "Selection", "Series", "Edition", "Chamber", "Gallery", "Parlor", "Arcade", "Market",
  "Depot", "Emporium", "Bazaar", "Atelier", "Foundry", "Observatory", "Citadel", "Harbor", "Garden", "Arena",
  "Odyssey", "Horizon", "Summit", "Cascade", "Mirage", "Spectrum", "Fortune", "Destiny", "Legacy", "Fortune",
  "Rush", "Spin", "Flip", "Roll", "Gamble", "Wager", "Pot", "Prize", "Jackpot", "Windfall",
];

const ITEM_A = [
  "Solar", "Lunar", "Crystal", "Mythic", "Royal", "Ancient", "Neon", "Shadow", "Golden", "Silver",
  "Copper", "Jade", "Ruby", "Sapphire", "Emerald", "Onyx", "Ivory", "Crimson", "Azure", "Violet",
  "Prism", "Echo", "Pulse", "Nova", "Flux", "Zen", "Wild", "Lucky", "Grand", "Prime",
  "Hidden", "Blazing", "Frost", "Ember", "Cosmic", "Rustic", "Silent", "Noble", "Rogue", "Turbo",
];
const ITEM_B = [
  "Sigil", "Relic", "Token", "Shard", "Crown", "Medallion", "Charm", "Talisman", "Idol", "Statue",
  "Gem", "Coin", "Chip", "Ticket", "Scroll", "Seal", "Badge", "Ribbon", "Star", "Comet",
  "Ring", "Chain", "Plate", "Disc", "Orb", "Cube", "Key", "Lock", "Chest", "Banner",
  "Mask", "Helm", "Gauntlet", "Blade", "Wand", "Lens", "Core", "Node", "Spark", "Flare",
];

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function toUsd(raw) {
  const v = raw / BALANCE_PER_USD;
  if (v < 0.01) return 0.01;
  if (v < 1) return Math.round(v * 100) / 100;
  if (v < 100) return Math.round(v * 100) / 100;
  return Math.round(v * 100) / 100;
}

function caseName(i) {
  const a = CASE_A[i % CASE_A.length];
  const b = CASE_B[Math.floor(i / CASE_A.length) % CASE_B.length];
  const tier = Math.floor(i / (CASE_A.length * CASE_B.length));
  return tier > 0 ? `${a} ${b} ${tier + 1}` : `${a} ${b}`;
}

function itemName(caseIndex, itemIndex) {
  const a = ITEM_A[(caseIndex * 3 + itemIndex) % ITEM_A.length];
  const b = ITEM_B[(caseIndex * 7 + itemIndex * 2) % ITEM_B.length];
  return `${a} ${b}`;
}

function rarityForValue(value, values) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.indexOf(value);
  const pct = sorted.length <= 1 ? 1 : rank / (sorted.length - 1);
  if (pct >= 0.85) return "legendary";
  if (pct >= 0.65) return "epic";
  if (pct >= 0.45) return "rare";
  if (pct >= 0.25) return "uncommon";
  return "common";
}

function accentForPrice(price) {
  if (price >= 50000) return "#f59e0b";
  if (price >= 5000) return "#ef4444";
  if (price >= 500) return "#a855f7";
  if (price >= 50) return "#3b82f6";
  if (price >= 5) return "#22c55e";
  return "#94a3b8";
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const sourceCases = raw
    .map((e) => e.nextData?.props?.pageProps?.case)
    .filter(Boolean)
    .sort((a, b) => a.price - b.price);

  const usedSlugs = new Set();
  const catalog = sourceCases.map((src, caseIndex) => {
    const name = caseName(caseIndex);
    let id = slugify(name);
    let n = 2;
    while (usedSlugs.has(id)) {
      id = `${slugify(name)}-${n++}`;
    }
    usedSlugs.add(id);

    const price = toUsd(src.price);
    const itemValues = src.items.map((it) => toUsd(it.value));
    const items = src.items.map((it, itemIndex) => {
      const weight = it.maxTicket - it.minTicket + 1;
      const value = toUsd(it.value);
      const rarity = rarityForValue(value, itemValues);
      return {
        id: `${id}-i${itemIndex}`,
        name: itemName(caseIndex, itemIndex),
        value,
        rarity,
        weight,
      };
    });

    return { id, name, price, accent: accentForPrice(price), items };
  });

  const chunks = catalog.map((c) => {
    const items = c.items
      .map(
        (i) =>
          `      { id: ${JSON.stringify(i.id)}, name: ${JSON.stringify(i.name)}, value: ${i.value}, rarity: ${JSON.stringify(i.rarity)}, weight: ${i.weight} }`
      )
      .join(",\n");
    return `  {
    id: ${JSON.stringify(c.id)},
    name: ${JSON.stringify(c.name)},
    price: ${c.price},
    accent: ${JSON.stringify(c.accent)},
    items: [
${items}
    ],
  }`;
  });

  const header = `/** AUTO-GENERATED catalog — run: node scripts/generate-case-catalog.mjs */\nimport type { LootCase } from "./caseTypes";\n\nexport const GENERATED_CASE_CATALOG: LootCase[] = [\n`;
  const body = `${header}${chunks.join(",\n")}\n];\n`;
  fs.writeFileSync(OUT_CLIENT, body);

  const serverHeader = `/** AUTO-GENERATED — keep in sync with src/lib/games/case-battles/caseCatalog.generated.ts */\nimport type { LootCase } from "./caseBattlesTypes.ts";\n\nexport const GENERATED_CASE_CATALOG: LootCase[] = [\n`;
  fs.writeFileSync(OUT_SERVER, serverHeader + chunks.join(",\n") + "\n];\n");

  console.log(`Wrote ${catalog.length} cases to ${OUT_CLIENT}`);
  console.log(`Wrote ${catalog.length} cases to ${OUT_SERVER}`);
  console.log(`Price range: $${catalog[0].price} – $${catalog[catalog.length - 1].price}`);
}
main();
