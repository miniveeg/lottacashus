import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCoins } from "../../lib/format";
import type { CaseBattlePlayer } from "../../lib/caseBattles";
import { Bot, User } from "lucide-react";
import "./JackpotReel.css";

const REEL_COPIES = 20;
const SPIN_MS_DEFAULT = 5200;
const EXTRA_CYCLES = 4;
const SPIN_EASING = "cubic-bezier(0.15, 0.85, 0.2, 1)";

type JackpotWeight = { slot: number; weight: number };

type JackpotReelProps = {
  players: CaseBattlePlayer[];
  weights: JackpotWeight[];
  targetSlot: number;
  spinDurationMs?: number;
  jackpotEosBlockId?: string | null;
  onComplete: () => void;
};

type StripEntry = { player: CaseBattlePlayer; pct: number };

/** Per-slot accent colors, drawn from the Obsidian Luxury theme palette.
 *  Each player gets a distinct semantic color so columns are easy to track. */
const SLOT_COLORS = ["#dc143c", "#8b5cf6", "#00e87a", "#38bdf8", "#ff3b5c", "#ff2d55"];

function PlayerTile({
  player,
  pct,
  highlight,
  color,
}: {
  player: CaseBattlePlayer;
  pct: number;
  highlight?: boolean;
  color: string;
}) {
  return (
    <div
      className={"cb-jackpot-reel__tile" + (highlight ? " cb-jackpot-reel__tile--win" : "")}
      style={{ ["--jp-color" as string]: color }}
    >
      <span className="cb-jackpot-reel__avatar" aria-hidden>
        {player.isBot ? <Bot size={14} /> : <User size={14} />}
      </span>
      <span className="cb-jackpot-reel__name">{player.displayName}</span>
      <span className="cb-jackpot-reel__pct">{pct.toFixed(1)}%</span>
      <span className="cb-jackpot-reel__val">{formatCoins(player.totalValue, "balance")}</span>
    </div>
  );
}

function buildCycleStrip(sorted: CaseBattlePlayer[], weights: JackpotWeight[]): StripEntry[] {
  const totalW = weights.reduce((s, w) => s + w.weight, 0) || 1;
  return sorted.map((player) => {
    const w = weights.find((x) => x.slot === player.slot)?.weight ?? 1;
    return { player, pct: (w / totalW) * 100 };
  });
}

/** Layout offset to center a tile under the viewport pointer (immune to track transform). */
function centerTranslateX(viewport: HTMLElement, tile: HTMLElement): number {
  const viewportCenter = viewport.clientWidth / 2;
  const tileCenter = tile.offsetLeft + tile.offsetWidth / 2;
  return viewportCenter - tileCenter;
}

