import { getCaseById } from "../../lib/games/case-battles";

export const VISIBLE_ROUNDS = 5;

export function roundWindowStart(focusIndex: number, total: number): number {
  if (total <= VISIBLE_ROUNDS) return 0;
  const clamped = Math.max(0, Math.min(focusIndex, total - 1));
  return Math.min(clamped, total - VISIBLE_ROUNDS);
}

type CaseBattleRoundsStripProps = {
  caseIds: string[];
  focusIndex?: number;
  isPlaying?: boolean;
  showComplete?: boolean;
  variant?: "arena" | "create";
};

export function CaseBattleRoundsStrip({
  caseIds,
  focusIndex = 0,
  isPlaying = false,
  showComplete = false,
  variant = "arena",
}: CaseBattleRoundsStripProps) {
  const prefix = variant === "create" ? "cbc" : "cbr";
  const total = caseIds.length;
  if (total === 0) return null;

  const effectiveFocus = showComplete ? Math.max(0, total - 1) : focusIndex;
  const windowStart = roundWindowStart(effectiveFocus, total);
  const visible = caseIds.slice(windowStart, windowStart + VISIBLE_ROUNDS);
  const chipClass = `${prefix}__round-chip`;
  const showMeta = total > VISIBLE_ROUNDS && variant === "arena";

  return (
    <div
      className={`${prefix}__rounds-bar ${prefix}__rounds-bar--strip`}
      aria-label="Case order"
    >
      <div key={windowStart} className={`${prefix}__rounds-window`}>
        {visible.map((id, offset) => {
          const i = windowStart + offset;
          const c = getCaseById(id);
          const isCurrent =
            variant === "arena" && isPlaying && !showComplete && i === focusIndex;
          const isDone = variant === "arena" && isPlaying && !showComplete && i < focusIndex;
          const Tag = variant === "create" ? "div" : "span";

          return (
            <Tag
              key={`${id}-${i}`}
              className={
                chipClass +
                (isCurrent ? ` ${chipClass}--active` : "") +
                (isDone ? ` ${chipClass}--done` : "")
              }
              title={c?.name ?? id}
              style={{ borderColor: c?.accent }}
            >
              R{i + 1}
              {variant === "create" && <span>📦</span>}
            </Tag>
          );
        })}
      </div>
      {showMeta && (
        <p className="cbr__rounds-strip-meta" aria-live="polite">
          {isPlaying && !showComplete
            ? `Round ${effectiveFocus + 1} of ${total}`
            : `Rounds ${windowStart + 1}–${windowStart + visible.length} of ${total}`}
        </p>
      )}
    </div>
  );
}
