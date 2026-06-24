/**
 * Case Battles v2 — PlayerColumn
 * One player's column in the arena: avatar, name, reel, running total.
 */

import { useMemo } from "react";
import type { CaseBattleView, BattlePlayer, BattleDrop } from "./types";
import type { LootCase } from "../../lib/games/case-battles";
import { getCaseById } from "../../lib/games/case-battles";
import { BattleReel } from "./BattleReel";
import { formatCoins } from "../../lib/format";
import { playerTotalValue } from "./caseBattlesApi";

type PlayerColumnProps = {
  battle: CaseBattleView;
  player: BattlePlayer;
  currentRound: number;
  roundDrops: BattleDrop[]; // drops for the current round
  allDrops: BattleDrop[]; // all drops (for running total)
  isWinner: boolean;
  isCurrentUser: boolean;
  onReelLanded: (slot: number) => void;
};

export function PlayerColumn({
  battle,
  player,
  currentRound,
  roundDrops,
  allDrops,
  isWinner,
  isCurrentUser,
  onReelLanded,
}: PlayerColumnProps) {
  const lootCase = useMemo(() => {
    const caseId = battle.caseIds[currentRound];
    return caseId ? getCaseById(caseId) : null;
  }, [battle.caseIds, currentRound]);

  // The target item for this player's reel in the current round
  const targetDrop = roundDrops.find((d) => d.slot === player.slot);
  const targetItem = useMemo(() => {
    if (!targetDrop || !lootCase) return null;
    return lootCase.items.find((i) => i.id === targetDrop.itemId) ?? null;
  }, [targetDrop, lootCase]);

  const totalValue = playerTotalValue(allDrops, player.slot);

  // The spinKey changes when a new round starts — this triggers the reel
  // to reset and start a new spin.
  const spinKey = `${battle.battleId}-${player.slot}-${currentRound}`;

  return (
    <div
      className={
        "cb-col" +
        (isCurrentUser ? " cb-col--me" : "") +
        (isWinner ? " cb-col--winner" : "")
      }
    >
      {/* Header: avatar + name */}
      <div className="cb-col__header">
        <div
          className="cb-col__avatar"
          style={{
            background: player.avatarSeed
              ? `linear-gradient(135deg, hsl(${hashHue(player.avatarSeed)}, 70%, 50%), hsl(${hashHue(player.avatarSeed) + 60}, 70%, 40%))`
              : "var(--lc-crimson-dim)",
          }}
        >
          {player.username.charAt(0).toUpperCase()}
        </div>
        <div className="cb-col__name">
          <span className="cb-col__username">{player.username}</span>
          {player.isBot && <span className="cb-col__bot-badge">BOT</span>}
        </div>
      </div>

      {/* Reel */}
      <div className="cb-col__reel">
        {lootCase && (
          <BattleReel
            lootCase={lootCase}
            targetItem={targetItem}
            spinKey={spinKey}
            accent={lootCase.accent ?? "#e8254c"}
            onLanded={() => onReelLanded(player.slot)}
          />
        )}
      </div>

      {/* Running total */}
      <div className="cb-col__total">
        <span className="cb-col__total-label">Total</span>
        <span
          className={
            "cb-col__total-value" +
            (totalValue > 0 ? " cb-col__total-value--active" : "")
          }
        >
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}

function hashHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}
