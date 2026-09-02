/**
 * Case Battles — Arena
 * Felt seats, lockstep reels, live totals. Phases: wait / committing / opening / result.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import type { CaseBattleView } from "./types";
import {
  calculatePayoutForSlot,
  playerTotalValue,
  addBotToBattle,
  expectedKeepPot,
} from "./caseBattlesApi";
import { PlayerColumn } from "./PlayerColumn";
import { JackpotWheel } from "./JackpotReel";
import { formatCoins } from "../../lib/format";
import { useCanPlay } from "../../lib/canPlay";
import "./CaseBattlesV2.css";

type ArenaProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  isCreator?: boolean;
  /** Explicit refetch after seat mutations — realtime alone is not enough. */
  refetchBattle?: () => void | Promise<void>;
};

type ArenaSession = {
  botBusySlot: number | null;
  canPlay: boolean;
  battleId: string;
};

export function CaseBattleArenaV2({ battle, userId, isCreator = false, refetchBattle }: ArenaProps) {
  const canPlay = useCanPlay();
  const [currentRound, setCurrentRound] = useState(0);
  const [landedSlots, setLandedSlots] = useState<Set<number>>(new Set());
  const [animationReady, setAnimationReady] = useState(false);
  const pauseTimerRef = useRef<number>(0);
  const [syncedLandingStartTime, setSyncedLandingStartTime] = useState<number | null>(null);
  const wasCommittedRef = useRef(false);

  const [botBusySlot, setBotBusySlot] = useState<number | null>(null);
  const [botError, setBotError] = useState<string | null>(null);

  const session = useRef<ArenaSession>({
    botBusySlot: null,
    canPlay,
    battleId: battle.battleId,
  });
  session.current.botBusySlot = botBusySlot;
  session.current.canPlay = canPlay;
  session.current.battleId = battle.battleId;

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

  useEffect(() => {
    if (!allLanded || battle.status !== "running") {
      setAnimationReady(false);
      return;
    }
    pauseTimerRef.current = window.setTimeout(() => setAnimationReady(true), 1500);
    return () => window.clearTimeout(pauseTimerRef.current);
  }, [allLanded, battle.status]);

  const lastRoundIndex = battle.rounds - 1;
  const nextRoundReady =
    currentRound < lastRoundIndex && battle.drops.some((d) => d.round === currentRound + 1);

  useEffect(() => {
    if (!animationReady || !nextRoundReady) return;
    setCurrentRound((r) => r + 1);
    setLandedSlots(new Set());
    setAnimationReady(false);
    setSyncedLandingStartTime(null);
  }, [animationReady, nextRoundReady]);

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

  async function handleAddBotToSlot(slotIndex: number) {
    if (!session.current.canPlay) return;
    if (session.current.botBusySlot != null) return;
    setBotError(null);
    setBotBusySlot(slotIndex);
    session.current.botBusySlot = slotIndex;
    try {
      const { error } = await addBotToBattle(session.current.battleId, slotIndex);
      if (error) {
        setBotError(`Seat ${slotIndex + 1}: ${error}`);
        return;
      }
      // Required: room UI must not rely solely on case_battle_players realtime.
      if (refetchBattle) await refetchBattle();
    } finally {
      setBotBusySlot(null);
      session.current.botBusySlot = null;
    }
  }

  const keepPot = expectedKeepPot(battle);

  if (battle.status === "waiting") {
    return (
      <div className="cb-arena cb-arena--waiting">
        <div className="cb-arena__felt-banner">
          <p className="cb-arena__pot">
            Keep pot <strong>{formatCoins(keepPot, battle.coinType)}</strong>
            {battle.borrowPercent > 0 ? (
              <span className="cb-arena__borrow-tag"> · {battle.borrowPercent}% borrow</span>
            ) : null}
          </p>
          <p className="cb-arena__players">
            {battle.players.length} / {battle.maxPlayers} seats filled
          </p>
        </div>
        <div
          className="cb-arena__slots"
          style={{ ["--col-count" as string]: battle.maxPlayers }}
        >
          {Array.from({ length: battle.maxPlayers }, (_, slot) => {
            const player = battle.players.find((p) => p.slot === slot);
            return (
              <div
                key={slot}
                className={"cb-slot" + (player ? " cb-slot--filled" : " cb-slot--empty")}
              >
                {player ? (
                  <>
                    <div className="cb-slot__avatar">{player.username.charAt(0).toUpperCase()}</div>
                    <span className="cb-slot__name">{player.username}</span>
                    {player.isBot && <span className="cb-slot__bot">BOT</span>}
                  </>
                ) : isCreator && canPlay ? (
                  <button
                    type="button"
                    className="cb-slot__add-bot"
                    onClick={() => handleAddBotToSlot(slot)}
                    disabled={botBusySlot != null}
                    aria-label={`Add a bot to seat ${slot + 1}`}
                  >
                    {botBusySlot === slot ? "Adding…" : "+ Add bot"}
                  </button>
                ) : (
                  <span className="cb-slot__empty">
                    <span className="cb-slot__empty-label">Empty seat</span>
                    <span className="cb-slot__empty-hint">
                      {isCreator && !canPlay ? "log in to add bot" : "waiting"}
                    </span>
                  </span>
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
            Seed committed to a future EOS block. Usually 30–60 seconds.
          </p>
          <div className="cb-eos-wait__seed">
            <span>Seed hash</span>
            <code>{battle.seedHash?.slice(0, 24)}…</code>
          </div>
        </div>
      </div>
    );
  }

  if (battle.status === "running") {
    const roundDrops = battle.drops.filter((d) => d.round === currentRound);
    const visibleAllDrops = battle.drops.filter((d) => d.round <= currentRound);

    return (
      <div className="cb-arena cb-arena--opening">
        <div className="cb-arena__rounds" aria-label="Rounds">
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

  const winningSlots =
    battle.winningSlots && battle.winningSlots.length > 0
      ? battle.winningSlots
      : battle.players
          .filter((p) => p.payoutAmount > 0 && !p.isBot)
          .map((p) => p.slot)
          .sort((a, c) => a - c);

  const isJackpot = battle.gamemode === "jackpot";

  return (
    <div className={"cb-arena cb-arena--completed" + (isJackpot ? " cb-arena--jackpot" : "")}>
      {isJackpot && (
        <JackpotWheel battle={battle} winningSlots={winningSlots} userId={userId} />
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
          {winningSlots.length > 0
            ? (() => {
                const winners = battle.players.filter((p) => winningSlots.includes(p.slot));
                const humanWinners = winners.filter((p) => !p.isBot);
                if (humanWinners.length === 0) return "Battle complete";
                if (humanWinners.length === 1) {
                  const w = humanWinners[0]!;
                  if (w.userId === userId || w.username === "You") return "You win!";
                  return `${w.username} wins!`;
                }
                const names = humanWinners.map((p) => p.username).join(" & ");
                const isMe = humanWinners.some(
                  (p) => p.userId === userId || p.username === "You",
                );
                return isMe
                  ? `You tie! ${names} split the pot`
                  : `${names} tie and split the pot`;
              })()
            : "Battle complete"}
        </h2>
        {(() => {
          const myPlayerSlot = userId
            ? battle.players.find((p) => p.userId === userId)?.slot
            : undefined;
          const myPayout =
            myPlayerSlot !== undefined
              ? calculatePayoutForSlot(battle, myPlayerSlot)
              : 0;
          const myTotalValue =
            myPlayerSlot !== undefined ? playerTotalValue(battle.drops, myPlayerSlot) : 0;
          if (myPayout > 0 && myTotalValue > 0) {
            return (
              <p className="cb-arena__payout">
                You won <strong>{formatCoins(myPayout, battle.coinType)}</strong>
                {" · Unboxed "}
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

function slotSpinSpeed(battleId: string, slot: number): number {
  let h = 0;
  const key = `${battleId}:${slot}`;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return 4 + (Math.abs(h) % 9);
}
