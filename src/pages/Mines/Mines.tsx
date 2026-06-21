import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import {
  getMaxGems,
  getMinesMultiplier,
  getNextMultiplier,
} from "../../lib/games/mines";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
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

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];
const TILES = Array.from({ length: 25 }, (_, i) => i);
const MINES_PRESETS = [1, 3, 5, 10, 24];

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
  const [panelOpen, setPanelOpen] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");

  const playing = gameId !== null;
  const maxGems = getMaxGems(mineCount);
  const nextMult = playing ? getNextMultiplier(mineCount, gemsRevealed) : getMinesMultiplier(mineCount, 1);
  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

  const activeBalance =
    coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);

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
    const v = Math.max(0.01, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const handleStart = async () => {
    if (!user) {
      setError("Log in to play.");
      return;
    }
    if (wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastMessage(null);
    setLastOutcome(null);
    setBusy(true);
    resetRound();

    const { data, error: startErr } = await startMinesGame({ wager, mineCount, coinType });
    setBusy(false);

    if (startErr || !data) {
      setError(startErr ?? "Could not start game.");
      return;
    }

    setGameId(data.gameId);
    setPfNonce(data.nonce + 1);
    await refreshProfile();
  };

  const handleReveal = async (tile: number) => {
    if (!gameId || busy || revealed.has(tile)) return;

    setBusy(true);
    setError(null);

    const { data, error: revealErr } = await revealMinesTile({
      gameId,
      tile,
      mineCount,
      coinType,
    });

    if (revealErr || !data) {
      setBusy(false);
      setError(revealErr ?? "Reveal failed.");
      return;
    }

    setRevealed((prev) => new Set([...prev, tile]));

    if (data.isMine) {
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
      await handleCashout(true);
      return;
    }

    setBusy(false);
  };

  const handleCashout = async (auto = false) => {
    if (!gameId || gemsRevealed < 1) return;

    setBusy(true);
    setError(null);

    const { data, error: cashErr } = await cashoutMinesGame({ gameId, coinType });
    setBusy(false);

    if (cashErr || !data) {
      setError(cashErr ?? "Cashout failed.");
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
      if (bustedMines?.includes(tile)) classes.push("mines__tile--mine");
      else classes.push("mines__tile--gem");
    } else if (bustedMines?.includes(tile)) {
      classes.push("mines__tile--mine", "mines__tile--peek");
    }
    if (busy) classes.push("mines__tile--busy");
    return classes.join(" ");
  }

  return (
    <div className="game-page mines">
      <header className="game-header">
        <h1 className="game-header__title">Mines</h1>
        <span className="game-header__rtp">94.5% RTP</span>
        <span className="game-header__spacer" />
        <button
          type="button"
          className={`game-header__panel-toggle${panelOpen ? " game-header__panel-toggle--open" : ""}`}
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Toggle stats panel"
          aria-expanded={panelOpen}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
      </header>

      <div className="game-stage">
        <div className="mines__toolbar">
          <div className="mines__mine-pills" role="group" aria-label="Mine count">
            {MINES_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`mines__pill${mineCount === n ? " mines__pill--active" : ""}`}
                onClick={() => setMineCount(n)}
                disabled={playing || busy}
                aria-pressed={mineCount === n}
              >
                {n}
              </button>
            ))}
          </div>
          {playing && (
            <button
              type="button"
              className="mines__tool-btn"
              onClick={pickRandom}
              disabled={busy}
            >
              Random tile
            </button>
          )}
        </div>

        <div className="mines__grid" role="grid" aria-label="Mines board">
          {TILES.map((tile) => (
            <button
              key={tile}
              type="button"
              role="gridcell"
              className={tileClass(tile)}
              disabled={!playing || busy || revealed.has(tile)}
              onClick={() => handleReveal(tile)}
              aria-label={
                revealed.has(tile)
                  ? bustedMines?.includes(tile)
                    ? "Mine"
                    : "Gem"
                  : `Tile ${tile + 1}`
              }
            >
              {(revealed.has(tile) || bustedMines?.includes(tile)) && (
                <span className="mines__tile-icon" aria-hidden="true">
                  {bustedMines?.includes(tile) ? "💣" : "💎"}
                </span>
              )}
            </button>
          ))}
        </div>

        {playing && (
          <div className="mines__live-stats">
            <div className="mines__live-stat">
              <span className="mines__live-stat-label">Multiplier</span>
              <span className="mines__live-stat-value">{multiplier.toFixed(2)}×</span>
            </div>
            <div className="mines__live-stat">
              <span className="mines__live-stat-label">Gems</span>
              <span className="mines__live-stat-value">{gemsRevealed}/{maxGems}</span>
            </div>
            <div className="mines__live-stat">
              <span className="mines__live-stat-label">Next pick</span>
              <span className="mines__live-stat-value">{nextMult.toFixed(2)}×</span>
            </div>
          </div>
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
      </div>

      {panelOpen && (
        <div className="game-panel" role="complementary" aria-label="Mines stats">
          <div className="game-panel__head">
            <h2 className="game-panel__title">Round info</h2>
            <button
              type="button"
              className="game-panel__close"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {lastOutcome && (
            <div className="game-panel__section">
              <h3 className="game-panel__section-title">Last round</h3>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Outcome</span>
                <span
                  className={`game-panel__row-value${
                    lastOutcome === "win"
                      ? " game-panel__row-value--win"
                      : " game-panel__row-value--loss"
                  }`}
                >
                  {lastOutcome === "win" ? "Cashed out" : "Bust"}
                </span>
              </div>
            </div>
          )}

          <div className="game-panel__section game-panel__section--bare">
            <details className="game-fair">
              <summary className="game-fair__summary">Provably Fair</summary>
              <div className="game-fair__body">
                <div className="game-fair__row">
                  <span className="game-fair__k">Server seed (hash)</span>
                  <code className="game-fair__code">{pfHash ?? "…"}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Next nonce</span>
                  <code className="game-fair__code">{pfNonce}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Client seed</span>
                  <input
                    type="text"
                    className="game-fair__input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={playing}
                  />
                </div>
                <button
                  type="button"
                  className="game-fair__save"
                  onClick={saveClientSeed}
                  disabled={playing}
                >
                  Save client seed
                </button>
                <p className="game-fair__note">
                  Mine positions use 24 HMAC floats + Fisher-Yates (Stake Mines).
                </p>
              </div>
            </details>
          </div>

          <p className="game-actionbar__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>
        </div>
      )}

      <div className="game-actionbar">
        <div className="game-actionbar__balance">
          <span className="game-actionbar__balance-label">{coinLabel}</span>
          <span className="game-actionbar__balance-value">{formatCoins(activeBalance, coinType)}</span>
          <span className="game-actionbar__balance-usd">{formatUsd(coinsToUsd(activeBalance, coinType))}</span>
        </div>

        <div className="game-actionbar__wager">
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager / 2)}
            disabled={playing || busy}
            aria-label="Half bet"
          >
            ½
          </button>
          <input
            id="mines-wager"
            type="text"
            inputMode="decimal"
            className="game-actionbar__input"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            onBlur={() => {
              const parsed = parseFloat(wagerInput.replace(/,/g, ""));
              applyWager(Number.isFinite(parsed) ? parsed : 0.01);
            }}
            disabled={playing || busy}
            aria-label="Bet amount"
          />
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager * 2)}
            disabled={playing || busy}
            aria-label="Double bet"
          >
            2×
          </button>
        </div>

        <div className="game-actionbar__presets">
          {BET_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`game-actionbar__preset${wager === p ? " game-actionbar__preset--active" : ""}`}
              onClick={() => applyWager(p)}
              disabled={playing || busy}
            >
              {p}
            </button>
          ))}
        </div>

        {!playing ? (
          <button
            type="button"
            className="game-actionbar__play"
            onClick={handleStart}
            disabled={busy || !user}
            aria-busy={busy}
          >
            {busy ? "Starting…" : "Play"}
          </button>
        ) : (
          <button
            type="button"
            className="game-actionbar__play game-actionbar__play--cashout"
            onClick={() => handleCashout(false)}
            disabled={busy || gemsRevealed < 1}
            aria-busy={busy}
          >
            {busy ? "…" : `Cash out · ${formatCoins(potentialPayout, coinType)}`}
          </button>
        )}

        {error && <p className="game-actionbar__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
