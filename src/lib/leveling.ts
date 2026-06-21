/** Wager-based player level (0–100). Level 100 ≈ $500k total SC wagered. GC wagers do not count. */
export const MAX_LEVEL = 100;
export const MAX_WAGER_FOR_MAX_LEVEL = 500_000;

/** Higher = slower early grind, steeper late-game curve */
const LEVEL_CURVE_EXPONENT = 2.4;

export type LevelProgress = {
  level: number;
  totalWagered: number;
  progressPercent: number;
  wagerInCurrentLevel: number;
  wagerNeededForNextLevel: number;
  nextLevel: number;
  isMaxLevel: boolean;
};

/** Cumulative USD wager required to reach this level */
export function wagerRequiredForLevel(level: number): number {
  if (level <= 0) return 0;
  if (level >= MAX_LEVEL) return MAX_WAGER_FOR_MAX_LEVEL;
  return MAX_WAGER_FOR_MAX_LEVEL * Math.pow(level / MAX_LEVEL, LEVEL_CURVE_EXPONENT);
}

export function levelFromWagered(totalWagered: number): number {
  const w = Math.max(0, totalWagered);
  if (w >= MAX_WAGER_FOR_MAX_LEVEL) return MAX_LEVEL;

  let low = 0;
  let high = MAX_LEVEL;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (w >= wagerRequiredForLevel(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function getLevelProgress(totalWagered: number): LevelProgress {
  const w = Math.max(0, totalWagered);
  const level = levelFromWagered(w);
  const floor = wagerRequiredForLevel(level);

  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      totalWagered: w,
      progressPercent: 100,
      wagerInCurrentLevel: w - floor,
      wagerNeededForNextLevel: 0,
      nextLevel: MAX_LEVEL,
      isMaxLevel: true,
    };
  }

  const nextLevel = level + 1;
  const ceiling = wagerRequiredForLevel(nextLevel);
  const span = ceiling - floor;
  const wagerInCurrentLevel = w - floor;
  const progressPercent = span > 0 ? Math.min(100, (wagerInCurrentLevel / span) * 100) : 0;

  return {
    level,
    totalWagered: w,
    progressPercent,
    wagerInCurrentLevel,
    wagerNeededForNextLevel: span,
    nextLevel,
    isMaxLevel: false,
  };
}

/** Progress fraction for bar detail, e.g. 500.00/1000.00 */
export function formatLevelAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export type LevelDetailInfo = {
  progress: LevelProgress;
  currentLevelFloor: number;
  nextLevelThreshold: number;
  remainingToNextLevel: number;
};

export function getLevelDetailInfo(totalWagered: number): LevelDetailInfo {
  const progress = getLevelProgress(totalWagered);
  const currentLevelFloor = wagerRequiredForLevel(progress.level);
  const nextLevelThreshold = progress.isMaxLevel
    ? MAX_WAGER_FOR_MAX_LEVEL
    : wagerRequiredForLevel(progress.nextLevel);
  const remainingToNextLevel = progress.isMaxLevel
    ? 0
    : Math.max(0, nextLevelThreshold - progress.totalWagered);

  return {
    progress,
    currentLevelFloor,
    nextLevelThreshold,
    remainingToNextLevel,
  };
}
