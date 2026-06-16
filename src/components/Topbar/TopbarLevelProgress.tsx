import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LevelBadge } from "../Level/LevelBadge";
import { LevelDetailPanel } from "../Level/LevelDetailPanel";
import { useLevelDetailOpen } from "../Level/useLevelDetailOpen";
import { getLevelProgress } from "../../lib/leveling";
import "../Level/Level.css";
import "./TopbarLevelProgress.css";

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

        {open && !loading && (
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
        {open && !loading && (
          <div className="topbar-level__detail-anchor topbar-level__detail-anchor--compact">
            <LevelDetailPanel totalWagered={totalWagered} variant="popover" />
          </div>
        )}
      </div>
    </div>
  );
}
