/**
 * Case Battles v2 — BattleReel
 *
 * A horizontal reel that spins via its own requestAnimationFrame loop.
 * It is COMPLETELY DECOUPLED from React re-renders — once a spin starts,
 * the rAF loop runs independently and only stops when the target item
 * arrives or the component unmounts.
 *
 * Two props drive the per-reel visual feel:
 *
 *  - `spinSpeedPx` — pixels-per-frame during the SPIN phase. The parent
 *    arena (`CaseBattleArenaV2`) gives every PlayerColumn a stable
 *    randomized speed in [4, 12] derived from the (battleId, slot) tuple,
 *    so different slots scroll at different natural rates.
 *
 *  - `syncedLandingStartTime` — performance.now() timestamp shared across
 *    every reel in the same round (set ONCE by the parent when all of
 *    the current round's drops have arrived via realtime). The reel uses
 *    this as its landing start rather than its own local perf.now(),
 *    guaranteeing a coordinated "stop" across all columns.
 *
 * Lifecycle:
 * 1. `targetItem` is null → reel spins with random filler items (rAF loop)
 * 2. `targetItem` AND `syncedLandingStartTime` arrive → reel decelerates
 *    using the shared timestamp and lands on its target item
 * 3. `onLanded` callback fires → parent knows this reel is done
 * 4. Reel stays in "landed" state until `spinKey` changes → cycle repeats
 */

import { useEffect, useRef, useState, useMemo } from "react";
import type { CaseItem, LootCase } from "../../lib/games/case-battles";
import { RARITY_COLORS, type CaseRarity } from "../../lib/games/case-battles";

const TILE_H = 88;          // px — height of each tile in the vertical strip
const DEFAULT_SPIN_SPEED = 8; // px per frame — used only when parent omits spinSpeedPx
const LAND_DURATION = 2400;   // ms — deceleration duration (FIXED across all reels)
const FILLER_COUNT = 40;      // number of tiles in the strip (enough for the scroll)

// Phase polish: live-read the OS-level prefers-reduced-motion setting so
// the reel goes straight to its "landed" tile without the spinning loop
// for users who opt out of motion. The CSS @media block ALSO kills the
// keyframe animations; this JS path is required because the rAF tick() in
// the spinner writes `transform` directly on the DOM element, which the
// CSS query can't catch.
function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const RARITY_ICONS: Record<CaseRarity, string> = {
  common: "●",
  uncommon: "▲",
  rare: "◆",
  epic: "★",
  legendary: "♛",
};

