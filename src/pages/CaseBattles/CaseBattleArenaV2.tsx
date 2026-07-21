/**
 * Case Battles v2 — Arena
 *
 * Key changes from the previous version:
 *   - Waiting branch renders a per-slot "+ Add bot here" button on every
 *     empty slot. Clicking a slot calls `addBotToBattle(battleId, slotIndex)`
 *     so the creator can flexibly bot-fill any specific seat instead of
 *     relying on a single global "Add bot" button. Per-slot still respects
 *     the SQL `cb_add_bot` (battle_id, slot_index) RPC and the
 *     `nextOpenSlot` fallback in `localAddBot`.
 *   - Running branch passes a per-slot randomized spinSpeed (derived from
 *     battleId + slot, see `slotSpinSpeed`) so each reel scrolls at its own
 *     natural rate, and a `syncedLandingStartTime` (captured ONCE per round
 *     when every player's drops are visible) so all reels begin their
 *     landing animation in the same instant. The landing window is fixed
 *     (LAND_DURATION = 2400ms), so the synchronized start means the reveal
 *     feels like a single coordinated "stop" for every contestant.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { CaseBattleView } from "./types";
import { calculatePayoutForSlot, playerTotalValue, addBotToBattle } from "./caseBattlesApi";
import { PlayerColumn } from "./PlayerColumn";
import { JackpotWheel } from "./JackpotReel";
import { formatCoins } from "../../lib/format";
import "./CaseBattlesV2.css";

type ArenaProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  isCreator?: boolean;
};

export function CaseBattleArenaV2({ battle, userId, isCreator = false }: ArenaProps) {
  const [currentRound, setCurrentRound] = useState(0);
  const [landedSlots, setLandedSlots] = useState<Set<number>>(new Set());
  const [animationReady, setAnimationReady] = useState(false);
  const pauseTimerRef = useRef<number>(0);

  // Coordinated landing time — once the next-round drops have all arrived
  // from realtime, we send a single timestamp down to every PlayerColumn
  // so all reels transition spinning → landing in lockstep.
  const [syncedLandingStartTime, setSyncedLandingStartTime] = useState<number | null>(null);

  const wasCommittedRef = useRef(false);
  useEffect(() => {
    if (battle.status === "committing") {
      wasCommittedRef.current = true;
    } else if (battle.status === "running" && wasCommittedRef.current) {
      setCurrentRound(0);
      setLandedSlots(new Set());
      setAnimationReady(false);
      setSyncedLandingStartTime(null);
      wasCommittedRef.current = false;
    } else if (battle.status === "completed") {
      setAnimationReady(false);
      setSyncedLandingStartTime(null);
    }
  }, [battle.status, battle.battleId]);

  const activePlayerCount = battle.players.length;
  const allLanded = activePlayerCount > 0 && landedSlots.size >= activePlayerCount;

  // Visual pause after reels land (1.5s) before advancing.
  useEffect(() => {
    if (!allLanded || battle.status !== "running") {
      setAnimationReady(false);
      return;
    }
    pauseTimerRef.current = window.setTimeout(
      () => setAnimationReady(true),
      1500,
    );
    return () => window.clearTimeout(pauseTimerRef.current);
  }, [allLanded, battle.status]);

  // Gate the round advance: visual pause done AND next round's data present.
  const lastRoundIndex = battle.rounds - 1;
  const nextRoundReady =
    currentRound < lastRoundIndex &&
    battle.drops.some((d) => d.round === currentRound + 1);

  useEffect(() => {
    if (!animationReady || !nextRoundReady) return;
    setCurrentRound((r) => r + 1);
    setLandedSlots(new Set());
    setAnimationReady(false);
    setSyncedLandingStartTime(null); // reset sync for the next round
  }, [animationReady, nextRoundReady]);

  // ── Capture the synced landing timestamp ONCE per round ─────────────
  // When every player in the battle has a drop for the current round, we
  // freeze performance.now() and pass it down to every PlayerColumn. Every
  // reel uses this single timestamp as its landingStart, guaranteeing a
  // simultaneous stop.
  useEffect(() => {
    if (battle.status !== "running") return;
    if (syncedLandingStartTime != null) return;
    const expected = activePlayerCount;
    const real = battle.drops.filter((d) => d.round === currentRound).length;
    if (expected > 0 && real >= expected) {
      setSyncedLandingStartTime(performance.now());
    }
  }, [battle.status, battle.drops, currentRound, activePlayerCount, syncedLandingStartTime]);

  const handleReelLanded = useCallback((slot: number) => {
    setLandedSlots((prev) => {
      if (prev.has(slot)) return prev;
      const next = new Set(prev);
      next.add(slot);
      return next;
    });
  }, []);

  // ── Per-slot "Add bot to this slot" handler ──────────────────────────
  // Phase polish: replaced the legacy alert() with an inline error slot
  // so the message persists next to the failing button — the user can
  // read + dismiss + retry without it auto-disappearing on the next
  // render (alert() also blocks the JS thread and isn't styleable).
  const [botBusySlot, setBotBusySlot] = useState<number | null>(null);
  const [botError, setBotError] = useState<string | null>(null);
  async function handleAddBotToSlot(slotIndex: number) {
    if (botBusySlot != null) return;
    setBotError(null);
    setBotBusySlot(slotIndex);
    const { error } = await addBotToBattle(battle.battleId, slotIndex);
    setBotBusySlot(null);
    if (error) setBotError(`Slot ${slotIndex + 1}: ${error}`);
  }

  // ── Waiting state ───────────────────────────────────────────────────
  const isWaitingArena = battle.status === "waiting";
  if (isWaitingArena) {
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
        <div
          className="cb-arena__slots"
          style={{ ["--col-count" as string]: battle.maxPlayers }}
        >
          {Array.from({ length: battle.maxPlayers }, (_, slot) => {
            const player = battle.players.find((p) => p.slot === slot);
            return (
              <div key={slot} className={"cb-slot" + (player ? " cb-slot--filled" : " cb-slot--empty")}>
                {player ? (
                  <>
                    <div className="cb-slot__avatar">
                      {player.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="cb-slot__name">{player.username}</span>
                    {player.isBot && <span className="cb-slot__bot">BOT</span>}
                  </>
                ) : (
                  isCreator ? (
                    <button
                      type="button"
                      className="cb-slot__add-bot"
                      onClick={() => handleAddBotToSlot(slot)}
                      disabled={botBusySlot != null}
                      aria-label={`Add a bot to slot ${slot + 1}`}
                    >
                      {botBusySlot === slot ? "Adding…" : "+ Add bot"}
                    </button>
                  ) : (
                    <span className="cb-slot__empty">
                      <span className="cb-slot__empty-label">Empty slot</span>
                      <span className="cb-slot__empty-hint">pending user</span>
                    </span>
                  )
                )}
              </div>
            );
          })}
        </div>
        {botError && (
          <div className="cb-arena__bot-error" role="alert">
            <p>{botError}</p>
            <button
              type="button"
              className="cb-arena__bot-error-dismiss"
              onClick={() => setBotError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Committing (EOS wait) state ─────────────────────────────────────
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

  // ── Running state — the live arena ──────────────────────────────────
  if (battle.status === "running") {
    const roundDrops = battle.drops.filter((d) => d.round === currentRound);
    const visibleAllDrops = battle.drops.filter((d) => d.round <= currentRound);

    return (
      <div className="cb-arena">
        <div className="cb-arena__rounds">
          {Array.from({ length: battle.rounds }, (_, i) => (
            <div
              key={i}
              className={
                "cb-round-dot" +
                (i < currentRound ? " cb-round-dot--done" : "") +
                (i === currentRound ? " cb-round-dot--active" : "")
              }
              aria-label={
                i < currentRound
                  ? `Round ${i + 1} complete`
                  : i === currentRound
                  ? `Round ${i + 1} in progress`
                  : `Round ${i + 1} upcoming`
              }
            >
              {i + 1}
            </div>
          ))}
        </div>

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
              spinSpeedPx={slotSpinSpeed(battle.battleId, player.slot)}
              syncedLandingStartTime={syncedLandingStartTime}
              onReelLanded={handleReelLanded}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Completed state — static ledger view (+ jackpot wheel) ──────────
  // Tie-aware winners: every slot with a positive payout_amount counts.
  const winningSlots = (battle.winningSlots && battle.winningSlots.length > 0)
    ? battle.winningSlots
    : battle.players
        .filter((p) => p.payoutAmount > 0 && !p.isBot)
        .map((p) => p.slot)
        .sort((a, c) => a - c);

  const isJackpot = battle.gamemode === "jackpot";

  return (
    <div className={"cb-arena cb-arena--completed" + (isJackpot ? " cb-arena--jackpot" : "")}>
      {isJackpot && (
        <JackpotWheel
          battle={battle}
          winningSlots={winningSlots}
          userId={userId}
        />
      )}
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
            isWinner={winningSlots.includes(player.slot)}
            isCurrentUser={player.userId === userId}
          />
        ))}
      </div>

      <div className="cb-arena__results">
        <h2 className="cb-arena__results-title">
          {winningSlots.length > 0 ? (
            (() => {
              // Tie → highlight joint winner(s).
              // Bot-only winners render as a neutral "Battle complete" line.
              const winners = battle.players.filter((p) => winningSlots.includes(p.slot));
              const humanWinners = winners.filter((p) => !p.isBot);
              if (humanWinners.length === 0) return "Battle complete";
              if (humanWinners.length === 1) {
                const w = humanWinners[0]!;
                if (w.userId === userId || w.username === "You") return "You win!";
                return `${w.username} wins!`;
              }
              // Multiple human winners → tie message.
              const names = humanWinners.map((p) => p.username).join(" & ");
              const isMe = humanWinners.some((p) => p.userId === userId || p.username === "You");
              return isMe ? `You tie! ${names} split the pot 50/50` : `${names} tie and split the pot`;
            })()
          ) : (
            "Battle complete"
          )}
        </h2>
        {(() => {
          const myPlayerSlot = userId
            ? battle.players.find((p) => p.userId === userId)?.slot
            : undefined;
          const myPayout = myPlayerSlot !== undefined
            ? calculatePayoutForSlot(battle, myPlayerSlot)
            : 0;
          const myTotalValue = myPlayerSlot !== undefined
            ? playerTotalValue(battle.drops, myPlayerSlot)
            : 0;
          if (myPayout > 0 && myTotalValue > 0) {
            return (
              <p className="cb-arena__payout">
                You won <strong>{formatCoins(myPayout, battle.coinType)}</strong>
                {" · Total: "}
                <strong>{formatCoins(myTotalValue, battle.coinType)}</strong>
              </p>
            );
          }
          if (myPayout > 0) {
            return (
              <p className="cb-arena__payout">
                You won <strong>{formatCoins(myPayout, battle.coinType)}</strong>
              </p>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}

/**
 * Stable per-slot randomization of the reel's spin speed.
 *
 * Each slot gets a fixed pixel-per-frame scroll velocity in [4, 12] derived
 * from the (battleId, slot) tuple via a lightweight hash. Different slots
 * GET DIFFERENT speeds (so they appear to spin at different rates), but the
 * speed for any given slot is DETERMINISTIC across remounts — the user sees
 * the same reel feeling on subsequent visits to the same battle.
 */
function slotSpinSpeed(battleId: string, slot: number): number {
  let h = 0;
  const key = `${battleId}:${slot}`;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  // Map to [4, 12] px/frame.
  return 4 + (Math.abs(h) % 9);
}
