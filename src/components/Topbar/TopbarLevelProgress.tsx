import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LevelBadge } from "../Level/LevelBadge";
import { LevelDetailPanel } from "../Level/LevelDetailPanel";
import { useLevelDetailOpen } from "../Level/useLevelDetailOpen";
import { getLevelProgress } from "../../lib/leveling";
import "../Level/Level.css";
import "./TopbarLevelProgress.css";

/** Mobile breakpoint — must match the `@media (max-width: 900px)` rules in
 *  `Topbar.css:374` and `lc-pages.css:509` that hide the full/compact
 *  variants respectively. Used to conditionally render only ONE
 *  `LevelDetailPanel` instance so screen readers don't announce the level
 *  details twice (H6 — UI/UX audit). */
const MOBILE_MEDIA = "(max-width: 900px)";

/** Subscribe to a media query and return whether it currently matches.
 *  SSR-safe (defaults to false on the server). */
function useMediaMatches(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

type Props = {
  displayName: string;
  profileTitle?: string;
  totalWagered: number;
  loading?: boolean;
};

export function TopbarLevelProgress({
  displayName,
  profileTitle,
  totalWagered,
  loading,
}: Props) {
  const { open, toggle, wrapRef } = useLevelDetailOpen();
  const progress = useMemo(() => getLevelProgress(totalWagered), [totalWagered]);
  const level = loading ? "…" : progress.level;
  // H6: render only ONE LevelDetailPanel based on viewport. Both panels are
  // `role="status"` live regions — mounting both caused double SR
  // announcements, double lifecycle and duplicate focusable descendants.
  const isMobile = useMediaMatches(MOBILE_MEDIA);

  const detailLabel = loading
    ? "Loading level"
    : progress.isMaxLevel
      ? `Level ${progress.level}, max level`
      : `Level ${progress.level}, ${Math.round(progress.progressPercent)}% to level ${progress.nextLevel}`;

  return (
    <div className="topbar-level-wrap" ref={wrapRef}>
      <div className="topbar-level topbar-level--full">
        <div className="topbar-level__header">
          <button
            type="button"
            className="topbar-level__level-btn"
            disabled={loading}
            onClick={loading ? undefined : toggle}
            aria-expanded={open}
            aria-label={detailLabel}
            title="Click for level details"
          >
            <span className="topbar-level__level-label">Level</span>
            <LevelBadge level={level} size="sm" />
          </button>

          <span className="topbar-level__sep" aria-hidden="true">
            |
          </span>

          <Link to="/settings" className="topbar-level__name" title={profileTitle}>
            {displayName}
          </Link>
        </div>

        <button
          type="button"
          className="level-progress__track topbar-level__track"
          disabled={loading}
          onClick={loading ? undefined : toggle}
          aria-expanded={open}
          aria-label={detailLabel}
          title="Click for level details"
        >
          <span
            className="level-progress__fill"
            style={{ width: loading ? "0%" : `${progress.progressPercent}%` }}
          />
        </button>

        {/* H6: only render the full-panel detail on desktop. On mobile the
            compact variant below is used instead — keeping just one live
            region mounted at a time. */}
        {open && !loading && !isMobile && (
          <div className="topbar-level__detail-anchor">
            <LevelDetailPanel totalWagered={totalWagered} variant="popover" />
          </div>
        )}
      </div>

      <div className="topbar-level topbar-level--compact">
        <button
          type="button"
          className="topbar-level__compact-btn"
          disabled={loading}
          onClick={loading ? undefined : toggle}
          aria-expanded={open}
          aria-label={detailLabel}
          title={displayName}
        >
          <LevelBadge level={level} size="sm" />
        </button>
        {open && !loading && isMobile && (
          <div className="topbar-level__detail-anchor topbar-level__detail-anchor--compact">
            <LevelDetailPanel totalWagered={totalWagered} variant="popover" />
          </div>
        )}
      </div>
    </div>
  );
}
