import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import { getMaxGems, getMinesMultiplier, getNextMultiplier, MINES_MAX_COUNT, MINES_MIN_COUNT } from "../../lib/games/mines";
import type { CSSProperties } from "react";
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
import { getActiveBalance, SC_MAX_WAGER } from "../../lib/gameWallet";
import "../../styles/game-controls.css";
import "./Mines.css";

const TILES = Array.from({ length: 25 }, (_, i) => i);

function randomUnrevealedTile(revealed: Set<number>): number | null {
  const pool = TILES.filter((t) => !revealed.has(t));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function Mines() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [mineCount, setMineCount] = useState(3);
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gameId, setGameId] = useState<string | null>(null);
  /** Coin type locked when the round started (must match server debit). */
  const [gameCoinType, setGameCoinType] = useState<string | null>(null);
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

  // Bumped whenever the user requests a random tile so the dice icon's
  // CSS roll animation restarts on each click (paired with `key=` so
  // React remounts the button and forces the @keyframes to replay).
  const [randomSpinKey, setRandomSpinKey] = useState(0);

  // Ref mirror of `busy` so async handlers can guard against re-entrant
  // clicks without waiting for a state-commit + re-render cycle (which
  // would let a second click slip through in the same tick).
  const busyRef = useRef(false);
  // Ref mirrors of session state. Two reasons:
  //   1. The keyboard-hotkey useEffect registers once with `[]` deps;
  //      reading via refs avoids stale-closure traps.
  //   2. handleStart/handleCashout/handleReveal/pickRandom are recreated
  //      each render but bind to refs internally so the *current* values
  //      are always used — even if JSX onClick captures an old handler.
  // Matches the pattern established in Crash.tsx.
  const playingRef = useRef(false);
  const gameIdRef = useRef<string | null>(null);
  const gameCoinTypeRef = useRef<string | null>(null);
  const revealedRef = useRef<Set<number>>(new Set());
  const wagerRef = useRef(1);
  const mineCountRef = useRef(3);
  const gemsRevealedRef = useRef(0);
  const coinTypeRef = useRef<string>("balance");
  const profileRef = useRef(profile);

  const playing = gameId !== null;
  const maxGems = getMaxGems(mineCount);
  const nextMult = playing ? getNextMultiplier(mineCount, gemsRevealed) : getMinesMultiplier(mineCount, 1);
  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

  // Inline custom-property style helper — keeps the slider attribute
  // block readable above instead of nesting the cast in JSX.
  const sliderStyle = { "--mines-risk": mineCount / MINES_MAX_COUNT } as CSSProperties;

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
    setGameCoinType(data.coinType ?? "balance");
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

  // Sync ref mirrors of session state for the hotkey handler below
  // AND for the handler bodies (handleStart/handleCashout/handleReveal).
  useEffect(() => {
    playingRef.current = gameId !== null;
    gameIdRef.current = gameId;
    gameCoinTypeRef.current = gameCoinType;
    revealedRef.current = revealed;
    wagerRef.current = wager;
    mineCountRef.current = mineCount;
    gemsRevealedRef.current = gemsRevealed;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
  }, [gameId, gameCoinType, revealed, wager, mineCount, gemsRevealed, coinType, profile]);

  // Keyboard hotkeys. Registered once with `[]` deps; routes through
  // the ref-aware handlers (handleStart / handleCashout / pickRandom)
  // so every binding always uses the most recent values, even if the
  // captured closure is from the first render. Focus + modifier guards
  // keep this safe globally (won't hijack Cmd+R; won't fire while
  // typing in the wager/seed inputs).
  //   Space / Enter → start if idle, cash out if playing with ≥1 gem
  //   C             → cash out (only when playing with ≥1 gem)
  //   R             → pick random unrevealed tile (retriggers dice spin)
  //   [ / ]         → half / double wager (idle only)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;

      const k = e.key.toLowerCase();
      const isPlaying = playingRef.current;
      const isBusy = busyRef.current;
      const gems = gemsRevealedRef.current;

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (isPlaying && gems >= 1 && !isBusy) void handleCashout(false);
        else if (!isPlaying && !isBusy) void handleStart();
        return;
      }
      if (k === "c") {
        if (isPlaying && gems >= 1 && !isBusy) {
          e.preventDefault();
          void handleCashout(false);
        }
        return;
      }
      if (k === "r") {
        if (isPlaying && !isBusy) {
          e.preventDefault();
          pickRandom();
        }
        return;
      }
      if (k === "[") {
        if (!isPlaying && !isBusy) {
          e.preventDefault();
          applyWager(wagerRef.current / 2);
        }
        return;
      }
      if (k === "]") {
        if (!isPlaying && !isBusy) {
          e.preventDefault();
          const activeBalance =
            getActiveBalance(profileRef.current);
          applyWager(Math.min(wagerRef.current * 2, activeBalance));
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resetRound = () => {
    setGameId(null);
    setGameCoinType(null);
    setRevealed(new Set());
    setGemsRevealed(0);
    setMultiplier(1);
    setBustedMines(null);
    setLastMessage(null);
    setLastOutcome(null);
  };

  const applyWager = (value: number) => {
    const maxWager = SC_MAX_WAGER;
    const v = Math.max(1, Math.min(maxWager, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const handleStart = async () => {
    if (busyRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    // Read everything from refs — safe to call from any binding context
    // (JSX onClick, hotkey, etc.).
    const wagerNow = wagerRef.current;
    const minesNow = mineCountRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const activeBalance =
      getActiveBalance(profNow);
    if (wagerNow > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastMessage(null);
    setLastOutcome(null);
    busyRef.current = true;
    setBusy(true);
    resetRound();

    const { data, error: startErr } = await startMinesGame({
      wager: wagerNow,
      mineCount: minesNow,
      coinType: coinNow,
    });

    if (startErr || !data) {
      busyRef.current = false;
      setBusy(false);
      setError(startErr ?? "Could not start game.");
      // Server may have debited before failing — refresh to get truth.
      void refreshProfile();
      return;
    }

    setGameId(data.gameId);
    setGameCoinType(data.coinType ?? coinNow);
    setPfNonce(data.nonce + 1);
    busyRef.current = false;
    setBusy(false);
    // No refreshProfile() here — ProfileContext's realtime subscription on
    // `profiles` pushes the new balance (entry debit) the instant the server
    // commits start_mines_game. Calling it would fire 2 redundant RPCs
    // (ensure_user_profile + is_current_user_admin) per bet.
  };

  const handleReveal = async (tile: number) => {
    const gameIdNow = gameIdRef.current;
    if (!gameIdNow || busyRef.current || revealedRef.current.has(tile)) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { data, error: revealErr } = await revealMinesTile({
      gameId: gameIdNow,
      tile,
      mineCount: mineCountRef.current,
      coinType: coinTypeRef.current,
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

    // Read everything from refs — safe from any binding context.
    // `knownGems` still wins when the auto-cashout caller passes it
    // (gemsRevealed state is queued-not-committed at that point).
    const gameIdNow = gameIdRef.current;
    const gameCoinNow = gameCoinTypeRef.current;
    const coinNow = coinTypeRef.current;
    const currentGems = knownGems ?? gemsRevealedRef.current;
    if (!gameIdNow || currentGems < 1) {
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

    // Always cash out in the coin type locked at start — never the live topbar.
    const { data, error: cashErr } = await cashoutMinesGame({
      gameId: gameIdNow,
      coinType: gameCoinNow ?? coinNow,
    });
    busyRef.current = false;
    setBusy(false);

    if (cashErr || !data) {
      setError(cashErr ?? "Cashout failed.");
      void refreshProfile();
      return;
    }

    const cashCoin =
      (gameCoinNow === "sweeps_coins" ? "sweeps_coins" : coinNow) as "balance" | "sweeps_coins";
    setLastMessage(
      auto
        ? `All gems found! Won ${formatCoins(data.payout, cashCoin)}`
        : `Cashed out ${formatCoins(data.payout, cashCoin)} at ${data.multiplier}×`
    );
    setLastOutcome("win");
    resetRound();
    await refreshProfile();
    await loadPf();
  };

  const pickRandom = () => {
    // Use the ref so this stays correct from any binding context (also
    // dedup-safe because handleReveal internally checks revealedRef.current.has(tile)).
    const tile = randomUnrevealedTile(revealedRef.current);
    if (tile !== null) {
      // Bump key so the dice <span> remounts → CSS @keyframes restarts.
      setRandomSpinKey((n) => n + 1);
      void handleReveal(tile);
    }
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
        description="5×5 grid, 1–24 mines. Reveal gems to raise your multiplier — cash out anytime or risk it all. Provably fair, 96.5% RTP."
        path="/mines"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Mines</h1>
        <p className="lc-page__subtitle">
          5×5 grid, 1–24 mines. Reveal gems to raise your multiplier — cash out anytime or risk it all.
          Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="mines__layout">
        <section className="mines__board-panel">
          {playing && (
            <div className="mines__board-toolbar">
              <button
                type="button"
                // key= forces remount → CSS @keyframes "mines-dice-roll"
                // replays every time the user requests another random tile.
                key={randomSpinKey}
                className="mines__tool-btn mines__tool-btn--random"
                onClick={pickRandom}
                disabled={busy}
                aria-label="Pick a random unrevealed tile (shortcut: R)"
              >
                <span aria-hidden="true">🎲</span> Random tile
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
                  // --mines-risk drives the slider thumb color in
                  // Mines.css (emerald → crimson as mines increase).
                  style={sliderStyle}
                  onChange={(e) => setMineCount(Number(e.target.value))}
                  disabled={playing || busy}
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
                  const activeBalance = getActiveBalance(profile);
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
                  const activeBalance = getActiveBalance(profile);
                  const maxWager = SC_MAX_WAGER;
                  applyWager(Math.min(maxWager, activeBalance));
                }}
                disabled={playing || busy}
                aria-label="Max bet"
              >
                Max
              </button>
            </div>

          </div>

          {error && <FormAlert>{error}</FormAlert>}

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
            <BetButton
              onClick={handleStart}
              busy={busy}
              busyLabel="Starting…"
              label="Bet"
            />
          ) : (
            <BetButton
              variant="win"
              onClick={() => handleCashout(false)}
              busy={busy}
              busyLabel="Cashing out…"
              disabled={gemsRevealed < 1}
              label={`Cash out ${multiplier.toFixed(2)}×`}
            />
          )}

          <NeedFundsHint />

          <div className="mines__fairness">
            <button
              type="button"
              className="mines__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
              aria-expanded={showFairness}
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
                <p className="mines__fairness-note mines__fairness-note--disclosure">
                  RTP disclosure: tile reveals are fair; the 96.5% RTP is baked
                  directly into the multiplier formula
                  (0.965 × C(25,g) / C(25-m,g)) — no separate bias roll. The
                  multiplier at each reveal count is verifiable after you
                  rotate your server seed.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
