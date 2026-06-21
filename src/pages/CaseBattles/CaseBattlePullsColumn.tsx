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

export function CaseBattlePullsColumn({
  player,
  slot,
  isYou,
  isWinner,
  revealedRounds,
}: CaseBattlePullsColumnProps) {
  if (!player) {
    return (
      <div className="cbr__pulls-col cbr__pulls-col--empty">
        <span className="cbr__pulls-col-name">—</span>
      </div>
    );
  }

  const revealed = player.drops.slice(0, revealedRounds);

  return (
    <div
      className={
        "cbr__pulls-col" +
        (isYou ? " cbr__pulls-col--you" : "") +
        (isWinner ? " cbr__pulls-col--winner" : "")
      }
    >
      <div className="cbr__pulls-col-head">
        <span className="cbr__pulls-col-avatar" aria-hidden>
          {player.isBot ? "🤖" : "👤"}
        </span>
        <span className="cbr__pulls-col-name">
          {player.displayName}
          {isYou ? " (you)" : ""}
        </span>
      </div>
      <div className="cbr__pulls-col-items">
        {revealed.length === 0 ? (
          <p className="cbr__pulls-col-empty">No pulls yet</p>
        ) : (
          revealed.map((drop, i) => (
            <PulledItemCard key={`${slot}-${i}`} drop={drop} round={drop.round} />
          ))
        )}
      </div>
    </div>
  );
}