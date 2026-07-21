/**
 * Case Battles v2 — PlayerColumn
 * One player's column in the arena.
 *
 * Two visual modes:
 * - Live (isCompleted=false): avatar + name, scrollable past-items history,
 *   active reel, running total at the bottom.
 * - Ledger (isCompleted=true): avatar + name, full grid of items won across
 *   every round, total at the bottom. Reels are not rendered — completed
 *   battles are static summaries.
 *
 * Pass-through props (set by the arena):
 *  - `spinSpeedPx` — randomized per-slot velocity so each reel spins at
 *    its own natural rate.
 *  - `syncedLandingStartTime` — a timestamp shared across every reel in
 *    the same round; BattleReel uses this as its landing start so every
 *    contestant's reveal happens in lockstep.
 *
 * Past rounds are passed in via `visibleDrops` (parent pre-filters to
 * `d.round < currentRound`). The current round's drops stay separate so
 * the reel only ever sees its own target — never a future-round item.
 */

import { useMemo } from "react";
import type { CaseBattleView, BattlePlayer, BattleDrop } from "./types";
import { getCaseById } from "../../lib/games/case-battles";
import { BattleReel } from "./BattleReel";
import { playerTotalValue } from "./caseBattlesApi";
import { formatCoins } from "../../lib/format";

type PlayerColumnProps = {
  battle: CaseBattleView;
  player: BattlePlayer;
  currentRound: number;
  roundDrops: BattleDrop[];
  visibleDrops: BattleDrop[];
  isCompleted: boolean;
  isWinner?: boolean;
  isCurrentUser?: boolean;
  spinSpeedPx?: number;
  syncedLandingStartTime?: number | null;
  onReelLanded?: (slot: number) => void;
};

export function PlayerColumn({
  battle,
  player,
  currentRound,
  roundDrops,
  visibleDrops,
  isCompleted,
  isWinner = false,
  isCurrentUser = false,
  spinSpeedPx,
  syncedLandingStartTime = null,
  onReelLanded,
}: PlayerColumnProps) {
  const lootCase = useMemo(() => {
    const caseId = battle.caseIds[currentRound];
    return caseId ? getCaseById(caseId) : null;
  }, [battle.caseIds, currentRound]);

  const targetDrop = roundDrops.find((d) => d.slot === player.slot);
  const targetItem = useMemo(() => {
    if (!targetDrop || !lootCase) return null;
    return lootCase.items.find((i) => i.id === targetDrop.itemId) ?? null;
  }, [targetDrop, lootCase]);

  const pastDrops = useMemo(
    () => visibleDrops.filter((d) => d.round < currentRound && d.slot === player.slot),
    [visibleDrops, currentRound, player.slot],
  );

  const ledgerDrops = useMemo(
    () => (isCompleted ? visibleDrops.filter((d) => d.slot === player.slot) : []),
    [isCompleted, visibleDrops, player.slot],
  );

  const totalValue = playerTotalValue(visibleDrops, player.slot);

  const spinKey = `${battle.battleId}-${player.slot}-${currentRound}`;
  const showReel = !isCompleted && Boolean(lootCase) && Boolean(onReelLanded);

  return (
    <div
      className={
        "cb-col" +
        (isCurrentUser ? " cb-col--me" : "") +
        (isWinner ? " cb-col--winner" : "") +
        (isCompleted ? " cb-col--ledger" : "")
      }
    >
      <div className="cb-col__header">
        <div
          className="cb-col__avatar"
          style={{
            background: player.avatarSeed
              ? `linear-gradient(135deg, hsl(${hashHue(player.avatarSeed)}, 70%, 50%), hsl(${hashHue(player.avatarSeed) + 60}, 70%, 40%))`
              : "var(--lc-crimson-dim)",
          }}
          aria-hidden
        >
          {player.username.charAt(0).toUpperCase()}
        </div>
        <div className="cb-col__name">
          <span className="cb-col__username">{player.username}</span>
          {player.isBot && <span className="cb-col__bot-badge">BOT</span>}
        </div>
      </div>

      {!isCompleted && pastDrops.length > 0 && (
        <div className="cb-col__history" aria-label="Past rounds">
          {pastDrops.map((d) => {
            const c = getCaseById(d.caseId);
            const item = c?.items.find((i) => i.id === d.itemId);
            const rarityColor = item?.rarity ? RARITY_HEX[item.rarity] ?? "#7a7a98" : "#7a7a98";
            return (
              <div
                key={`${d.round}-${d.itemId}`}
                className="cb-col__history-tile"
                style={{ borderLeftColor: rarityColor }}
                title={`${item?.name ?? d.itemName} — ${formatCoins(d.itemValue, battle.coinType)}`}
              >
                <span className="cb-col__history-round">R{d.round + 1}</span>
                <span className="cb-col__history-value" style={{ color: rarityColor }}>
                  {formatCoins(d.itemValue, battle.coinType)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {showReel ? (
        <div className="cb-col__reel">
          <BattleReel
            lootCase={lootCase!}
            targetItem={targetItem}
            spinKey={spinKey}
            accent={lootCase?.accent ?? "#e8254c"}
            spinSpeedPx={spinSpeedPx}
            syncedLandingStartTime={syncedLandingStartTime}
            onLanded={() => onReelLanded!(player.slot)}
          />
        </div>
      ) : (
        <div className="cb-col__ledger" aria-label={isCompleted ? "All items won" : "No case"}>
          {ledgerDrops.length === 0 ? (
            <p className="cb-col__ledger-empty">
              {isCompleted ? "No items won" : "—"}
            </p>
          ) : (
            ledgerDrops.map((d) => {
              const c = getCaseById(d.caseId);
              const item = c?.items.find((i) => i.id === d.itemId);
              const rarityColor = item?.rarity ? RARITY_HEX[item.rarity] ?? "#7a7a98" : "#7a7a98";
              return (
                <div
                  key={`ledger-${d.round}-${d.itemId}`}
                  className="cb-col__ledger-tile"
                  style={{ borderColor: rarityColor }}
                  title={item?.name ?? d.itemName}
                >
                  <span className="cb-col__ledger-round">R{d.round + 1}</span>
                  <span className="cb-col__ledger-name">{item?.name ?? d.itemName}</span>
                  <span className="cb-col__ledger-value" style={{ color: rarityColor }}>
                    {formatCoins(d.itemValue, battle.coinType)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="cb-col__total">
        <span className="cb-col__total-label">Total</span>
        <span
          className={
            "cb-col__total-value" +
            (totalValue > 0 ? " cb-col__total-value--active" : "")
          }
        >
          {formatCoins(totalValue, battle.coinType)}
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

const RARITY_HEX: Record<string, string> = {
  common: "#7a7a98",
  uncommon: "#22c55e",
  rare: "#38bdf8",
  epic: "#a855f7",
  legendary: "#f59e0b",
};
