/**
 * Case Battles v2 — Arena
 * The main battle view: player columns + round indicator + results.
 *
 * State machine:
 * - waiting: show join panel / start button
 * - committing: show EOS block wait
 * - running: spin reels round-by-round
 * - completed: show results + claim button
 *
 * The round-by-round animation is driven by `currentRound` state. When all
 * reels for a round have landed, advance to the next round after a delay.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { CaseBattleView } from "./types";
import { dropsForRound, calculatePayoutForSlot } from "./caseBattlesApi";
import { PlayerColumn } from "./PlayerColumn";
import { formatCoins } from "../../lib/format";
import "./CaseBattlesV2.css";

type ArenaProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  onReelLanded?: () => void;
};

export function CaseBattleArenaV2({ battle, userId }: ArenaProps) {
  const [currentRound, setCurrentRound] = useState(0);
  const [landedSlots, setLandedSlots] = useState<Set<number>>(new Set());
  const advanceTimerRef = useRef<number>(0);

  // Reset round state when the battle status changes or a new round starts
  useEffect(() => {
    if (battle.status === "running" || battle.status === "completed") {
      setCurrentRound(0);
      setLandedSlots(new Set());
    }
  }, [battle.status]);

  // Auto-advance rounds: when all active players' reels have landed for the
  // current round, wait 1.5s then advance to the next round.
  const activePlayerCount = battle.players.length;
  const allLanded = landedSlots.size >= activePlayerCount && activePlayerCount > 0;

  useEffect(() => {
    if (!allLanded) return;
    if (currentRound >= battle.rounds - 1) return; // last round — don't advance

    advanceTimerRef.current = window.setTimeout(() => {
      setCurrentRound((r) => r + 1);
      setLandedSlots(new Set());
    }, 2000);

    return () => window.clearTimeout(advanceTimerRef.current);
  }, [allLanded, currentRound, battle.rounds]);

  const handleReelLanded = useCallback((slot: number) => {
    setLandedSlots((prev) => new Set(prev).add(slot));
  }, []);

  // ─── Waiting state ──────────────────────────────────────────────────────
  if (battle.status === "waiting") {
    return (
      <div className="cb-arena cb-arena--waiting">
        <div className="cb-arena__waiting-info">
          <p className="cb-arena__pot">
            Pot: <strong>{formatCoins(battle.potTotal, "balance")}</strong>
          </p>
          <p className="cb-arena__players">
            {battle.players.length} / {battle.maxPlayers} players joined
          </p>
        </div>
        <div className="cb-arena__slots">
          {Array.from({ length: battle.maxPlayers }, (_, slot) => {
            const player = battle.players.find((p) => p.slot === slot);
            return (
              <div key={slot} className={"cb-slot" + (player ? " cb-slot--filled" : "")}>
                {player ? (
                  <>
                    <div className="cb-slot__avatar">
                      {player.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="cb-slot__name">{player.username}</span>
                    {player.isBot && <span className="cb-slot__bot">BOT</span>}
                  </>
                ) : (
                  <span className="cb-slot__empty">Empty slot</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Committing (EOS wait) state ────────────────────────────────────────
  if (battle.status === "committing") {
    return (
      <div className="cb-arena cb-arena--committing">
        <div className="cb-eos-wait">
          <div className="cb-eos-wait__spinner" aria-hidden />
          <h3>Waiting for EOS block</h3>
          <p>
            Target block: <strong>#{battle.eosBlockTarget?.toLocaleString()}</strong>
          </p>
          <p className="cb-eos-wait__hint">
            The battle seed is committed to a future EOS block for provably-fair verification.
            This usually takes 30–60 seconds.
          </p>
          <div className="cb-eos-wait__seed">
            <span>Seed hash:</span>
            <code>{battle.seedHash?.slice(0, 24)}…</code>
          </div>
        </div>
      </div>
    );
  }

  // ─── Running / Completed state — the arena ──────────────────────────────
  const roundDrops = dropsForRound(battle.drops, currentRound);
  const isCompleted = battle.status === "completed";

  // When completed, show all rounds at once (or cycle through them)
  const displayRound = isCompleted ? Math.min(currentRound, battle.rounds - 1) : currentRound;
  const displayDrops = isCompleted
    ? dropsForRound(battle.drops, displayRound)
    : roundDrops;

  // Find winner
  let winnerSlot = -1;
  if (isCompleted) {
    for (const player of battle.players) {
      if (calculatePayoutForSlot(battle, player.slot) > 0) {
        winnerSlot = player.slot;
        break;
      }
    }
  }

  // For jackpot mode, the winner is determined differently — find the slot
  // with a non-zero payout
  const myPayout = userId
    ? Math.max(
        ...battle.players
          .filter((p) => p.userId === userId)
          .map((p) => calculatePayoutForSlot(battle, p.slot)),
        0,
      )
    : 0;

  return (
    <div className="cb-arena">
      {/* Round indicator */}
      <div className="cb-arena__rounds">
        {Array.from({ length: battle.rounds }, (_, i) => (
          <div
            key={i}
            className={
              "cb-round-dot" +
              (i < displayRound ? " cb-round-dot--done" : "") +
              (i === displayRound ? " cb-round-dot--active" : "")
            }
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Player columns */}
      <div
        className="cb-arena__columns"
        style={{ ["--col-count" as string]: battle.players.length }}
      >
        {battle.players.map((player) => (
          <PlayerColumn
            key={player.slot}
            battle={battle}
            player={player}
            currentRound={displayRound}
            roundDrops={displayDrops}
            allDrops={battle.drops}
            isWinner={isCompleted && winnerSlot === player.slot}
            isCurrentUser={player.userId === userId}
            onReelLanded={handleReelLanded}
          />
        ))}
      </div>

      {/* Results */}
      {isCompleted && (
        <div className="cb-arena__results">
          <h2 className="cb-arena__results-title">
            {winnerSlot >= 0
              ? `${battle.players.find((p) => p.slot === winnerSlot)?.username} wins!`
              : "Battle complete"}
          </h2>
          {myPayout > 0 && (
            <p className="cb-arena__payout">
              You won <strong>{formatCoins(myPayout, "balance")}</strong>!
            </p>
          )}
        </div>
      )}
    </div>
  );
}
