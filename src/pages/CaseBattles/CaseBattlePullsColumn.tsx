import { RARITY_COLORS, type CaseRarity } from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import type { CaseBattleDrop, CaseBattlePlayer } from "../../lib/caseBattles";

export function PulledItemCard({ drop, round }: { drop: CaseBattleDrop; round?: number }) {
  const color = RARITY_COLORS[drop.rarity as CaseRarity] ?? "#7a7a98";
  return (
    <div className="cbr__pull-item" style={{ borderColor: `${color}44` }}>
      {round != null && <span className="cbr__pull-item-round">R{round + 1}</span>}
      <span className="cbr__pull-item-name">{drop.name}</span>
      <span className="cbr__pull-item-val" style={{ color }}>
        {formatCoins(drop.value, "balance")}
      </span>
    </div>
  );
}

type CaseBattlePullsColumnProps = {
  player: CaseBattlePlayer | undefined;
  slot: number;
  isYou: boolean;
  isWinner: boolean;
  revealedRounds: number;
};

/**
 * Renders ONE player's pull history as a horizontal strip:
 *   [ avatar | name + tags ]  [ item · item · item · ... ]
 *
 * Multiple strips stack vertically inside `.cbr__pulls-list`. This mirrors
 * cases.gg's "drop history" layout — each player gets a single horizontal
 * row of their drops rather than a tall vertical stack that's hard to scan.
 */
export function CaseBattlePullsColumn({
  player,
  slot,
  isYou,
  isWinner,
  revealedRounds,
}: CaseBattlePullsColumnProps) {
  if (!player) {
    // Empty slot — render nothing so the strip list stays compact.
    return null;
  }

  const revealed = player.drops.slice(0, revealedRounds);
  const total = revealed.reduce((sum, d) => sum + d.value, 0);

  return (
    <div
      className={
        "cbr__pulls-strip" +
        (isYou ? " cbr__pulls-strip--you" : "") +
        (isWinner ? " cbr__pulls-strip--winner" : "")
      }
    >
      <div className="cbr__pulls-strip-head">
        <span className="cbr__pulls-strip-avatar" aria-hidden>
          {player.isBot ? "🤖" : "👤"}
        </span>
        <div className="cbr__pulls-strip-meta">
          <span className="cbr__pulls-strip-name">{player.displayName}</span>
          <div className="cbr__pulls-strip-tags">
            {player.isBot && <span className="cbr__pulls-strip-tag">Bot</span>}
            {isYou && <span className="cbr__pulls-strip-tag cbr__pulls-strip-tag--you">You</span>}
            {isWinner && (
              <span className="cbr__pulls-strip-tag cbr__pulls-strip-tag--winner">Winner</span>
            )}
          </div>
        </div>
        <span className="cbr__pulls-strip-total" aria-label="Total pulled">
          {formatCoins(total, "balance")}
        </span>
      </div>

      <div className="cbr__pulls-strip-items">
        {revealed.length === 0 ? (
          <p className="cbr__pulls-strip-empty">No pulls yet</p>
        ) : (
          revealed.map((drop, i) => (
            <PulledItemCard key={`${slot}-${i}`} drop={drop} round={drop.round} />
          ))
        )}
      </div>
    </div>
  );
}
