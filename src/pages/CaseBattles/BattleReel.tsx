/**
 * Case Battles v2 — BattleReel
 *
 * A horizontal reel that spins via its own requestAnimationFrame loop.
 * It is COMPLETELY DECOUPLED from React re-renders — once a spin starts,
 * the rAF loop runs independently and only stops when the target item
 * arrives or the component unmounts.
 *
 * Lifecycle:
 * 1. `targetItem` is null → reel spins with random filler items (rAF loop)
 * 2. `targetItem` arrives (via realtime) → reel decelerates and lands on it
 * 3. `onLanded` callback fires → parent knows this reel is done
 * 4. Reel stays in "landed" state until `spinKey` changes → cycle repeats
 *
 * This design means the parent can re-render as much as it wants (from
 * realtime updates) without ever interrupting an in-progress animation.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import type { CaseItem, LootCase } from "../../lib/games/case-battles";
import { RARITY_COLORS, type CaseRarity } from "../../lib/games/case-battles";

const TILE_H = 88; // px — height of each tile in the vertical strip
const SPIN_SPEED = 8; // px per frame — how fast the reel scrolls during spin
const LAND_DURATION = 2400; // ms — deceleration duration
const FILLER_COUNT = 40; // number of tiles in the strip (enough for the scroll)

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
  // sqrt-flattened weight (same as v1 — makes rares show up more than
  // their true odds for visual variety without implying false odds)
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
      <span className="cb-reel__tile-icon" style={{ color }}>
        {icon}
      </span>
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
  spinKey: string; // changes when a new spin should start
  accent: string;
  onLanded?: () => void;
};

export function BattleReel({ lootCase, targetItem, spinKey, accent, onLanded }: BattleReelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;
  const [phase, setPhase] = useState<"idle" | "spinning" | "landing" | "landed">("idle");

  // Build the filler strip once per spin. When targetItem arrives, we
  // rebuild the strip with the target item placed at a landing position.
  const [strip, setStrip] = useState<CaseItem[]>([]);

  // Track the current scroll position (px, negative = scrolled up)
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const landingStartRef = useRef<number>(0);
  const landingFromRef = useRef<number>(0);
  const landingToRef = useRef<number>(0);

  // Build initial filler strip
  useEffect(() => {
    const items: CaseItem[] = [];
    for (let i = 0; i < FILLER_COUNT; i++) {
      items.push(pickFillerItem(lootCase));
    }
    setStrip(items);
    setPhase("spinning");
    offsetRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);

  // rAF spin loop — runs independently of React renders
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
        // Linear scroll — constant speed
        offsetRef.current -= SPIN_SPEED;
        track.style.transform = `translateY(${offsetRef.current}px)`;

        // Wrap: if we've scrolled past one tile, shift the strip array
        // to create an infinite scroll effect.
        if (offsetRef.current <= -TILE_H) {
          offsetRef.current += TILE_H;
          track.style.transform = `translateY(${offsetRef.current}px)`;
          // Prepend a new filler item to keep the strip infinite
          setStrip((prev) => {
            if (prev.length >= FILLER_COUNT * 2) {
              return [pickFillerItem(lootCase), ...prev.slice(0, FILLER_COUNT)];
            }
            return [pickFillerItem(lootCase), ...prev];
          });
        }
        rafRef.current = requestAnimationFrame(tick);
      } else if (phase === "landing") {
        // Ease-out deceleration to the target position
        const elapsed = now - landingStartRef.current;
        const t = Math.min(elapsed / LAND_DURATION, 1);
        // cubic ease-out: 1 - (1-t)^3
        const eased = 1 - Math.pow(1 - t, 3);
        const current = landingFromRef.current + (landingToRef.current - landingFromRef.current) * eased;
        offsetRef.current = current;
        track.style.transform = `translateY(${current}px)`;

        if (t >= 1) {
          setPhase("landed");
          onLandedRef.current?.();
          return; // stop the rAF loop
        }
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [phase, lootCase]);

  // When targetItem arrives, rebuild the strip with the target at a known
  // position and transition to "landing" phase.
  useEffect(() => {
    if (!targetItem || phase !== "spinning") return;

    // Build a new strip: put the target item at index 35 (near the end),
    // filler everywhere else.
    const LAND_INDEX = 35;
    const newStrip: CaseItem[] = [];
    for (let i = 0; i < LAND_INDEX + 5; i++) {
      newStrip.push(i === LAND_INDEX ? targetItem : pickFillerItem(lootCase));
    }
    setStrip(newStrip);

    // The target position: we want the target tile to be centered in the
    // viewport. The viewport shows 1 tile (height = TILE_H). The center
    // is at offset 0, so the target tile's top should be at offset 0.
    // Since the track scrolls UP (negative Y), the target at index LAND_INDEX
    // needs to scroll to: -(LAND_INDEX * TILE_H) + (some offset to center it)
    const targetOffset = -(LAND_INDEX * TILE_H);
    const currentOffset = offsetRef.current;

    landingFromRef.current = currentOffset;
    landingToRef.current = targetOffset;
    landingStartRef.current = performance.now();
    setPhase("landing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetItem]);

  // Find the index of the target item in the strip (for dimming non-winners)
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
