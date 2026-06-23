import {
  getCaseById,
  RARITY_COLORS,
  type CaseItem,
  type CaseRarity,
  type LootCase,
} from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import type { CaseBattleDrop, CaseBattlePlayer, CaseBattleView } from "../../lib/caseBattles";
import { Bot, User } from "lucide-react";
import { CaseOpenReel } from "./CaseOpenReel";

function dropToItem(drop: CaseBattleDrop, lootCase: LootCase): CaseItem {
  return (
    lootCase.items.find((i) => i.id === drop.itemId) ?? {
      id: drop.itemId,
      name: drop.name,
      value: drop.value,
      rarity: drop.rarity as CaseRarity,
      weight: 1,
    }
  );
}

function playerRunningTotal(
  player: CaseBattlePlayer,
  revealedCount: number,
  totalRounds: number
): { displayTotal: number; terminalScore: number } {
  const revealedDrops = player.drops.slice(0, revealedCount);
  const runningTotal = revealedDrops.reduce((sum, d) => sum + d.value, 0);
  const allRevealed = revealedCount >= totalRounds && totalRounds > 0;
  const displayTotal = allRevealed ? player.totalValue : runningTotal;
  const lastRevealed = revealedDrops[revealedDrops.length - 1];
  const terminalScore = lastRevealed?.value ?? 0;
  return { displayTotal, terminalScore };
}

export type PlayerColumnPhase = "lobby" | "playing" | "results";

export type CaseBattlePlayerColumnProps = {
  slot: number;
  player: CaseBattlePlayer | undefined;
  battle: CaseBattleView;
  isCreator: boolean;
  isPendingBot: boolean;
  phase: PlayerColumnPhase;
  gamemode: string;
  isYou: boolean;
  isWinner: boolean;
  isLeading: boolean;
  activeRound: number;
  revealedRounds: number;
  spinDurationMs: number;
  reelsPhase: boolean;
  reelItemHeight: number;
  onAddBot?: (slot: number) => void;
  onReelComplete?: () => void;
};

export function CaseBattlePlayerColumn({
  slot,
  player,
  battle,
  isCreator,
  isPendingBot,
  phase,
  gamemode,
  isYou,
  isWinner,
  isLeading,
  activeRound,
  revealedRounds,
  spinDurationMs,
  reelsPhase,
  reelItemHeight,
  onAddBot,
  onReelComplete,
}: CaseBattlePlayerColumnProps) {
  const filled = player != null;
  const showRunningTotal = phase === "playing";
  const totals =
    filled && player
      ? playerRunningTotal(player, revealedRounds, battle.rounds)
      : { displayTotal: 0, terminalScore: 0 };

  const roundCaseId = battle.caseIds[activeRound];
  const lootCase = roundCaseId ? getCaseById(roundCaseId) : undefined;
  const currentDrop = filled && player ? player.drops[activeRound] : undefined;
  const targetItem =
    lootCase && currentDrop && player ? dropToItem(currentDrop, lootCase) : null;
  const isSpinning = phase === "playing" && reelsPhase && filled && targetItem != null;

  const headerLabel = filled ? player!.displayName : "Call bot";

  return (
    <div
      className={
        "cbr__p-col" +
        (filled ? " cbr__p-col--filled" : " cbr__p-col--empty") +
        (isYou ? " cbr__p-col--you" : "") +
        (isWinner ? " cbr__p-col--winner" : "") +
        (isLeading && !isWinner ? " cbr__p-col--leading" : "")
      }
      data-phase={phase}
    >
      <header className="cbr__p-col-head">
        <span
          className={
            "cbr__p-col-avatar" +
            (filled ? (player!.isBot ? " cbr__p-col-avatar--bot" : "") : " cbr__p-col-avatar--ghost")
          }
          aria-hidden
        >
          {filled ? (player!.isBot ? <Bot size={14} /> : <User size={14} />) : "·"}
        </span>
        <span className="cbr__p-col-name">{headerLabel}</span>
        {filled && player!.isBot && (
          <span className="cbr__p-col-tag cbr__p-col-tag--bot">Bot</span>
        )}
        {isYou && <span className="cbr__p-col-tag cbr__p-col-tag--you">You</span>}
      </header>

      <div className="cbr__p-col-body">
        {phase === "lobby" && !filled && isCreator && onAddBot && (
          <button
            type="button"
            className="cbr__p-col-call-bot"
            disabled={isPendingBot}
            onClick={() => onAddBot(slot)}
          >
            {isPendingBot ? "…" : "Call bot"}
          </button>
        )}

        {phase === "lobby" && !filled && !isCreator && (
          <p className="cbr__p-col-wait">Waiting for player…</p>
        )}

        {phase === "lobby" && filled && (
          <div className="cbr__p-col-lobby-fill" aria-hidden />
        )}

        {phase === "playing" && filled && (
          <div className="cbr__p-col-reel">
            {isSpinning && lootCase && targetItem && onReelComplete ? (
              <CaseOpenReel
                lootCase={lootCase}
                targetItem={targetItem}
                accent={lootCase.accent}
                spinKey={`${slot}-${activeRound}`}
                slot={slot}
                round={activeRound}
                baseDurationMs={spinDurationMs}
                itemHeight={reelItemHeight}
                active={reelsPhase}
                onComplete={onReelComplete}
              />
            ) : (() => {
              // Show the last revealed drop while waiting for the next round,
              // or all rounds done — gives players context between spins.
              const lastDrop = player && revealedRounds > 0
                ? player.drops[revealedRounds - 1]
                : undefined;
              const lastColor = lastDrop
                ? (RARITY_COLORS[lastDrop.rarity as CaseRarity] ?? "#7a7a98")
                : undefined;
              return (
                <div className="cbr__p-col-reel-wait cbr__p-col-reel-idle">
                  {lastDrop ? (
                    <div className="cbr__p-col-last-drop" style={{ borderColor: `${lastColor}55` }}>
                      <span className="cbr__p-col-last-drop-gem" style={{ color: lastColor }} aria-hidden>◆</span>
                      <span className="cbr__p-col-last-drop-name">{lastDrop.name}</span>
                      <span className="cbr__p-col-last-drop-val" style={{ color: lastColor }}>
                        {formatCoins(lastDrop.value, "balance")}
                      </span>
                      {revealedRounds >= battle.rounds && (
                        <span className="cbr__p-col-last-drop-done">Final</span>
                      )}
                    </div>
                  ) : (
                    <span className="cbr__p-col-reel-idle-label">—</span>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {showRunningTotal && filled && (
        <footer className="cbr__p-col-foot">
          <span className="cbr__p-col-foot-label">Total pulled</span>
          <span className="cbr__p-col-foot-val">
            {gamemode === "terminal" ? formatCoins(totals.terminalScore, "balance") : formatCoins(totals.displayTotal, "balance")}
          </span>
        </footer>
      )}
    </div>
  );
}