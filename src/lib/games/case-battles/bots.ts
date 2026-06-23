/** Display names for the 10 battle bots (must match insert_case_battle_bot
 *  migration roster in supabase/lottacash-complete-setup.sql).
 *
 *  Each name has a `[Bot]` suffix so players never mistake a bot for a real
 *  opponent, even at a glance. This pairs with the visual distinctions
 *  already in place: the slate-gray avatar gradient (--lc-slate) and the
 *  Bot icon in the player column. Audit issue #4.5. */
export const CASE_BATTLE_BOT_ROSTER = [
  "Rusty [Bot]",
  "Blitz [Bot]",
  "Nova [Bot]",
  "Cipher [Bot]",
  "Vega [Bot]",
  "Onyx [Bot]",
  "Rex [Bot]",
  "Flint [Bot]",
  "Jinx [Bot]",
  "Sable [Bot]",
] as const;

export type CaseBattleBotName = (typeof CASE_BATTLE_BOT_ROSTER)[number];

export const CASE_BATTLE_BOT_COUNT = CASE_BATTLE_BOT_ROSTER.length;
