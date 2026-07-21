/**
 * Case Battles v2 — JackpotWheel
 *
 * A horizontal slot-reel filled with one tile per contestant. Each tile
 * shows the contestant's username AND their win-percentage (odds derived
 * from total value, or its inverse when Crazy is active).
 *
 * REVISION vs prior version: the track now renders `TOTAL_COPIES = FULL_PASSES
 * + 2` copies of the contestant set so the wheel can complete the requested
 * visual passes AND land on the win tile at the viewport center WITHOUT
 * ever exposing blank space on either side of the viewport. Earlier
 * designs either used a single pass (too short for the visual momentum
 * we promised in the spec) or 3 copies alongside a `fullPasses*track` offset
 * that ran past the track's right edge.
 *
 * Math (verbatim; do not "simplify"):
 *   - track DOM width  = TOTAL_COPIES × N × TILE_W
 *   - target_copy_idx  = ⌊TOTAL_COPIES / 2⌋
 *   - DOM pos of WIN tile = (target_copy_idx × N + winIndex) × TILE_W
 *   - final offset    = viewportW/2 − TILE_W/2 − DOM_WIN_POS
 * The wheel starts at offset 0 (the first copy is fully visible from x=0
 * going right) and animates to the final offset. Because there are
 * `TOTAL_COPIES` copies in the track, every offset in [final_offset, 0]
 * keeps the viewport tiled — there is never a blank region on either side.
 *
 * Visual flow:
 *  1. Mount → spins horizontally via rAF with a quartic ease-out so the
 *     deceleration feels physical.
 *  2. After ~SPIN_DURATION lands on `winIndex` tile (center).
 *  3. Win tile glows amber and dims the losers; "Battle complete" panel
 *     underneath shows the winner + paid amount.
 *
 * The wheel is purely visual flair — the actual payout is distributed by
 * `CaseBattleArenaV2` based on `winningSlots` from the player rows. Crazy
 * jackpot inverts weights so the visual winner is the contestant with the
 * LOWEST total (highest inversion weight), matching the engine.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CaseBattleView } from "./types";
import { playerTotalValue } from "./caseBattlesApi";
import { formatCoins } from "../../lib/format";

type JackpotWheelProps = {
  battle: CaseBattleView;
  winningSlots: number[];
  userId: string | undefined;
};

const TILE_W = 140;          // px — width of each contestant tile
const SPIN_DURATION = 3400;  // ms — total scroll duration
const FULL_PASSES = 4;       // number of visual full passes before landing

// Phase polish: live-read the OS-level prefers-reduced-motion setting so
// the wheel lands immediately for users who opt out of motion. Pairs with
// the CSS @media block to suppress any residual marquee animations.
function readJackpotPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function JackpotWheel({ battle, winningSlots, userId }: JackpotWheelProps) {
  // Resolve contestant list (one reel tile per slot). Bots and humans are
  // both rendered so the wheel feels complete.
  const contestants = useMemo(
    () => [...battle.players].sort((a, b) => a.slot - b.slot),
    [battle.players],
  );

  // Each contestant's weight (∝ total value, or 1/total if Crazy).
  const weights = useMemo(() => {
    const totals = contestants.map((p) => playerTotalValue(battle.drops, p.slot));
    if (!battle.crazy) return totals.map((v) => Math.max(0.0001, v));
    const sum = totals.reduce((s, v) => s + v, 0);
    return totals.map((v) => Math.max(0.0001, sum - v + 0.0001));
  }, [contestants, battle.drops, battle.crazy]);

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  // Percentages always sum to exactly 100 — allocate the rounding remainder
  // to the highest-weight contestant so the display cannot drift.
  const percentages = useMemo(() => {
    if (totalWeight <= 0) return weights.map(() => 0);
    const floor = weights.map((w) => Math.floor((w / totalWeight) * 100));
    let remainder = 100 - floor.reduce((s, p) => s + p, 0);
    const order = weights
      .map((w, i) => ({ w, i }))
      .sort((a, b) => (b.w - a.w !== 0 ? b.w - a.w : a.i - b.i))
      .map((entry) => entry.i);
    for (let k = 0; remainder > 0 && k < order.length; k++) {
      floor[order[k]!]! += 1;
      remainder--;
    }
    return floor;
  }, [weights, totalWeight]);

  // Pick the win index — server-stored winningSlots first; else fall back
  // to the highest-weight tile (matches engine).
  const winIndex = useMemo(() => {
    if (winningSlots.length > 0) {
      const winnerSlot = winningSlots[0]!;
      const idx = contestants.findIndex((p) => p.slot === winnerSlot);
      if (idx >= 0) return idx;
    }
    let best = -1;
    let bestW = -Infinity;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i]! > bestW) { bestW = weights[i]!; best = i; }
    }
    return Math.max(0, best);
  }, [winningSlots, contestants, weights]);

  // ── Animation state ────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<number>(0);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (contestants.length === 0) return;
    let cancelled = false;
    const N = contestants.length;
    const TOTAL_COPIES = FULL_PASSES + 2;
    const TARGET_COPY_IDX = Math.floor(TOTAL_COPIES / 2);
    const targetDomPx = (TARGET_COPY_IDX * N + winIndex) * TILE_W;
    // Center the win tile in the visible viewport.
    const viewportW = trackRef.current?.parentElement?.clientWidth ?? 320;
    const fromOffset = 0;
    const toOffset = viewportW / 2 - TILE_W / 2 - targetDomPx;
    startRef.current = performance.now();

    // Phase polish: prefers-reduced-motion → snap directly to the win
    // position with no scroll animation. setLanded(true) still fires so
    // the winner-glow CSS class is applied immediately.
    if (readJackpotPrefersReducedMotion()) {
      const track = trackRef.current;
      if (track) track.style.transform = `translateX(${toOffset}px)`;
      setLanded(true);
      return;
    }

    function tick(now: number) {
      if (cancelled) return;
      const track = trackRef.current;
      if (!track) {
        requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - startRef.current;
      const t = Math.min(elapsed / SPIN_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 4); // quartic ease-out
      const offset = fromOffset + (toOffset - fromOffset) * eased;
      track.style.transform = `translateX(${offset}px)`;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        // Snap to exact pixel so rounding can't leave the tile off-center.
        track.style.transform = `translateX(${toOffset}px)`;
        setLanded(true);
      }
    }

    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestants.length, winIndex]);

  if (contestants.length === 0) return null;

  // Buffered tiles so the wheel can complete FULL_PASSES without blanks.
  const TOTAL_COPIES = FULL_PASSES + 2;

  return (
    <div
      className={"cb-jackpot" + (landed ? " cb-jackpot--landed" : "")}
      aria-label={landed ? "Jackpot winner" : "Spinning jackpot wheel"}
    >
      <div className="cb-jackpot__header">
        <span className="cb-jackpot__crown" aria-hidden>♛</span>
        <span className="cb-jackpot__label">Jackpot</span>
        <span className="cb-jackpot__crown" aria-hidden>♛</span>
      </div>

      <div className="cb-jackpot__viewport">
        <div className="cb-jackpot__pointer" aria-hidden />
        <div
          ref={trackRef}
          className="cb-jackpot__track"
          style={{
            width: TOTAL_COPIES * contestants.length * TILE_W,
            transform: "translateX(0)",
          }}
        >
          {Array.from({ length: TOTAL_COPIES }, (_, copyIdx) =>
            contestants.map((p, idx) => {
              const pct = percentages[idx] ?? 0;
              const isWinner = landed && idx === winIndex && copyIdx === Math.floor(TOTAL_COPIES / 2);
              const avatarSeedText = p.avatarSeed ?? "fallback";
              return (
                <div
                  key={`${copyIdx}-${p.slot}-${idx}`}
                  className={
                    "cb-jackpot__tile" +
                    (isWinner ? " cb-jackpot__tile--winner" : "") +
                    (landed && !isWinner ? " cb-jackpot__tile--dimmed" : "")
                  }
                  style={{ width: TILE_W }}
                >
                  <div
                    className="cb-jackpot__avatar"
                    style={{
                      background: `linear-gradient(135deg, hsl(${hashHue(avatarSeedText)}, 70%, 50%), hsl(${(hashHue(avatarSeedText) + 60) % 360}, 70%, 40%))`,
                    }}
                  >
                    {p.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="cb-jackpot__name">
                    {p.username}
                    {p.isBot && <span className="cb-jackpot__bot">BOT</span>}
                  </span>
                  <span className="cb-jackpot__pct">{pct}%</span>
                  <span className="cb-jackpot__pct-label">
                    {p.userId === userId ? "you" : ""}
                  </span>
                </div>
              );
            }),
          )}
        </div>
        <div className="cb-jackpot__fade cb-jackpot__fade--left" aria-hidden />
        <div className="cb-jackpot__fade cb-jackpot__fade--right" aria-hidden />
      </div>

      {landed && (
        <div className="cb-jackpot__result">
          {(() => {
            const winner = contestants[winIndex]!;
            if (!winner) return null;
            const gross =
              battle.potTotal *
              (100 - Math.max(0, Math.min(80, battle.borrowPercent))) /
              100;
            return (
              <p>
                Won <strong>{formatCoins(gross, battle.coinType)}</strong>
                {" · "}
                <strong>{winner.userId === userId ? "You" : winner.username}</strong>
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