export function JackpotReel({
  players,
  weights,
  targetSlot,
  spinDurationMs = SPIN_MS_DEFAULT,
  jackpotEosBlockId,
  onComplete,
}: JackpotReelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  const spinGenRef = useRef(0);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);

  onCompleteRef.current = onComplete;

  const sorted = useMemo(() => [...players].sort((a, b) => a.slot - b.slot), [players]);
  const cycle = useMemo(() => buildCycleStrip(sorted, weights), [sorted, weights]);
  const cycleLen = cycle.length;

  const targetIndexInCycle = useMemo(() => {
    const idx = cycle.findIndex((e) => e.player.slot === targetSlot);
    return idx >= 0 ? idx : 0;
  }, [cycle, targetSlot]);

  const strip = useMemo(
    () => Array.from({ length: REEL_COPIES }, () => cycle).flat(),
    [cycle]
  );

  const landIndex = useMemo(() => {
    const mid = Math.floor(REEL_COPIES / 2);
    return mid * cycleLen + targetIndexInCycle;
  }, [cycleLen, targetIndexInCycle]);

  const winnerPlayer = sorted.find((p) => p.slot === targetSlot) ?? sorted[0];

  const slotColor = useCallback(
    (slot: number) => SLOT_COLORS[slot % SLOT_COLORS.length] ?? "#dc143c",
    []
  );

  useEffect(() => {
    spinGenRef.current += 1;
    setHighlightIndex(null);
    setLayoutReady(false);
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translateX(0)";
    }
  }, [targetSlot, players.length, cycleLen]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const check = () => {
      const track = trackRef.current;
      const endTile = track?.children[landIndex] as HTMLElement | undefined;
      const ready =
        cycleLen > 0 &&
        viewport.clientWidth > 0 &&
        track != null &&
        track.children.length > landIndex &&
        (endTile?.offsetWidth ?? 0) > 0;
      setLayoutReady(ready);
    };

    check();
    const ro = new ResizeObserver(() => check());
    ro.observe(viewport);
    if (trackRef.current) ro.observe(trackRef.current);

    return () => ro.disconnect();
  }, [strip.length, landIndex, cycleLen]);

  useEffect(() => {
    if (!layoutReady || cycleLen === 0) return;

    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || strip.length === 0) return;

    const spinGen = spinGenRef.current;
    const startIndex = Math.min(landIndex + cycleLen * EXTRA_CYCLES, strip.length - 1);
    const startTile = track.children[startIndex] as HTMLElement | undefined;
    const endTile = track.children[landIndex] as HTMLElement | undefined;
    if (!startTile || !endTile) return;

    let cancelled = false;
    let finished = false;
    let raf2 = 0;
    let fallback = 0;

    track.style.transition = "none";
    track.style.transform = "translateX(0)";
    void track.offsetHeight;

    const endX = centerTranslateX(viewport, endTile);
    const startX = centerTranslateX(viewport, startTile);

    track.style.transform = `translateX(${startX}px)`;
    void track.offsetHeight;

    const finish = () => {
      if (finished || cancelled || spinGenRef.current !== spinGen) return;
      finished = true;
      track.style.transition = "none";
      track.style.transform = `translateX(${endX}px)`;
      setHighlightIndex(landIndex);
      onCompleteRef.current();
    };

    const onEnd = (e: TransitionEvent) => {
      if (e.target !== track || e.propertyName !== "transform") return;
      track.removeEventListener("transitionend", onEnd);
      finish();
    };

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled || spinGenRef.current !== spinGen) return;

        track.addEventListener("transitionend", onEnd);
        track.style.transition = `transform ${spinDurationMs}ms ${SPIN_EASING}`;
        track.style.transform = `translateX(${endX}px)`;

        fallback = window.setTimeout(() => {
          track.removeEventListener("transitionend", onEnd);
          finish();
        }, spinDurationMs + 800);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      track.removeEventListener("transitionend", onEnd);
      if (fallback) window.clearTimeout(fallback);
    };
  }, [layoutReady, landIndex, cycleLen, spinDurationMs, strip.length, targetSlot]);

  return (
    <div className="cb-jackpot-reel" aria-live="polite">
      <div className="cb-jackpot-reel__head">
        <p className="cb-jackpot-reel__title">Jackpot roll</p>
        <p className="cb-jackpot-reel__sub">The pointer marks the jackpot winner</p>
        {jackpotEosBlockId && (
          <p className="cb-jackpot-reel__eos">
            EOS <code>{jackpotEosBlockId.slice(0, 14)}…</code>
          </p>
        )}
      </div>

      <div className="cb-jackpot-reel__frame">
        <div className="cb-jackpot-reel__window">
          <div className="cb-jackpot-reel__pointer" aria-hidden>
            <span className="cb-jackpot-reel__pointer-cap" />
          </div>
          <div ref={viewportRef} className="cb-jackpot-reel__viewport">
            <div ref={trackRef} className="cb-jackpot-reel__track">
              {strip.map((entry, i) => (
                <PlayerTile
                  key={`${entry.player.slot}-${i}`}
                  player={entry.player}
                  pct={entry.pct}
                  highlight={highlightIndex === i}
                  color={slotColor(entry.player.slot)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {winnerPlayer && highlightIndex != null && (
        <p className="cb-jackpot-reel__winner">
          Jackpot winner: <strong>{winnerPlayer.displayName}</strong>
        </p>
      )}
    </div>
  );
}
