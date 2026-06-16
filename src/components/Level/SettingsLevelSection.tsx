import { useMemo } from "react";
import { LevelBadge } from "./LevelBadge";
import { LevelDetailPanel } from "./LevelDetailPanel";
import { getLevelProgress, MAX_LEVEL, MAX_WAGER_FOR_MAX_LEVEL } from "../../lib/leveling";
import { formatUsd } from "../../lib/format";
import "./Level.css";

type Props = {
  totalWagered: number;
  loading?: boolean;
};

export function SettingsLevelSection({ totalWagered, loading }: Props) {
  const progress = useMemo(() => getLevelProgress(totalWagered), [totalWagered]);

  return (
    <div className="settings-level">
      <p className="settings-level__desc">
        Levels are based on lifetime wager volume. Reach level {MAX_LEVEL} at{" "}
        {formatUsd(MAX_WAGER_FOR_MAX_LEVEL)} total wagered — late levels take much more play.
      </p>

      <div className="settings-level__summary">
        <LevelBadge level={loading ? "…" : progress.level} size="lg" />
        <div className="settings-level__summary-text">
          <p className="settings-level__title">
            {loading ? "Loading…" : progress.isMaxLevel ? "Max level reached" : `Level ${progress.level}`}
          </p>
          <p className="settings-level__sub">
            {loading
              ? "…"
              : progress.isMaxLevel
                ? `${formatUsd(progress.totalWagered)} wagered`
                : `${Math.round(progress.progressPercent)}% to level ${progress.nextLevel}`}
          </p>
        </div>
      </div>

      <div className="settings-level__bar-wrap" aria-hidden={loading}>
        <div className="settings-level__bar">
          <span
            className="level-progress__fill"
            style={{ width: loading ? "0%" : `${progress.progressPercent}%` }}
          />
        </div>
      </div>

      {!loading && <LevelDetailPanel totalWagered={totalWagered} variant="inline" />}
    </div>
  );
}
