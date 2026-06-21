import { formatUsd } from "../../lib/format";
import {
  formatLevelAmount,
  getLevelDetailInfo,
  MAX_LEVEL,
  MAX_WAGER_FOR_MAX_LEVEL,
} from "../../lib/leveling";

type Props = {
  totalWagered: number;
  variant?: "popover" | "inline";
};

export function LevelDetailPanel({ totalWagered, variant = "popover" }: Props) {
  const { progress, currentLevelFloor, nextLevelThreshold, remainingToNextLevel } =
    getLevelDetailInfo(totalWagered);

  const className =
    variant === "inline" ? "level-detail level-detail--inline" : "level-detail level-detail--popover";

  // The popover variant only mounts after the user explicitly toggles the
  // level button, so `role="status"` is appropriate — it queues a polite
  // announcement of the level info that just appeared. The inline variant
  // (SettingsLevelSection) is always present on the Settings page; giving it
  // `role="status"` would force a redundant announcement on every Settings
  // mount, so we omit the role there and let the surrounding heading convey
  // context.
  const role = variant === "popover" ? "status" : undefined;

  return (
    <div className={className} role={role}>
      <p className="level-detail__headline">
        {progress.isMaxLevel
          ? `Level ${progress.level} — max level`
          : `Level ${progress.level} → ${progress.nextLevel}`}
      </p>

      {!progress.isMaxLevel && (
        <p className="level-detail__progress">
          <strong>
            {formatLevelAmount(progress.wagerInCurrentLevel)} /{" "}
            {formatLevelAmount(progress.wagerNeededForNextLevel)}
          </strong>{" "}
          SC wagered this level
        </p>
      )}

      <dl className="level-detail__stats">
        <div className="level-detail__row">
          <dt>Total SC wagered</dt>
          <dd>{formatUsd(progress.totalWagered)}</dd>
        </div>
        <div className="level-detail__row">
          <dt>Current level starts at</dt>
          <dd>{formatUsd(currentLevelFloor)}</dd>
        </div>
        {!progress.isMaxLevel && (
          <>
            <div className="level-detail__row">
              <dt>Next level ({progress.nextLevel}) at</dt>
              <dd>{formatUsd(nextLevelThreshold)}</dd>
            </div>
            <div className="level-detail__row">
              <dt>Remaining to level up</dt>
              <dd>{formatUsd(remainingToNextLevel)}</dd>
            </div>
          </>
        )}
        <div className="level-detail__row">
          <dt>Max level ({MAX_LEVEL})</dt>
          <dd>{formatUsd(MAX_WAGER_FOR_MAX_LEVEL)} wagered</dd>
        </div>
      </dl>
    </div>
  );
}
