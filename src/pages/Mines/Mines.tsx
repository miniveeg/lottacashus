import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import {
  getMaxGems,
  getMinesMultiplier,
  getNextMultiplier,
  MINES_MAX_COUNT,
  MINES_MIN_COUNT,
} from "../../lib/games/mines";
import { formatCoins } from "../../lib/format";
import {
  cashoutMinesGame,
  fetchMinesPfState,
  fetchMyActiveMinesGame,
  revealMinesTile,
  setMinesClientSeed,
  startMinesGame,
} from "../../lib/mines";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import "../../styles/game-controls.css";
import "./Mines.css";

/** Idle → active (betting/revealing) → won | bust → idle. */
type MinesPhase = "idle" | "active" | "won" | "bust";

type Pending = null | "start" | "reveal" | "cashout";

const TILES = Array.from({ length: 25 }, (_, i) => i);

function randomUnrevealedTile(revealed: ReadonlySet<number>): number | null {
  const pool = TILES.filter((t) => !revealed.has(t));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

type SessionRefs = {
  phase: MinesPhase;
  pending: Pending;
  gameId: string | null;
  gameCoinType: string | null;
  revealed: Set<number>;
  wager: number;
  mineCount: number;
  gemsRevealed: number;
  coinType: string;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
};

export function Mines() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<MinesPhase>("idle");
  const [pending, setPending] = useState<Pending>(null);

  const [mineCount, setMineCount] = useState(3);
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [error, setError] = useState<string | null>(null);

  const [gameId, setGameId] = useState<string | null>(null);
  /** Coin type locked when the round started (must match server debit). */
  const [gameCoinType, setGameCoinType] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [gemsRevealed, setGemsRevealed] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [bustedMines, setBustedMines] = useState<number[] | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [randomSpinKey, setRandomSpinKey] = useState(0);

  const session = useRef<SessionRefs>({
    phase: "idle",
    pending: null,
    gameId: null,
    gameCoinType: null,
    revealed: new Set(),
    wager: 1,
    mineCount: 3,
    gemsRevealed: 0,
    coinType: "sweeps_coins",
    profile,
    user,
    isGuest,
  });

  const busy = pending !== null;
  const isPlaying = phase === "active" && gameId !== null;
  const maxGems = getMaxGems(mineCount);
  const nextMult = isPlaying
    ? getNextMultiplier(mineCount, gemsRevealed)
    : getMinesMultiplier(mineCount, 1);
  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );
  const sliderStyle = {
    "--mines-risk": mineCount / MINES_MAX_COUNT,
  } as CSSProperties;

  useEffect(() => {
    session.current = {
      phase,
      pending,
      gameId,
      gameCoinType,
      revealed,
      wager,
      mineCount,
      gemsRevealed,
      coinType,
      profile,
      user,
      isGuest,
    };
  }, [
    phase,
    pending,
    gameId,
    gameCoinType,
    revealed,
    wager,
    mineCount,
    gemsRevealed,
    coinType,
    profile,
    user,
    isGuest,
  ]);

  const loadPf = useCallback(async () => {
    const { data } = await fetchMinesPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  const resumeGame = useCallback(async () => {
    const { data, error: resumeErr } = await fetchMyActiveMinesGame();
    if (resumeErr || !data) return;
    setGameId(data.gameId);
    setGameCoinType(data.coinType ?? "sweeps_coins");
    setWager(Number(data.wager));
    setWagerInput(Number(data.wager).toFixed(2));
    setMineCount(data.mineCount);
    setRevealed(new Set(data.revealedTiles));
    setGemsRevealed(data.gemsRevealed);
    setMultiplier(Number(data.multiplier));
    setBustedMines(null);
    setLastMessage(null);
    setPhase("active");
    setPending(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadPf();
    void resumeGame();
  }, [user, loadPf, resumeGame]);

  const clearBoard = () => {
    setGameId(null);
    setGameCoinType(null);
    setRevealed(new Set());
    setGemsRevealed(0);
    setMultiplier(1);
    setBustedMines(null);
  };

  const applyWager = (value: number) => {
    const v = clampWager(value);
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const handleStart = async () => {
    const s = session.current;
    if (s.pending !== null || s.phase === "active") return;

    const authErr = realMoneyBetError(s.user, s.isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }

    const activeBalance = getActiveBalance(s.profile);
    if (s.wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastMessage(null);
    setPending("start");
    clearBoard();
    setPhase("idle");

    const { data, error: startErr } = await startMinesGame({
      wager: s.wager,
      mineCount: s.mineCount,
      coinType: s.coinType,
    });

    if (startErr || !data) {
      setPending(null);
      setError(startErr ?? "Could not start game.");
      void refreshProfile();
      return;
    }

    setGameId(data.gameId);
    setGameCoinType(data.coinType ?? s.coinType);
    setPfNonce(data.nonce + 1);
    setPhase("active");
    setPending(null);
  };

  const handleCashout = async (auto = false, knownGems?: number) => {
    const s = session.current;
    // Manual cashout: block if anything is already in flight.
    // Auto-cashout runs from handleReveal while pending === "reveal".
    if (!auto && s.pending !== null) return;

    const gameIdNow = s.gameId;
    const currentGems = knownGems ?? s.gemsRevealed;
    if (!gameIdNow || currentGems < 1) {
      if (auto) setPending(null);
      return;
    }

    setPending("cashout");
    setError(null);

    const { data, error: cashErr } = await cashoutMinesGame({
      gameId: gameIdNow,
      coinType: s.gameCoinType ?? s.coinType,
    });

    setPending(null);

    if (cashErr || !data) {
      setError(cashErr ?? "Cashout failed.");
      void refreshProfile();
      return;
    }

    const cashCoin =
      (s.gameCoinType === "sweeps_coins" ? "sweeps_coins" : s.coinType) as
        | "balance"
        | "sweeps_coins";

    setLastMessage(
      auto
        ? `All gems found! Won ${formatCoins(data.payout, cashCoin)}`
        : `Cashed out ${formatCoins(data.payout, cashCoin)} at ${data.multiplier}×`
    );
    clearBoard();
    setPhase("won");
    await refreshProfile();
    await loadPf();
  };

  const handleReveal = async (tile: number) => {
    const s = session.current;
    if (s.phase !== "active" || !s.gameId || s.pending !== null) return;
    if (s.revealed.has(tile)) return;

    setPending("reveal");
    setError(null);

    const { data, error: revealErr } = await revealMinesTile({
      gameId: s.gameId,
      tile,
      mineCount: s.mineCount,
      coinType: s.coinType,
    });

    if (revealErr || !data) {
      setPending(null);
      setError(revealErr ?? "Reveal failed.");
      void refreshProfile();
      return;
    }

    setRevealed((prev) => new Set([...prev, tile]));

    if (data.isMine) {
      setBustedMines(data.mineTiles ?? []);
      setGameId(null);
      setGameCoinType(null);
      setLastMessage("Mine hit — round lost.");
      setPhase("bust");
      setPending(null);
      await refreshProfile();
      await loadPf();
      return;
    }

    setGemsRevealed(data.gemsRevealed);
    setMultiplier(data.multiplier);

    const safeTiles = getMaxGems(s.mineCount);
    if (data.gemsRevealed >= safeTiles) {
      // Pass knownGems — gems state is still the pre-reveal value here.
      await handleCashout(true, data.gemsRevealed);
      return;
    }

    setPending(null);
  };

  const pickRandom = () => {
    const s = session.current;
    if (s.phase !== "active" || s.pending !== null) return;
    const tile = randomUnrevealedTile(s.revealed);
    if (tile === null) return;
    setRandomSpinKey((n) => n + 1);
    void handleReveal(tile);
  };

  // Hotkeys read session refs so bindings stay correct without fragile deps.
  // Space/Enter → start (idle) or cash out (≥1 gem). C cash out. R random.
  // [ / ] half / double wager when idle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;

      const s = session.current;
      const k = e.key.toLowerCase();
      const canAct = s.pending === null;

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (!canAct) return;
        if (s.phase === "active" && s.gemsRevealed >= 1) void handleCashout(false);
        else if (s.phase !== "active") void handleStart();
        return;
      }
      if (k === "c") {
        if (canAct && s.phase === "active" && s.gemsRevealed >= 1) {
          e.preventDefault();
          void handleCashout(false);
        }
        return;
      }
      if (k === "r") {
        if (canAct && s.phase === "active") {
          e.preventDefault();
          pickRandom();
        }
        return;
      }
      if (k === "[") {
        if (canAct && s.phase !== "active") {
          e.preventDefault();
          applyWager(s.wager / 2);
        }
        return;
      }
      if (k === "]") {
        if (canAct && s.phase !== "active") {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(s.wager * 2, bal));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over stable refs; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setMinesClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  function tileClass(tile: number): string {
    const classes = ["mines__tile"];
    const isRevealed = revealed.has(tile);
    const isMine = bustedMines?.includes(tile) ?? false;

    if (isRevealed) {
      classes.push(isMine ? "mines__tile--mine" : "mines__tile--gem");
    } else if (isMine) {
      classes.push("mines__tile--mine", "mines__tile--peek");
    }

    if (busy) classes.push("mines__tile--busy");
    if (phase === "bust") classes.push("mines__tile--locked");
    return classes.join(" ");
  }

  function tileAria(tile: number): string {
    const isRevealed = revealed.has(tile);
    const isMine = bustedMines?.includes(tile) ?? false;
    if (isRevealed || (!isRevealed && isMine)) {
      return isMine ? `Tile ${tile + 1}, mine` : `Tile ${tile + 1}, gem`;
    }
    return `Tile ${tile + 1}, hidden`;
  }

  const controlsLocked = isPlaying || busy;

  return (
    <div className={`mines lc-game-page mines--${phase}`}>
      <Seo
        title="Mines"
        description="5×5 grid, 1–24 mines. Reveal gems to raise your multiplier — cash out anytime or risk it all. Provably fair, 96.5% RTP."
        path="/mines"
      />

      <header className="lc-page__header">
        <h1 className="lc-page__title">Mines</h1>
        <p className="lc-page__subtitle">
          5×5 grid, 1–24 mines. Reveal gems to raise your multiplier — cash out
          anytime or risk it all. Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="mines__layout">
        <section className="mines__board-panel" aria-label="Mines table">
          <div className="mines__board-chrome">
            <div className="mines__phase-pill" data-phase={phase}>
              {phase === "active" && "In play"}
              {phase === "idle" && "Place a bet"}
              {phase === "won" && "Cashed out"}
              {phase === "bust" && "Busted"}
            </div>
            {isPlaying && (
              <button
                type="button"
                key={randomSpinKey}
                className="mines__tool-btn mines__tool-btn--random"
                onClick={pickRandom}
                disabled={busy}
                aria-label="Pick a random unrevealed tile (shortcut: R)"
              >
                <span aria-hidden="true">🎲</span> Random
              </button>
            )}
          </div>

          <div className="mines__grid" role="grid" aria-label="Mines board 5 by 5">
            {TILES.map((tile) => {
              const isRevealed = revealed.has(tile);
              const isMine = bustedMines?.includes(tile) ?? false;
              const showIcon = isRevealed || isMine;
              return (
                <button
                  key={tile}
                  type="button"
                  role="gridcell"
                  className={tileClass(tile)}
                  disabled={!isPlaying || busy || isRevealed}
                  onClick={() => void handleReveal(tile)}
                  aria-label={tileAria(tile)}
                  aria-pressed={isRevealed || undefined}
                >
                  {showIcon && (
                    <span className="mines__tile-icon" aria-hidden="true">
                      {isMine ? "💣" : "💎"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mines__live-stats" aria-live="polite">
            {isPlaying ? (
              <>
                <span>
                  Multiplier{" "}
                  <strong className="mines__stat-num">{multiplier.toFixed(2)}×</strong>
                </span>
                <span>
                  Cashout{" "}
                  <strong className="mines__stat-num">
                    {formatCoins(potentialPayout, coinType)}
                  </strong>
                </span>
                <span>
                  Gems{" "}
                  <strong className="mines__stat-num">
                    {gemsRevealed}/{maxGems}
                  </strong>
                </span>
              </>
            ) : (
              <span className="mines__idle-hint">
                {phase === "bust"
                  ? "All mines revealed. Bet again when ready."
                  : phase === "won"
                    ? "Round settled. Adjust mines and bet again."
                    : "Pick your mines, set a wager, then flip tiles for gems."}
              </span>
            )}
          </div>
        </section>

        <aside className="mines__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <span className="game-controls__option-label">Mines</span>
              <div className="game-controls__mines-row">
                <input
                  type="range"
                  className="game-controls__mines-slider"
                  min={MINES_MIN_COUNT}
                  max={MINES_MAX_COUNT}
                  value={mineCount}
                  style={sliderStyle}
                  onChange={(e) => setMineCount(Number(e.target.value))}
                  disabled={controlsLocked}
                  aria-label="Number of mines"
                  aria-valuemin={MINES_MIN_COUNT}
                  aria-valuemax={MINES_MAX_COUNT}
                  aria-valuenow={mineCount}
                  aria-valuetext={`${mineCount} mines`}
                />
                <span className="game-controls__mines-value" aria-hidden="true">
                  {mineCount}
                </span>
              </div>
              <p className="game-controls__option-hint">
                {maxGems} gems · next pick {nextMult.toFixed(2)}×
              </p>
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="mines-wager">
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="mines-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : SC_MIN_WAGER);
                }}
                disabled={controlsLocked}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={controlsLocked}
                aria-label="Half bet"
              >
                ½
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => {
                  const bal = getActiveBalance(profile);
                  applyWager(Math.min(wager * 2, bal));
                }}
                disabled={controlsLocked}
                aria-label="Double bet"
              >
                2×
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const bal = getActiveBalance(profile);
                  applyWager(Math.min(SC_MAX_WAGER, bal));
                }}
                disabled={controlsLocked}
                aria-label="Max bet"
              >
                Max
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {lastMessage && (
            <p
              className={`mines__message${
                phase === "won"
                  ? " mines__message--win"
                  : phase === "bust"
                    ? " mines__message--loss"
                    : ""
              }`}
              role="status"
              aria-live="polite"
            >
              {lastMessage}
            </p>
          )}

          {!isPlaying ? (
            <BetButton
              onClick={() => void handleStart()}
              busy={pending === "start"}
              busyLabel="Starting…"
              label="Bet"
            />
          ) : (
            <BetButton
              variant="win"
              onClick={() => void handleCashout(false)}
              busy={busy}
              busyLabel={
                pending === "cashout" ? "Cashing out…" : "Revealing…"
              }
              disabled={gemsRevealed < 1}
              label={`Cash out ${multiplier.toFixed(2)}×`}
            />
          )}

          <NeedFundsHint />

          <details
            className="mines__fairness"
            open={showFairness}
            onToggle={(e) => setShowFairness((e.target as HTMLDetailsElement).open)}
          >
            <summary className="mines__fairness-toggle">Provably fair</summary>
            <div className="mines__fairness-body">
              <p>
                <span className="mines__fairness-k">Server seed (hash)</span>
                <code className="mines__hash">{pfHash ?? "…"}</code>
              </p>
              <p>
                <span className="mines__fairness-k">Next nonce</span>
                <code className="mines__stat-num">{pfNonce}</code>
              </p>
              <label className="mines__seed-label" htmlFor="mines-client-seed">
                Client seed
                <input
                  id="mines-client-seed"
                  type="text"
                  className="mines__seed-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={isPlaying}
                />
              </label>
              <button
                type="button"
                className="mines__tool-btn"
                onClick={() => void saveClientSeed()}
                disabled={isPlaying || busy}
              >
                Save client seed
              </button>
              <p className="mines__fairness-note">
                Mine positions use 24 HMAC floats + Fisher-Yates (Stake Mines).
              </p>
              <p className="mines__fairness-note mines__fairness-note--disclosure">
                RTP disclosure: tile reveals are fair; the 96.5% RTP is baked
                into the multiplier (0.965 × C(25,g) / C(25−m,g), floor 2
                decimals) — no separate bias roll.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