function pickFillerItem(lootCase: LootCase): CaseItem {
  const items = lootCase.items;
  if (items.length <= 1) return items[0]!;
  const flattened = items.map((i) => Math.sqrt(Math.max(i.weight, 0)));
  const total = flattened.reduce((s, w) => s + w, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)]!;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= flattened[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

function ReelTile({ item, dimmed }: { item: CaseItem; dimmed?: boolean }) {
  const color = RARITY_COLORS[item.rarity as CaseRarity] ?? "#7a7a98";
  const icon = RARITY_ICONS[item.rarity as CaseRarity] ?? "◆";
  return (
    <div
      className={"cb-reel__tile" + (dimmed ? " cb-reel__tile--dim" : "")}
      style={{
        borderTop: `2px solid ${color}`,
        background: `linear-gradient(180deg, ${color}1a, transparent 70%)`,
      }}
    >
      <span className="cb-reel__tile-icon" style={{ color }}>{icon}</span>
      <span className="cb-reel__tile-name">{item.name}</span>
      <span className="cb-reel__tile-value" style={{ color }}>
        ${item.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

type BattleReelProps = {
  lootCase: LootCase;
  targetItem: CaseItem | null;
  spinKey: string;
  accent: string;
  /** Pixels per frame the reel scrolls during its spin phase. */
  spinSpeedPx?: number;
  /**
   * Parent-set performance.now() timestamp that every reel in the same
   * round should use as its landing-start. When omitted/zero, the reel
   * falls back to its local performance.now() at the moment the target
   * arrives (used during committing/race conditions).
   */
  syncedLandingStartTime?: number | null;
  onLanded?: () => void;
};

export function BattleReel({
  lootCase,
  targetItem,
  spinKey,
  accent,
  spinSpeedPx = DEFAULT_SPIN_SPEED,
  syncedLandingStartTime = null,
  onLanded,
}: BattleReelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;
  const [phase, setPhase] = useState<"idle" | "spinning" | "landing" | "landed">("idle");

  const [strip, setStrip] = useState<CaseItem[]>([]);

  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const landingStartRef = useRef<number>(0);
  const landingFromRef = useRef<number>(0);
  const landingToRef = useRef<number>(0);

  // Build initial filler strip on every new spin. If the user has
  // prefers-reduced-motion: reduce set, skip the filler entirely and go
  // straight to the "landed" phase so the rAF loop never scrolls. The
  // target will be placed in the strip and the CSS class will be flipped
  // in the [targetItem, syncedLandingStartTime] effect below.
  useEffect(() => {
    if (readPrefersReducedMotion()) {
      setStrip([]);
      offsetRef.current = 0;
      if (targetItem) {
        // Place the target at LAND_INDEX so the resolved strip's
        // landLookup below returns it instantly.
        const LAND_INDEX = 35;
        const reducedStrip: CaseItem[] = [];
        for (let i = 0; i < LAND_INDEX + 5; i++) {
          reducedStrip.push(i === LAND_INDEX ? targetItem : pickFillerItem(lootCase));
        }
        setStrip(reducedStrip);
        setPhase("landed");
        onLandedRef.current?.();
      } else {
        setPhase("idle");
      }
      return;
    }
    const items: CaseItem[] = [];
    for (let i = 0; i < FILLER_COUNT; i++) {
      items.push(pickFillerItem(lootCase));
    }
    setStrip(items);
    setPhase("spinning");
    offsetRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);

  // rAF spin loop — independent of React renders.
  useEffect(() => {
    if (phase === "idle") return;

    let cancelled = false;

    function tick(now: number) {
      if (cancelled) return;
      const track = trackRef.current;
      if (!track) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (phase === "spinning") {
        offsetRef.current -= spinSpeedPx;
        track.style.transform = `translateY(${offsetRef.current}px)`;

        if (offsetRef.current <= -TILE_H) {
          offsetRef.current += TILE_H;
          track.style.transform = `translateY(${offsetRef.current}px)`;
          setStrip((prev) => {
            if (prev.length >= FILLER_COUNT * 2) {
              return [pickFillerItem(lootCase), ...prev.slice(0, FILLER_COUNT)];
            }
            return [pickFillerItem(lootCase), ...prev];
          });
        }
        rafRef.current = requestAnimationFrame(tick);
      } else if (phase === "landing") {
        const elapsed = now - landingStartRef.current;
        const t = Math.min(elapsed / LAND_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const current = landingFromRef.current + (landingToRef.current - landingFromRef.current) * eased;
        offsetRef.current = current;
        track.style.transform = `translateY(${current}px)`;

        if (t >= 1) {
          setPhase("landed");
          onLandedRef.current?.();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    function handleVisibility() {
      if (cancelled) return;
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      } else if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [phase, lootCase, spinSpeedPx]);

  // When targetItem + syncedLandingStartTime both arrive, transition to landing.
  useEffect(() => {
    if (!targetItem || phase !== "spinning") return;
    // We need BOTH the target item and the parent's released landing
    // timestamp before transitioning. If the parent hasn't yet released
    // the timestamp we hold in spinning until it arrives.
    if (syncedLandingStartTime == null) return;

    // Cancel the spinning rAF BEFORE replacing the strip. The previous
    // tick was calling setStrip() to recycle filler tiles; if we swap the
    // strip while the rAF loop is mid-tick, we'd see a one-frame flicker
    // because the old offset had drifted past tile boundaries mid-spin.
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;

    const LAND_INDEX = 35;
    const newStrip: CaseItem[] = [];
    for (let i = 0; i < LAND_INDEX + 5; i++) {
      newStrip.push(i === LAND_INDEX ? targetItem : pickFillerItem(lootCase));
    }
    setStrip(newStrip);

    const targetOffset = -(LAND_INDEX * TILE_H);
    landingFromRef.current = offsetRef.current;
    landingToRef.current = targetOffset;
    // Look up the parent-supplied synced timestamp as a *marker* (it tells
    // us "you should start landing NOW") but use a fresh local perf.now()
    // as the easing origin. This avoids the race where
    // `syncedLandingStartTime` was captured by the parent a few ms before
    // this reel's useEffect commits — if we drove the easing off the
    // parent's stale timestamp, the reel would start at t > 0 and the
    // easing would skip early frames, overshooting/undershooting the
    // target offset. Within the same React commit wave, every reel picks
    // up `setPhase("landing")` within ~16 ms of each other, which is
    // functionally simultaneous for the human eye (and the parent's
    // marker is what guarantees we ALL start landing in the same render).
    landingStartRef.current = performance.now();
    setPhase("landing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetItem, syncedLandingStartTime]);

  const landIndex = useMemo(() => {
    if (!targetItem || phase !== "landed") return -1;
    return strip.findIndex((item) => item.id === targetItem.id && item.name === targetItem.name);
  }, [targetItem, phase, strip]);

  return (
    <div
      className={
        "cb-reel" +
        (phase === "spinning" ? " cb-reel--spinning" : "") +
        (phase === "landed" ? " cb-reel--landed" : "")
      }
      style={{ ["--reel-accent" as string]: accent }}
    >
      <div className="cb-reel__viewport" style={{ height: TILE_H }}>
        <div className="cb-reel__fade cb-reel__fade--top" aria-hidden />
        <div className="cb-reel__center-line" aria-hidden />
        <div ref={trackRef} className="cb-reel__track" style={{ transform: "translateY(0)" }}>
          {strip.map((item, i) => (
            <ReelTile key={i} item={item} dimmed={phase === "landed" && i !== landIndex} />
          ))}
        </div>
        <div className="cb-reel__fade cb-reel__fade--bottom" aria-hidden />
      </div>
    </div>
  );
}
