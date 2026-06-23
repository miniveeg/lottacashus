import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
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
import "../../styles/game-controls.css";
import "./Mines.css";

const TILES = Array.from({ length: 25 }, (_, i) => i);

function randomUnrevealedTile(revealed: Set<number>): number | null {
  const pool = TILES.filter((t) => !revealed.has(t));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function Mines() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [mineCount, setMineCount] = useState(3);
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gameId, setGameId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [gemsRevealed, setGemsRevealed] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [bustedMines, setBustedMines] = useState<number[] | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<"win" | "loss" | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  // Ref mirror of `busy` so async handlers can guard against re-entrant
  // clicks without waiting for a state-commit + re-render cycle (which
  // would let a second click slip through in the same tick).
  const busyRef = useRef(false);

  const playing = gameId !== null;
  const maxGems = getMaxGems(mineCount);
  const nextMult = playing ? getNextMultiplier(mineCount, gemsRevealed) : getMinesMultiplier(mineCount, 1);
  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

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
    setWager(Number(data.wager));
    setWagerInput(Number(data.wager).toFixed(2));
    setMineCount(data.mineCount);
    setRevealed(new Set(data.revealedTiles));
    setGemsRevealed(data.gemsRevealed);
    setMultiplier(Number(data.multiplier));
    setBustedMines(null);
    setLastMessage(null);
  }, []);

  useEffect(() => {
    if (user) {
      loadPf();
      resumeGame();
    }
  }, [user, loadPf, resumeGame]);

  const resetRound = () => {
    setGameId(null);
    setRevealed(new Set());
    setGemsRevealed(0);
    setMultiplier(1);
    setBustedMines(null);
    setLastMessage(null);
    setLastOutcome(null);
  };

  const applyWager = (value: number) => {
    const v = Math.max(1, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const handleStart = async () => {
    if (busyRef.current) return;
    if (!user) {
      setError("Log in to play.");
      return;
    }
    const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
    if (wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastMessage(null);
    setLastOutcome(null);
    busyRef.current = true;
    setBusy(true);
    resetRound();

    const { data, error: startErr } = await startMinesGame({ wager, mineCount, coinType });

    if (startErr || !data) {
      busyRef.current = false;
      setBusy(false);
      setError(startErr ?? "Could not start game.");
      // Server may have debited before failing — refresh to get truth.
      void refreshProfile();
      return;
    }

    setGameId(data.gameId);
    setPfNonce(data.nonce + 1);
    busyRef.current = false;
    setBusy(false);
    await refreshProfile();
  };

  const handleReveal = async (tile: number) => {
    if (!gameId || busyRef.current || revealed.has(tile)) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { data, error: revealErr } = await revealMinesTile({
      gameId,
      tile,
      mineCount,
      coinType,
    });

    if (revealErr || !data) {
      busyRef.current = false;
      setBusy(false);
      setError(revealErr ?? "Reveal failed.");
      void refreshProfile();
      return;
    }

    setRevealed((prev) => new Set([...prev, tile]));

    if (data.isMine) {
      busyRef.current = false;
      setBusy(false);
      setBustedMines(data.mineTiles ?? []);
      setGameId(null);
      setLastMessage("Mine hit — round lost.");
      setLastOutcome("loss");
      await refreshProfile();
      await loadPf();
      return;
    }

    setGemsRevealed(data.gemsRevealed);
    setMultiplier(data.multiplier);

    if (data.gemsRevealed >= maxGems) {
      // Auto-cashout on the final gem. Pass the freshly-revealed gem count
      // explicitly because the `gemsRevealed` state value is still the
      // pre-reveal value at this point (state update is queued, not
      // committed), so reading it would wrongly abort the cashout —
      // leaving the game stuck in `busy=true` (critical bug fix).
      await handleCashout(true, data.gemsRevealed);
      return;
    }

    busyRef.current = false;
    setBusy(false);
  };

  const handleCashout = async (auto = false, knownGems?: number) => {
    // Manual cashout: prevent double-click races. Auto-cashout is invoked
    // from handleReveal where busy is already true, so we bypass the guard.
    if (!auto && busyRef.current) return;

    // Use the explicitly-passed gem count when available (auto-cashout path);
    // otherwise fall back to the committed state value (manual cashout path).
    const currentGems = knownGems ?? gemsRevealed;
    if (!gameId || currentGems < 1) {
      if (auto) {
        // Defensive: auto-cashout should never hit this branch (caller
        // already verified gemsRevealed >= maxGems >= 1), but if it does,
        // release the busy flag acquired by handleReveal so the game
        // doesn't freeze.
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { data, error: cashErr } = await cashoutMinesGame({ gameId, coinType });
    busyRef.current = false;
    setBusy(false);

    if (cashErr || !data) {
      setError(cashErr ?? "Cashout failed.");
      void refreshProfile();
      return;
    }

    setLastMessage(
      auto
        ? `All gems found! Won ${formatCoins(data.payout, coinType)}`
        : `Cashed out ${formatCoins(data.payout, coinType)} at ${data.multiplier}×`
    );
    setLastOutcome("win");
    resetRound();
    await refreshProfile();
    await loadPf();
  };

  const pickRandom = () => {
    const tile = randomUnrevealedTile(revealed);
    if (tile !== null) void handleReveal(tile);
  };

  const saveClientSeed = async () => {
    const { error: seedErr } = await setMinesClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  function tileClass(tile: number) {
    const classes = ["mines__tile"];
    if (revealed.has(tile)) {
      // Tile was revealed during play. After a loss, `bustedMines` is set
      // and we know which revealed tiles were mines vs gems.
      if (bustedMines?.includes(tile)) classes.push("mines__tile--mine");
      else classes.push("mines__tile--gem");
    } else if (bustedMines?.includes(tile)) {
      // Unrevealed mine shown via post-loss peek.
      classes.push("mines__tile--mine", "mines__tile--peek");
    }
    if (busy) classes.push("mines__tile--busy");
    return classes.join(" ");
  }

  return (
    <div className="mines lc-game-page">
      <Seo
        title="Mines"
        description="5×5 grid, 1–24 mines. Reveal gems to raise your multiplier — cash out anytime or risk it all. Provably fair, 94.5% RTP."
        path="/mines"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Mines</h1>
        <p className="lc-page__subtitle">
          5×5 grid, 1–24 mines. Reveal gems to raise your multiplier — cash out anytime or risk it all.
          Provably fair — 94.5% RTP.
        </p>
      </header>

      <div className="mines__layout">
        <section className="mines__board-panel">
          {playing && (
            <div className="mines__board-toolbar">
              <button
                type="button"
                className="mines__tool-btn"
                onClick={pickRandom}
                disabled={busy}
              >
                Random tile
              </button>
            </div>
          )}

          <div className="mines__grid" role="grid" aria-label="Mines board">
            {TILES.map((tile) => {
              const isRevealed = revealed.has(tile);
              const isBustedMine = bustedMines?.includes(tile) ?? false;
              const isPeekMine = !isRevealed && isBustedMine;
              const tileAriaLabel = isRevealed
                ? isBustedMine
                  ? `Tile ${tile + 1}, mine`
                  : `Tile ${tile + 1}, gem`
                : isPeekMine
                  ? `Tile ${tile + 1}, mine`
                  : `Tile ${tile + 1}`;
              return (
                <button
                  key={tile}
                  type="button"
                  role="gridcell"
                  className={tileClass(tile)}
                  disabled={!playing || busy || isRevealed}
                  onClick={() => handleReveal(tile)}
                  aria-label={tileAriaLabel}
                >
                  {(isRevealed || isPeekMine) && (
                    <span className="mines__tile-icon" aria-hidden="true">
                      {isBustedMine ? "💣" : "💎"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {playing && (
            <div className="mines__live-stats">
              <span>
                Multiplier: <strong>{multiplier.toFixed(2)}×</strong>
              </span>
              <span>
                Cashout: <strong>{formatCoins(potentialPayout, coinType)}</strong>
              </span>
              <span>
                Gems: <strong>{gemsRevealed}</strong> / {maxGems}
              </span>
            </div>
          )}
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
                  onChange={(e) => setMineCount(Number(e.target.value))}
                  disabled={playing || busy}
                  aria-valuemin={MINES_MIN_COUNT}
                  aria-valuemax={MINES_MAX_COUNT}
                  aria-valuenow={mineCount}
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
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
                }}
                disabled={playing || busy}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={playing || busy}
                aria-label="Half bet"
              >
                ½
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(wager * 2, activeBalance));
                }}
                disabled={playing || busy}
                aria-label="Double bet"
              >
                2×
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(100_000, activeBalance));
                }}
                disabled={playing || busy}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>

          </div>

          {error && (
            <p className="mines__error" role="alert">
              {error}
            </p>
          )}

          {lastMessage && (
            <p
              className={`mines__message${lastOutcome === "win" ? " mines__message--win" : lastOutcome === "loss" ? " mines__message--loss" : ""}`}
              role="status"
              aria-live="polite"
            >
              {lastMessage}
            </p>
          )}

          {!playing ? (
            <button
              type="button"
              className="mines__bet-btn"
              onClick={handleStart}
              disabled={busy || !user}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <span className="mines__spinner" aria-hidden="true" />
                  <span>Starting…</span>
                </>
              ) : (
                "Bet"
              )}
            </button>
          ) : (
            <button
              type="button"
              className="mines__cashout-btn"
              onClick={() => handleCashout(false)}
              disabled={busy || gemsRevealed < 1}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <span className="mines__spinner mines__spinner--light" aria-hidden="true" />
                  <span>…</span>
                </>
              ) : (
                `Cash out ${formatCoins(potentialPayout, coinType)}`
              )}
            </button>
          )}

          <p className="mines__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <div className="mines__fairness">
            <button
              type="button"
              className="mines__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="mines__fairness-body">
                <p>
                  <span className="mines__fairness-k">Server seed (hash)</span>
                  <code className="mines__hash">{pfHash ?? "…"}</code>
                </p>
                <p>
                  <span className="mines__fairness-k">Next nonce</span>
                  <code>{pfNonce}</code>
                </p>
                <label className="mines__seed-label">
                  Client seed
                  <input
                    type="text"
                    className="mines__seed-input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={playing}
                  />
                </label>
                <button
                  type="button"
                  className="mines__tool-btn"
                  onClick={saveClientSeed}
                  disabled={playing}
                >
                  Save client seed
                </button>
                <p className="mines__fairness-note">
                  Mine positions use 24 HMAC floats + Fisher-Yates (Stake Mines).
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
