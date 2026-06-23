import { useEffect, useMemo, useRef, useState } from "react";
import type { CaseItem, LootCase } from "../../lib/games/case-battles";
import { RARITY_COLORS, type CaseRarity } from "../../lib/games/case-battles";
import { REEL_EASING } from "./reelConstants";
import "./CaseOpenReel.css";

const ITEM_H = 92;

export type ReelSpinProfile = {
  landIndex: number;
  stripLen: number;
  durationMs: number;
  easing: string;
};

/** Per-player scroll distance; shared duration + easing so all reels land
 *  together with a consistent feel. The landIndex varies per slot/round so
 *  each reel scrolls a slightly different distance (visual variety) but the
 *  easing curve is identical across all reels. */
export function getReelSpinProfile(
  slot: number,
  round: number,
  baseDurationMs: number
): ReelSpinProfile {
  const n = (((slot + 1) * 92837111) ^ ((round + 1) * 689287499)) >>> 0;
  const landIndex = 34 + (n % 18);
  const stripLen = landIndex + 8 + ((n >>> 4) % 7);
  return {
    landIndex,
    stripLen,
    durationMs: baseDurationMs,
    easing: REEL_EASING,
  };
}

/** Pick a filler item for the reel using a sqrt-flattened weighted
 *  distribution.
 *
 *  Previously this used uniform-random distribution, which visually implied
 *  far better odds for rare items than the case actually has. The actual drop
 *  is still correctly weighted server-side (this is purely visual filler),
 *  but a reel that's 90% common items looked "dead" — so we apply a mild
 *  flattening curve (sqrt of the weight) that makes rares show up MORE than
 *  their true odds but not at uniform frequency.
 *
 *  The math: instead of `weight` as the probability, we use `sqrt(weight)`.
 *  This compresses the dynamic range — a 40% item becomes ~63% as likely as
 *  before in the filler, while a 1% item becomes ~10% as likely. The reel
 *  stays visually varied without implying the case is far swingier than it is.
 *
 *  Audit issue #2.8. */
function pickFillerItem(lootCase: LootCase): CaseItem {
  const items = lootCase.items;
  if (items.length === 0) {
    // Defensive — should never happen (cases always have items), but
    // avoids a crash if the catalog is malformed.
    throw new Error("pickFillerItem: case has no items");
  }
  if (items.length === 1) return items[0]!;

  // Build a sqrt-flattened weight for each item. CaseItem.weight is always
  // present (required field), but we clamp to >= 0 for safety.
  const flattened = items.map((item) => Math.sqrt(Math.max(item.weight, 0)));
  const total = flattened.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    // All weights were zero/negative — fall back to uniform.
    return items[Math.floor(Math.random() * items.length)]!;
  }
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= flattened[i]!;
    if (r <= 0) return items[i]!;
  }
  // Floating-point drift fallback — return the last item.
  return items[items.length - 1]!;
}

/** Distinct icon per rarity so the reel scrolling is visually obvious.
 *  Different shapes at different rarities means the user can clearly see
 *  items changing as the reel scrolls, rather than the same ◆ repeating. */
const RARITY_ICONS: Record<CaseRarity, string> = {
  common: "●",
  uncommon: "▲",
  rare: "◆",
  epic: "★",
  legendary: "♛",
};

function ReelTile({
  item,
  accent,
  dimmed,
}: {
  item: CaseItem;
  accent: string;
  dimmed?: boolean;
}) {
  const color = RARITY_COLORS[item.rarity as CaseRarity] ?? "#7a7a98";
  const icon = RARITY_ICONS[item.rarity as CaseRarity] ?? "◆";
  return (
    <div
      className={"case-reel__tile" + (dimmed ? " case-reel__tile--dim" : "")}
      style={{
        borderLeft: `3px solid ${color}`,
        borderColor: `${color}55`,
        background: `linear-gradient(145deg, ${color}28, ${accent}08)`,
      }}
    >
      <span className="case-reel__tile-gem" style={{ color }} aria-hidden>
        {icon}
      </span>
      <span className="case-reel__tile-name">{item.name}</span>
      <span className="case-reel__tile-value" style={{ color }}>
        ${item.value.toLocaleString()}
      </span>
    </div>
  );
}

type CaseOpenReelProps = {
  lootCase: LootCase;
  targetItem: CaseItem;
  accent: string;
  spinKey: string;
  slot: number;
  round: number;
  baseDurationMs: number;
  itemHeight?: number;
  active: boolean;
  onComplete: () => void;
};

export function CaseOpenReel({
  lootCase,
  targetItem,
  accent,
  spinKey,
  slot,
  round,
  baseDurationMs,
  itemHeight = ITEM_H,
  active,
  onComplete,
}: CaseOpenReelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [landed, setLanded] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const profile = useMemo(
    () => getReelSpinProfile(slot, round, baseDurationMs),
    [slot, round, baseDurationMs]
  );

  const strip = useMemo(() => {
    const items: CaseItem[] = [];
    for (let i = 0; i < profile.stripLen; i++) {
      items.push(i === profile.landIndex ? targetItem : pickFillerItem(lootCase));
    }
    return items;
  }, [lootCase, targetItem, spinKey, profile.landIndex, profile.stripLen]);

  // Reset landed state whenever a new spin starts
  useEffect(() => {
    setLanded(false);
  }, [spinKey]);

  useEffect(() => {
    if (!active) return;
    const track = trackRef.current;
    if (!track) return;

    const endY = -(profile.landIndex * itemHeight) + itemHeight;
    track.style.transition = "none";
    track.style.transform = "translateY(0)";
    setSpinning(true);

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        track.style.transition = `transform ${profile.durationMs}ms ${profile.easing}`;
        track.style.transform = `translateY(${endY}px)`;
      });
    });

    const done = window.setTimeout(() => {
      setSpinning(false);
      setLanded(true);
      onCompleteRef.current();
    }, profile.durationMs + 80);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [active, profile.durationMs, profile.easing, profile.landIndex, spinKey, itemHeight]);

  return (
    <div
      className={
        "case-reel" +
        (spinning ? " case-reel--spinning" : "") +
        (landed ? " case-reel--landed" : "")
      }
      style={{
        ["--reel-accent" as string]: accent,
        ["--reel-item-h" as string]: `${itemHeight}px`,
      }}
    >
      <div className="case-reel__viewport">
        <div className="case-reel__fade case-reel__fade--top" aria-hidden />
        <div className="case-reel__center-line" aria-hidden />
        <div ref={trackRef} className="case-reel__track">
          {strip.map((item, i) => (
            <ReelTile
              key={`${spinKey}-${i}`}
              item={item}
              accent={accent}
              // Only dim non-winning tiles AFTER the reel has settled so the
              // winning item is not telegraphed while the strip is still moving.
              dimmed={landed && i !== profile.landIndex}
            />
          ))}
        </div>
        <div className="case-reel__fade case-reel__fade--bottom" aria-hidden />
      </div>
    </div>
  );
}

export const CASE_REEL_ITEM_HEIGHT = ITEM_H;