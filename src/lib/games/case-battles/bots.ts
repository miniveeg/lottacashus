/** Display names for the 10 battle bots (must match insert_case_battle_bot migration roster). */
export const CASE_BATTLE_BOT_ROSTER = [
  "Rusty",
  "Blitz",
  "Nova",
  "Cipher",
  "Vega",
  "Onyx",
  "Rex",
  "Flint",
  "Jinx",
  "Sable",
] as const;

export type CaseBattleBotName = (typeof CASE_BATTLE_BOT_ROSTER)[number];

export const CASE_BATTLE_BOT_COUNT = CASE_BATTLE_BOT_ROSTER.length;
