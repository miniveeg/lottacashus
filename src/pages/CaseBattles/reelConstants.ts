/**
 * Shared reel constants for Case Battles.
 *
 * Extracted from CaseOpenReel.tsx and JackpotReel.tsx so both reels use the
 * same easing curve and the same source-of-truth for slot colors (which
 * previously hand-duplicated the theme.css hex values).
 *
 * Audit issues #2.9 (shared easing) and #2.10 (slot color source of truth).
 */

/** Consistent easing curve for all reels — a strong deceleration that feels
 *  weighty and satisfying, similar to CS:GO / Rust case opening reels.
 *  All reels use the same curve so the multi-player columns feel unified
 *  rather than each having a slightly different stop pattern. */
export const REEL_EASING = "cubic-bezier(0.08, 0.82, 0.17, 1)";

/** Per-slot accent colors, drawn from the Obsidian Luxury theme palette.
 *  Each player gets a distinct semantic color so columns are easy to track.
 *
 *  These hex values MUST stay in sync with the `--lc-crimson`, `--lc-violet`,
 *  `--lc-emerald`, `--lc-cyan`, `--lc-ruby`, and `--lc-crimson-soft` tokens
 *  in src/styles/theme.css. They're duplicated here as raw hex because CSS
 *  custom properties can't be read synchronously at module-init time without
 *  a `getComputedStyle` round-trip (and we don't want to gate reel rendering
 *  on a layout query).
 *
 *  If you retune the brand palette, update theme.css AND this array. */
export const SLOT_COLORS: readonly string[] = [
  "#dc143c", // --lc-crimson
  "#8b5cf6", // --lc-violet
  "#00e87a", // --lc-emerald
  "#38bdf8", // --lc-cyan
  "#ff3b5c", // --lc-ruby
  "#ff2d55", // --lc-crimson-soft
] as const;

/** Default accent when a slot index exceeds the palette length. */
export const SLOT_COLOR_DEFAULT = "#dc143c";

/** Get the accent color for a given slot index, with wraparound + fallback. */
export function slotColor(slot: number): string {
  return SLOT_COLORS[slot % SLOT_COLORS.length] ?? SLOT_COLOR_DEFAULT;
}
