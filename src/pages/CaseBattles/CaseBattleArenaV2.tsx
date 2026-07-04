/**
 * Case Battles v2 — Arena
 * The main battle view: player columns + round indicator + results.
 *
 * Architecture (revised audit v4):
 * - The arena NEVER cycles `currentRound` blindly on a 2s timer. Instead it
 *   gates the transition on TWO conditions: (a) every active player's reel
 *   has called `onReelLanded` for the current round, AND (b) the next
 *   round's drops have arrived from realtime (i.e. a drop with that round
 *   index exists in `battle.drops`). This eliminates the original race
 *   where reels spun forever if the next round's data lagged.
 * - Drop data is masked with `visibleDrops` — never reveal rounds the user
 *   hasn't spun through. The per-round `roundDrops` passed to the PlayerColumn
 *   is filtered to `d.round === currentRound` so each reel only knows its
 *   own target.
 * - On `status === "completed"` we drop the round indicator entirely and
 *   render every drop as a static ledger (PlayerColumn hides its active
 *   reel). This is a strong satisfaction signal — players get a readable
 *   summary, not a movie.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { CaseBattleView } from "./types";
import { calculatePayoutForSlot, playerTotalValue } from "./caseBattlesApi";
import { PlayerColumn } from "./PlayerColumn";
import { formatCoins } from "../../lib/format";
import "./CaseBattlesV2.css";

type ArenaProps = {
  battle: CaseBattleView;
  userId: string | undefined;
};

export function CaseBattleArenaV2({ battle, userId }: ArenaProps) {
  const [currentRound, setCurrentRound] = useState(0);
  const [landedSlots, setLandedSlots] = useState<Set<number>>(new Set());
  /**
   * Set to true when the visual pause after all reels land has elapsed.
   * The actual `currentRound++` only happens when this is true AND the
   * next round's data has arrived — see the gate effect below.
   */
  const [animationReady, setAnimationReady] = useState(false);
  const pauseTimerRef = useRef<number>(0);

  // Reset round state ONLY when crossing the committing → running boundary
  // (the canonical "battle just started" transition) or when the user
  // remounts the page. A realtime refetch that keeps `status === "running"`
  // must NOT wipe currentRound — otherwise a player who navigates away
  // mid-battle and returns would be snapped back to round 0.
  const wasCommittedRef = useRef(false);
  useEffect(() => {
    if (battle.status === "committing") {
      wasCommittedRef.current = true;
    } else if (battle.status === "running" && wasCommittedRef.current) {
      setCurrentRound(0);
      setLandedSlots(new Set());
      setAnimationReady(false);
      wasCommittedRef.current = false;
    } else if (battle.status === "completed") {
      // Collapse the visual round — the PlayerColumn ledger view will
      // ignore `currentRound` entirely (see PlayerColumn `isCompleted`).
      setAnimationReady(false);
    }
    // On battleId change (mount a different battle) reset unconditionally.
    // (This effect's dep is `[status, battleId]` so we don't need an extra
    // check here — the cleanup/re-run cycle covers it.)
  }, [battle.status, battle.battleId]);

  const activePlayerCount = battle.players.length;
  const allLanded =
    activePlayerCount > 0 && landedSlots.size >= activePlayerCount;

  // Visual pause after reels land (1.5s) — gives the eye a beat to read
  // the result before the next round's items appear.
  useEffect(() => {
    if (!allLanded || battle.status !== "running") {
      setAnimationReady(false);
      return;
    }
    // Skip the pause if we're already on the last round — there's nothing
    // to advance to, so flipping animationReady is harmless and dropping
    // it just means the "next round" gating is the only barrier.
    pauseTimerRef.current = window.setTimeout(
      () => setAnimationReady(true),
      1500,
    );
    return () => window.clearTimeout(pauseTimerRef.current);
  }, [allLanded, battle.status]);

  // Gate the round advance: visual pause done AND next round's data
  // present in `battle.drops`. Computing the gate here (not in the parent)
  // means there's no visible "phantom round 1" before realtime delivers
  // round 1 drops — reels just sit at round N until both signals fire.
  const lastRoundIndex = battle.rounds - 1;
  const nextRoundReady =
    currentRound < lastRoundIndex &&
    battle.drops.some((d) => d.round === currentRound + 1);

  useEffect(() => {
    if (!animationReady || !nextRoundReady) return;
    setCurrentRound((r) => r + 1);
    setLandedSlots(new Set());
    setAnimationReady(false);
  }, [animationReady, nextRoundReady]);

  const handleReelLanded = useCallback((slot: number) => {
    setLandedSlots((prev) => {
      if (prev.has(slot)) return prev;
      const next = new Set(prev);
      next.add(slot);
      return next;
    });
  }, []);

  // ─── Waiting state ──────────────────────────────────────────
  if (battle.status === "waiting") {
    return (
      <div className="cb-arena cb-arena--waiting">
        <div className="cb-arena__waiting-info">
          <p className="cb-arena__pot">
            Pot: <strong>{formatCoins(battle.potTotal, battle.coinType)}</strong>
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

  // ─── Committing (EOS wait) state ──────────────────────────────
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

  // ─── Running state — the live arena ───────────────────────────
  if (battle.status === "running") {
    // Round drops masking for PlayerColumn — never let a reel see its own
    // future-round target item before that round starts.
    const roundDrops = battle.drops.filter((d) => d.round === currentRound);
    // Items already revealed in past rounds (used by PlayerColumn's history
    // stack to show "what you already got" above the active reel).
    const visibleAllDrops = battle.drops.filter((d) => d.round <= currentRound);

    return (
      <div className="cb-arena">
        {/* Round indicator */}
        <div className="cb-arena__rounds">
          {Array.from({ length: battle.rounds }, (_, i) => (
            <div
              key={i}
              className={
                "cb-round-dot" +
                (i < currentRound ? " cb-round-dot--done" : "") +
                (i === currentRound ? " cb-round-dot--active" : "")
              }
              aria-label={i < currentRound ? `Round ${i + 1} complete` : i === currentRound ? `Round ${i + 1} in progress` : `Round ${i + 1} upcoming`}
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
              currentRound={currentRound}
              roundDrops={roundDrops}
              visibleDrops={visibleAllDrops}
              isCompleted={false}
              isCurrentUser={player.userId === userId}
              onReelLanded={handleReelLanded}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Completed state — static ledger view ────────────────────
  // No round indicator (we're showing all rounds at once). All PlayerColumns
  // render as item-history lists with totals. The arena footer summarizes
  // the winner + the current user's payout.
  const winnerPayout = battle.players.reduce((max, p) => {
    const amount = calculatePayoutForSlot(battle, p.slot);
    return amount > max ? amount : max;
  }, 0);
  let winnerSlot = -1;
  for (const player of battle.players) {
    if (calculatePayoutForSlot(battle, player.slot) > 0) {
      winnerSlot = player.slot;
      break;
    }
  }
  // Look up the current user's slot ONCE and reuse for both payout and
  // total calculations (avoids re-scanning `battle.players` per call).
  const myPlayerSlot = userId
    ? battle.players.find((p) => p.userId === userId)?.slot
    : undefined;
  const myPayout = myPlayerSlot !== undefined
    ? calculatePayoutForSlot(battle, myPlayerSlot)
    : 0;
  const myTotalValue = myPlayerSlot !== undefined ? playerTotalValue(battle.drops, myPlayerSlot) : 0;

  return (
    <div className="cb-arena cb-arena--completed">
      <div
        className="cb-arena__columns"
        style={{ ["--col-count" as string]: battle.players.length }}
      >
        {battle.players.map((player) => (
          <PlayerColumn
            key={player.slot}
            battle={battle}
            player={player}
            currentRound={battle.rounds - 1}
            roundDrops={[]}
            visibleDrops={battle.drops}
            isCompleted={true}
            isWinner={winnerSlot === player.slot && winnerPayout > 0}
            isCurrentUser={player.userId === userId}
          />
        ))}
      </div>

      <div className="cb-arena__results">
        <h2 className="cb-arena__results-title">
          {winnerSlot >= 0 && winnerPayout > 0
            ? `${battle.players.find((p) => p.slot === winnerSlot)?.username} wins!`
            : "Battle complete"}
        </h2>
        {myPayout > 0 && myTotalValue > 0 && (
          <p className="cb-arena__payout">
            You won <strong>{formatCoins(myPayout, battle.coinType)}</strong>
            {" \u00b7 Total: "}
            <strong>{formatCoins(myTotalValue, battle.coinType)}</strong>
          </p>
        )}
        {myPayout > 0 && myTotalValue === 0 && (
          <p className="cb-arena__payout">
            You won <strong>{formatCoins(myPayout, battle.coinType)}</strong>
          </p>
        )}
      </div>
    </div>
  );
}
