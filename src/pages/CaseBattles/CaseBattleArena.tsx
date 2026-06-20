import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCoins } from "../../lib/format";
import {
  addBotToCaseBattle,
  claimCaseBattlePayout,
  viewCaseBattle,
  type CaseBattlePlayer,
  type CaseBattleView,
} from "../../lib/caseBattles";
import { CASE_BATTLE_BOT_ROSTER, isTeamMode } from "../../lib/games/case-battles";
import { CaseBattleJoinPanel } from "./CaseBattleJoinPanel";
import { CaseBattleRoundsStrip } from "./CaseBattleRoundsStrip";
import { CaseBattleFinalResults } from "./CaseBattleFinalResults";
import { CaseBattlePlayerColumn, type PlayerColumnPhase } from "./CaseBattlePlayerColumn";
import { CaseBattlePullsColumn } from "./CaseBattlePullsColumn";
import { EosBlockWait } from "./EosBlockWait";
import { JackpotReel } from "./JackpotReel";
import { battleRevealedUnboxed, battleTotalUnboxed } from "./battleResultHelpers";
import {
  consumePlaybackReload,
  finishedPlaybackSnapshot,
  peekPlaybackReload,
  isPlaybackInProgress,
  markPlaybackReload,
  readBattlePlayback,
  writeBattlePlayback,
} from "./battlePlaybackStorage";
import { getPlaybackAnchorMs, getPlaybackSyncDecision } from "./battlePlaybackSync";
import { battleSlotGroups, gamemodeIcon, gamemodeLabel } from "./caseBattlesUi";
import "./CaseBattlesRoom.css";
import "./CaseOpenReel.css";

const ROUND_DELAY_MS = 5000;
const ROUND_DELAY_FAST_MS = 2000;

function reelItemHeight(playerCount: number): number {
  if (playerCount >= 6) return 58;
  if (playerCount >= 5) return 64;
  if (playerCount >= 4) return 72;
  return 80;
}

type CaseBattleArenaProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  balance: number;
  onBattleUpdate: (battle: CaseBattleView) => void;
  onError: (message: string | null) => void;
  onComplete?: () => void;
  onPayoutClaimed?: () => void;
};

function resolvePlaybackBootstrap(
  battleId: string,
  battleStatus: string,
  rounds: number,
  isJackpot: boolean,
  resumedReload: boolean
) {
  void rounds; // Reserved for future per-round replay pacing; not currently needed for bootstrap.
  const saved = readBattlePlayback(battleId);
  const inProgress = isPlaybackInProgress(saved, isJackpot);

  /** Resume mid-replay (refresh, back button, etc.) from session progress. */
  if (saved && inProgress) {
    return {
      activeRound: saved.activeRound,
      settledRounds: saved.settledRounds,
      roundsStarted: true,
      casesPlaybackDone: saved.casesPlaybackDone,
      jackpotReelDone: isJackpot ? saved.jackpotReelDone : true,
      forceFull: false,
      skipPlaybackSync: false,
      resumedFromReload: resumedReload,
    };
  }

  /** Server settled the battle, but the user already watched the full replay. */
  if (
    saved &&
    !inProgress &&
    (battleStatus === "completed" || battleStatus === "pending_jackpot_eos")
  ) {
    return {
      activeRound: saved.activeRound,
      settledRounds: saved.settledRounds,
      roundsStarted: true,
      casesPlaybackDone: saved.casesPlaybackDone,
      jackpotReelDone: isJackpot ? saved.jackpotReelDone : true,
      forceFull: false,
      skipPlaybackSync: true,
      resumedFromReload: false,
    };
  }

  /**
   * Server may be completed (EOS mined) before the client finishes animating.
   * Always run the full case reel playback unless session storage shows a finished watch.
   */
  if (battleStatus === "completed" || battleStatus === "pending_jackpot_eos") {
    return {
      activeRound: 0,
      settledRounds: 0,
      roundsStarted: false,
      casesPlaybackDone: false,
      jackpotReelDone: !isJackpot,
      forceFull: true,
      skipPlaybackSync: false,
      resumedFromReload: resumedReload,
    };
  }

  return {
    activeRound: 0,
    settledRounds: 0,
    roundsStarted: false,
    casesPlaybackDone: false,
    jackpotReelDone: false,
    forceFull: true,
    skipPlaybackSync: false,
    resumedFromReload: false,
  };
}

