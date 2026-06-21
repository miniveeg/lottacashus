import { useEffect, useMemo, useRef, useState } from "react";
import type { CaseItem, LootCase } from "../../lib/games/case-battles";
import { RARITY_COLORS, type CaseRarity } from "../../lib/games/case-battles";
import "./CaseOpenReel.css";

const ITEM_H = 92;

/** Consistent easing curve for all reels — a strong deceleration that feels
 *  weighty and satisfying, similar to CS:GO / Rust case opening reels.
 *  All reels use the same curve so the multi-player columns feel unified
 *  rather than each having a slightly different stop pattern. */
const REEL_EASING = "cubic-bezier(0.08, 0.82, 0.17, 1)";

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

function pickRandomItem(lootCase: LootCase): CaseItem {
  const total = lootCase.items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of lootCase.items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return lootCase.items[lootCase.items.length - 1]!;
}

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
  return (
    <div
      className={"case-reel__tile" + (dimmed ? " case-reel__tile--dim" : "")}
      style={{ borderColor: `${color}55`, background: `linear-gradient(145deg, ${color}22, ${accent}11)` }}
    >
      <span className="case-reel__tile-gem" style={{ color }} aria-hidden>
        ◆
      </span>
      <span className="case-reel__tile-name">{item.name}</span>
      <span className="case-reel__tile-value">${item.value.toLocaleString()}</span>
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

  const profile = useMemo(
    () => getReelSpinProfile(slot, round, baseDurationMs),
    [slot, round, baseDurationMs]
  );

  const strip = useMemo(() => {
    const items: CaseItem[] = [];
    for (let i = 0; i < profile.stripLen; i++) {
      items.push(i === profile.landIndex ? targetItem : pickRandomItem(lootCase));
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

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        track.style.transition = `transform ${profile.durationMs}ms ${profile.easing}`;
        track.style.transform = `translateY(${endY}px)`;
      });
    });

    const done = window.setTimeout(() => {
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
      className={"case-reel" + (landed ? " case-reel--landed" : "")}
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