export function CaseBattleArena({
  battle,
  userId,
  balance,
  onBattleUpdate,
  onError,
  onComplete,
  onPayoutClaimed,
}: CaseBattleArenaProps) {
  const payoutClaimStartedRef = useRef(false);
  const battleGamemodeInit = battle.gamemode ?? "normal";
  const isJackpotInit = battleGamemodeInit === "jackpot";
  const initialPlayback = resolvePlaybackBootstrap(
    battle.battleId,
    battle.status,
    battle.rounds,
    isJackpotInit,
    peekPlaybackReload(battle.battleId)
  );

  const [activeRound, setActiveRound] = useState(initialPlayback.activeRound);
  const [settledRounds, setSettledRounds] = useState(initialPlayback.settledRounds);
  const [reelsFinished, setReelsFinished] = useState(0);
  const [roundsStarted, setRoundsStarted] = useState(initialPlayback.roundsStarted);
  const [jackpotReelDone, setJackpotReelDone] = useState(initialPlayback.jackpotReelDone);
  const [casesPlaybackDone, setCasesPlaybackDone] = useState(initialPlayback.casesPlaybackDone);
  const [awaitingRoundSync, setAwaitingRoundSync] = useState(false);
  const [pendingBotSlots, setPendingBotSlots] = useState<Set<number>>(new Set());
  const pendingBotRef = useRef<Set<number>>(new Set());
  const playbackSyncAppliedRef = useRef(false);
  const playbackSyncTimerRef = useRef<number | null>(null);
  const forceFullRoundPlaybackRef = useRef(initialPlayback.forceFull);
  const skipPlaybackSyncRef = useRef(initialPlayback.skipPlaybackSync);
  const resumedFromSessionRef = useRef(false);

  const spinDurationMs = battle.fastSpin ? ROUND_DELAY_FAST_MS : ROUND_DELAY_MS;
  const isCreator = battle.creatorId === userId;
  const battleGamemode = battle.gamemode ?? "normal";
  const isJackpotMode = battleGamemode === "jackpot";
  const isEosPending = battle.status === "pending_eos";
  const hasRoundData = battle.players.some((p) => p.drops.length > 0);
  const canPlayRounds =
    (battle.status === "completed" || battle.status === "pending_jackpot_eos") && hasRoundData;
  const casesAndJackpotDone = casesPlaybackDone && (!isJackpotMode || jackpotReelDone);
  const showStaticResults = battle.status === "completed" && casesAndJackpotDone;
  const revealedRounds = showStaticResults ? battle.rounds : settledRounds;

  const reelsPhase =
    !showStaticResults &&
    !awaitingRoundSync &&
    canPlayRounds &&
    roundsStarted &&
    settledRounds <= activeRound &&
    activeRound < battle.rounds;

  const resultData = battle.results as {
    winnerPayouts?: { userId: string; amount: number }[];
    gamemode?: string;
    jackpotWeights?: { slot: number; weight: number }[];
    jackpotReelSlot?: number;
    winningSlots?: number[];
  } | null;

  const myWinPayout =
    battle.status === "completed"
      ? (resultData?.winnerPayouts?.find((p) => p.userId === userId)?.amount ?? 0)
      : 0;

  const isWinner = battle.status === "completed" && myWinPayout > 0;
  const roundsComplete = settledRounds >= battle.rounds && battle.rounds > 0;
  const showJackpotEosWait =
    isJackpotMode &&
    battle.status === "pending_jackpot_eos" &&
    casesPlaybackDone &&
    roundsStarted;
  const showJackpotReel =
    !showStaticResults &&
    battle.status === "completed" &&
    isJackpotMode &&
    casesPlaybackDone &&
    roundsStarted &&
    !reelsPhase &&
    !jackpotReelDone &&
    !showJackpotEosWait;
  const showPlayerBoard =
    battle.status === "waiting" ||
    battle.status === "pending_eos" ||
    (canPlayRounds && roundsStarted) ||
    showStaticResults;

  const columnPhase: PlayerColumnPhase = showStaticResults
    ? "results"
    : battle.status === "waiting" || battle.status === "pending_eos" || !roundsStarted
      ? "lobby"
      : "playing";

  const userInBattle = battle.players.some((p) => p.userId === userId);
  const canJoin =
    battle.status === "waiting" &&
    !userInBattle &&
    battle.players.length < battle.maxPlayers &&
    userId != null;

  const jackpotReelSlot = resultData?.jackpotReelSlot ?? battle.winnerSlot ?? 0;
  const playerCount = battle.maxPlayers;
  const reelItemH = reelItemHeight(playerCount);

  const slotGroups = useMemo(
    () => battleSlotGroups(battle.playerMode, battle.gamemode, battle.maxPlayers),
    [battle.playerMode, battle.gamemode, battle.maxPlayers]
  );
  const showTeamDividers = battle.gamemode !== "group" && slotGroups.length > 1;

  const showPullsRow = roundsStarted && battle.status !== "waiting";
  const showPotInMeta =
    showStaticResults ||
    battle.status === "waiting" ||
    (roundsStarted && hasRoundData);
  const displayPot = useMemo(() => {
    if (!hasRoundData || !roundsStarted) return battle.potTotal;
    if (showStaticResults) return battleTotalUnboxed(battle);
    return battleRevealedUnboxed(battle, revealedRounds);
  }, [battle, hasRoundData, roundsStarted, showStaticResults, revealedRounds]);

  useEffect(() => {
    if (battle.status === "waiting") {
      forceFullRoundPlaybackRef.current = true;
    }
  }, [battle.status, battle.battleId]);

  const clearAwaitingRoundSync = useCallback(() => {
    if (playbackSyncTimerRef.current != null) {
      window.clearTimeout(playbackSyncTimerRef.current);
      playbackSyncTimerRef.current = null;
    }
    setAwaitingRoundSync(false);
    setReelsFinished(0);
  }, []);

  const applyPlaybackBootstrap = useCallback(() => {
    const boot = resolvePlaybackBootstrap(
      battle.battleId,
      battle.status,
      battle.rounds,
      isJackpotMode,
      consumePlaybackReload(battle.battleId)
    );
    playbackSyncAppliedRef.current = boot.skipPlaybackSync;
    skipPlaybackSyncRef.current = boot.skipPlaybackSync;
    resumedFromSessionRef.current = boot.resumedFromReload;
    if (playbackSyncTimerRef.current != null) {
      window.clearTimeout(playbackSyncTimerRef.current);
      playbackSyncTimerRef.current = null;
    }
    setAwaitingRoundSync(false);
    forceFullRoundPlaybackRef.current = boot.forceFull;
    setActiveRound(boot.activeRound);
    setSettledRounds(boot.settledRounds);
    setCasesPlaybackDone(boot.casesPlaybackDone);
    setJackpotReelDone(boot.jackpotReelDone);
    setReelsFinished(0);
    setRoundsStarted(boot.roundsStarted);
  }, [battle.battleId, battle.status, battle.rounds, isJackpotMode]);

  useEffect(() => {
    applyPlaybackBootstrap();
    // Only re-bootstrap when switching battles — not when status flips to completed mid-playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.battleId]);

  useEffect(() => {
    const onPageHide = () => {
      if (casesAndJackpotDone) return;
      markPlaybackReload(battle.battleId);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [battle.battleId, casesAndJackpotDone]);

  useEffect(() => {
    if (!showStaticResults) return;
    writeBattlePlayback(battle.battleId, finishedPlaybackSnapshot(battle.rounds));
  }, [showStaticResults, battle.battleId, battle.rounds]);

  useEffect(() => {
    if (
      battle.status !== "completed" &&
      battle.status !== "pending_jackpot_eos"
    ) {
      return;
    }
    if (!roundsStarted && settledRounds === 0 && !casesPlaybackDone) return;
    writeBattlePlayback(battle.battleId, {
      settledRounds,
      activeRound,
      casesPlaybackDone,
      jackpotReelDone: isJackpotMode ? jackpotReelDone : true,
    });
  }, [
    battle.battleId,
    battle.status,
    settledRounds,
    activeRound,
    casesPlaybackDone,
    jackpotReelDone,
    roundsStarted,
    isJackpotMode,
  ]);

  useEffect(() => {
    if (!hasRoundData || !awaitingRoundSync) return;

    const anchorMs = getPlaybackAnchorMs(battle.results);
    const sync = anchorMs
      ? getPlaybackSyncDecision(anchorMs, spinDurationMs, battle.rounds)
      : null;

    const serverPastPlayback =
      battle.status === "completed" ||
      (battle.status === "pending_jackpot_eos" && sync?.allRoundsDone);

    if (!serverPastPlayback) return;
    clearAwaitingRoundSync();
  }, [
    battle.status,
    battle.results,
    battle.rounds,
    hasRoundData,
    awaitingRoundSync,
    spinDurationMs,
    clearAwaitingRoundSync,
  ]);

  useEffect(() => {
    if (
      !canPlayRounds ||
      showStaticResults ||
      skipPlaybackSyncRef.current ||
      playbackSyncAppliedRef.current
    ) {
      return;
    }

    playbackSyncAppliedRef.current = true;
    if (!roundsStarted) setRoundsStarted(true);

    if (forceFullRoundPlaybackRef.current) {
      if (resumedFromSessionRef.current) {
        resumedFromSessionRef.current = false;
        return;
      }
      setSettledRounds(0);
      setActiveRound(0);
      setReelsFinished(0);
      return;
    }

    const anchorMs = getPlaybackAnchorMs(battle.results);
    if (anchorMs == null) {
      // No playback anchor — server completed without timing data.
      // Start from the beginning so we always play through all rounds.
      setSettledRounds(0);
      setActiveRound(0);
      setReelsFinished(0);
      return;
    }

    const sync = getPlaybackSyncDecision(anchorMs, spinDurationMs, battle.rounds);

    if (sync.allRoundsDone) {
      if (forceFullRoundPlaybackRef.current) {
        setSettledRounds(0);
        setActiveRound(0);
      } else {
        // Late joiner: replay just the last round so they see at least one spin.
        const lastRound = Math.max(0, battle.rounds - 1);
        setSettledRounds(lastRound);
        setActiveRound(lastRound);
      }
      setReelsFinished(0);
      return;
    }

    setSettledRounds(sync.settledRounds);
    setActiveRound(sync.activeRound);
    setReelsFinished(0);

    if (!sync.waitForNextRound) return;

    setAwaitingRoundSync(true);
    playbackSyncTimerRef.current = window.setTimeout(() => {
      playbackSyncTimerRef.current = null;
      setAwaitingRoundSync(false);
      setReelsFinished(0);
    }, sync.waitMs);

    return () => {
      if (playbackSyncTimerRef.current != null) {
        window.clearTimeout(playbackSyncTimerRef.current);
        playbackSyncTimerRef.current = null;
      }
    };
  }, [
    canPlayRounds,
    showStaticResults,
    battle.results,
    battle.rounds,
    spinDurationMs,
    battle.battleId,
    isJackpotMode,
  ]);

  useEffect(() => {
    if (!reelsPhase || battle.players.length === 0) return;
    if (reelsFinished < battle.players.length) return;

    const t = window.setTimeout(() => {
      const nextSettled = activeRound + 1;
      setSettledRounds(nextSettled);
      setReelsFinished(0);
      if (nextSettled >= battle.rounds) {
        setCasesPlaybackDone(true);
      } else {
        setActiveRound(nextSettled);
      }
    }, 350);

    return () => window.clearTimeout(t);
  }, [reelsFinished, reelsPhase, battle.players.length, activeRound, battle.rounds]);

  // Fallback: if some reels never fire onReelComplete (e.g. missing drop data),
  // force-advance after a grace period so the battle never gets permanently stuck.
  useEffect(() => {
    if (!reelsPhase || battle.players.length === 0) return;
    const gracePeriodMs = spinDurationMs + 2000;
    const t = window.setTimeout(() => {
      setReelsFinished(battle.players.length);
    }, gracePeriodMs);
    return () => window.clearTimeout(t);
  }, [reelsPhase, activeRound, battle.players.length, spinDurationMs]);

  const handleReelComplete = useCallback(() => {
    setReelsFinished((n) => n + 1);
  }, []);

  const handleJackpotReelComplete = useCallback(() => {
    setJackpotReelDone(true);
  }, []);

  useEffect(() => {
    if (!showStaticResults || !userId || payoutClaimStartedRef.current) return;
    if (battle.payoutsCredited) return;

    const payout =
      resultData?.winnerPayouts?.find((p) => p.userId === userId)?.amount ?? 0;
    if (payout <= 0) return;

    payoutClaimStartedRef.current = true;
    void claimCaseBattlePayout(battle.battleId).then(({ data, error: claimErr }) => {
      if (claimErr) {
        payoutClaimStartedRef.current = false;
        onError(claimErr);
        return;
      }
      if (data?.credited) {
        onPayoutClaimed?.();
      }
    });
  }, [
    showStaticResults,
    userId,
    battle.battleId,
    battle.payoutsCredited,
    resultData?.winnerPayouts,
    onError,
    onPayoutClaimed,
  ]);

  const handleAddBot = useCallback(
    (slotIndex: number) => {
      if (pendingBotRef.current.has(slotIndex)) return;
      if (battle.players.some((p) => p.slot === slotIndex)) return;

      pendingBotRef.current.add(slotIndex);
      setPendingBotSlots(new Set(pendingBotRef.current));
      onError(null);

      void addBotToCaseBattle(battle.battleId, slotIndex).then(async ({ data, error: err }) => {
        pendingBotRef.current.clear();
        setPendingBotSlots(new Set());
        if (data) {
          onError(null);
          onBattleUpdate(data);
          return;
        }
        const refresh = await viewCaseBattle(battle.battleId);
        if (refresh.data) {
          onBattleUpdate(refresh.data);
          if (refresh.data.status === "completed" || refresh.data.status === "running") {
            onError(null);
            return;
          }
        }
        onError(err ?? "Could not add bot.");
      });
    },
    [battle.battleId, onBattleUpdate, onError]
  );

  const playerIsWinner = (player: CaseBattlePlayer) =>
    showStaticResults &&
    (battleGamemode === "group"
      ? (resultData?.winnerPayouts?.some((p) => p.userId === player.userId && p.amount > 0) ?? false)
      : battleGamemode === "jackpot" && isTeamMode(battle.playerMode)
        ? battle.winningSlots.includes(player.slot)
        : battle.winningSlots.length > 0
          ? battle.winningSlots.includes(player.slot)
          : battle.winnerSlot === player.slot);

  const renderSlotColumn = (slot: number) => {
    const player = battle.players.find((p) => p.slot === slot);
    return (
      <CaseBattlePlayerColumn
        key={slot}
        slot={slot}
        player={player}
        battle={battle}
        isCreator={isCreator}
        isPendingBot={pendingBotSlots.size > 0}
        phase={columnPhase}
        gamemode={battleGamemode}
        isYou={player?.userId === userId}
        activeRound={activeRound}
        revealedRounds={showJackpotReel || showStaticResults ? battle.rounds : revealedRounds}
        spinDurationMs={spinDurationMs}
        reelsPhase={showJackpotReel ? false : reelsPhase}
        reelItemHeight={reelItemH}
        onAddBot={columnPhase === "lobby" && battle.status === "waiting" ? handleAddBot : undefined}
        onReelComplete={columnPhase === "playing" ? handleReelComplete : undefined}
      />
    );
  };

  const renderPullsColumn = (slot: number) => {
    const player = battle.players.find((p) => p.slot === slot);
    return (
      <CaseBattlePullsColumn
        key={`pulls-${slot}`}
        slot={slot}
        player={player}
        isYou={player?.userId === userId}
        isWinner={player != null && playerIsWinner(player)}
        revealedRounds={
          showStaticResults || casesPlaybackDone ? battle.rounds : revealedRounds
        }
      />
    );
  };

  return (
    <div
      className="cbr__arena"
      data-phase={
        showStaticResults
          ? "completed"
          : battle.status === "waiting" || isEosPending
            ? "waiting"
            : "running"
      }
    >
      <div className="cbr__arena-head">
        <div className="cbr__arena-badges">
          <span className="cbr__badge">{battle.playerMode.toUpperCase()}</span>
          <span className="cbr__badge cbr__badge--mode">
            {gamemodeIcon(battle.gamemode)} {gamemodeLabel(battle.gamemode)}
          </span>
          {battle.crazyMode && <span className="cbr__badge cbr__badge--crazy">Crazy</span>}
          {battle.fastSpin && <span className="cbr__badge cbr__badge--fast">Fast</span>}
          <span
            className={
              "cbr__badge cbr__badge--phase" +
              (showStaticResults
                ? " cbr__badge--phase-done"
                : battle.status === "waiting" || isEosPending
                  ? " cbr__badge--phase-waiting"
                  : " cbr__badge--phase-running")
            }
            aria-live="polite"
          >
            {showStaticResults
              ? "Completed"
              : battle.status === "waiting"
                ? "Open"
                : isEosPending
                  ? "Mining EOS"
                  : "Live"}
          </span>
        </div>
        <p className="cbr__arena-meta">
          {battle.rounds} case{battle.rounds === 1 ? "" : "s"} · Entry {formatCoins(battle.entryCost, "balance")} per seat
          {showStaticResults ? (
            <>
              {" "}
              · Unboxed {formatCoins(battleTotalUnboxed(battle), "balance")} · Entry pot {formatCoins(battle.potTotal, "balance")}
            </>
          ) : showPotInMeta ? (
            <>
              {" "}
              · {battle.status === "waiting"
                ? "Pot so far"
                : "Unboxed"}{" "}
              {formatCoins(displayPot, "balance")}
            </>
          ) : null}
        </p>
        <div className="cbr__arena-status-stack" role="status" aria-live="polite">
          {battle.status === "waiting" && (
            <p className="cbr__arena-status">
              Waiting for players — {battle.players.length}/{battle.maxPlayers} filled
              {isCreator
                ? ` · Call bots — random pick from ${CASE_BATTLE_BOT_ROSTER.length} lucky bots`
                : ""}
            </p>
          )}
          {isEosPending && (
            <p className="cbr__arena-status">Committing battle seed — waiting for EOS block…</p>
          )}
          {awaitingRoundSync && (
            <p className="cbr__arena-status">Catching up — next round starts shortly…</p>
          )}
          {reelsPhase && !showStaticResults && (
            <p className="cbr__arena-status">
              Round {activeRound + 1} of {battle.rounds} · Opening cases…
            </p>
          )}
          {showJackpotEosWait && (
            <p className="cbr__arena-status">All cases opened — waiting for jackpot EOS block…</p>
          )}
          {showJackpotReel && <p className="cbr__arena-status">Jackpot block mined — rolling for winner…</p>}
        </div>
        {showStaticResults && isWinner && (
          <span
            className="cbr__result-pill cbr__result-pill--win"
            role="status"
            aria-live="polite"
          >
            You won {formatCoins(myWinPayout, "balance")}
          </span>
        )}
        {showStaticResults && !isWinner && userId && userInBattle && (
          <span
            className="cbr__result-pill cbr__result-pill--neutral"
            role="status"
            aria-live="polite"
          >
            Battle complete — no win this time
          </span>
        )}
      </div>

      {battle.caseIds.length > 0 &&
        (columnPhase !== "lobby" || battle.status === "pending_eos") && (
          <CaseBattleRoundsStrip
            caseIds={battle.caseIds}
            focusIndex={activeRound}
            isPlaying={roundsStarted && !showStaticResults}
            showComplete={showStaticResults || roundsComplete}
          />
        )}

      {isEosPending && (
        <EosBlockWait
          targetBlockNum={battle.eosTargetBlockNum}
          commitBlockNum={battle.eosCommitBlockNum}
          blockId={battle.eosBlockId}
          seedHash={battle.battleSeedHash}
        />
      )}

      {showJackpotEosWait && (
        <EosBlockWait
          variant="jackpot"
          targetBlockNum={battle.jackpotEosTargetBlockNum}
          commitBlockNum={battle.jackpotEosCommitBlockNum}
          blockId={battle.jackpotEosBlockId}
          seedHash={battle.battleSeedHash}
        />
      )}

      {showJackpotReel && battle.players.length > 0 && (
        <JackpotReel
          key={`${battle.battleId}-jackpot`}
          players={battle.players}
          weights={resultData?.jackpotWeights ?? []}
          targetSlot={jackpotReelSlot}
          spinDurationMs={battle.fastSpin ? 2400 : 5200}
          jackpotEosBlockId={battle.jackpotEosBlockId}
          onComplete={handleJackpotReelComplete}
        />
      )}

      {canJoin && (
        <CaseBattleJoinPanel
          battle={battle}
          balance={balance}
          onJoined={onBattleUpdate}
          onError={onError}
        />
      )}

      {showPlayerBoard && (
        <div className="cbr__battle-board" data-count={playerCount} data-phase={columnPhase}>
          {showStaticResults ? (
            <CaseBattleFinalResults
              battle={battle}
              userId={userId}
              slotGroups={slotGroups}
              showTeamDividers={showTeamDividers}
            />
          ) : (
            <div className={"cbr__players-row" + (showJackpotReel ? " cbr__players-row--dimmed" : "")}>
              {slotGroups.map((teamSlots, groupIdx) => (
                <div key={`col-g-${groupIdx}`} className="cbr__board-group">
                  {showTeamDividers && groupIdx > 0 && (
                    <span className="cbr__lobby-vs cbr__lobby-vs--battle" aria-hidden>
                      ×
                    </span>
                  )}
                  <div className="cbr__board-team">{teamSlots.map(renderSlotColumn)}</div>
                </div>
              ))}
            </div>
          )}

          {showPullsRow && (
            <div className="cbr__pulls-section">
              <h3 className="cbr__pulls-section-title">Pull history</h3>
              <div className="cbr__pulls-row">
                {slotGroups.map((teamSlots, groupIdx) => (
                  <div key={`pulls-g-${groupIdx}`} className="cbr__board-group">
                    {showTeamDividers && groupIdx > 0 && (
                      <span className="cbr__lobby-vs cbr__lobby-vs--pulls" aria-hidden />
                    )}
                    <div className="cbr__board-team">{teamSlots.map(renderPullsColumn)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showStaticResults && onComplete && (
        <button type="button" className="cb-page__btn-primary cbr__done-btn" onClick={onComplete}>
          Back to battles
        </button>
      )}
    </div>
  );
}