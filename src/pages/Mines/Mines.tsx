import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import { formatCoins } from "../../lib/format";
import {
  startMinesGame,
  revealMinesTile,
  cashoutMinesGame,
  fetchMinesPfState,
  setMinesClientSeed,
  resumeMinesGame,
} from "../../lib/mines";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import { getMultiplier } from "../../lib/games/mines";
import "../../styles/game-controls.css";
import "./Mines.css";

const GRID = 25;
const MINE_OPTIONS = [1, 3, 5, 10, 15, 20, 24];

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
  const [gameCoinType, setGameCoinType] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [mines, setMines] = useState<Set<number> | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<"win" | "loss" | null>(null);
  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const gameIdRef = useRef<string | null>(null);
  const revealedRef = useRef<Set<number>>(new Set());
  const wagerRef = useRef(1);
  const mineCountRef = useRef(3);
  const coinTypeRef = useRef<string>("sweeps_coins");
  const profileRef = useRef(profile);

  const isPlaying = gameId !== null && mines === null;
  const gems = revealed.size;
  const multiplier = useMemo(
    () => (gems > 0 ? getMultiplier(mineCount, gems) : 1),
    [mineCount, gems]
  );
  const potentialWin = useMemo(
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
    const { data } = await resumeMinesGame();
    if (data?.gameId) {
      setGameId(data.gameId);
      gameIdRef.current = data.gameId;
      setGameCoinType(data.coinType ?? null);
      setRevealed(new Set(data.revealed ?? []));
      revealedRef.current = new Set(data.revealed ?? []);
      if (data.mineCount) setMineCount(data.mineCount);
      if (data.wager) {
        setWager(data.wager);
        setWagerInput(data.wager.toFixed(2));
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadPf();
      resumeGame();
    }
  }, [user, loadPf, resumeGame]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      busyRef.current = false;
    };
  }, []);

  useEffect(() => {
    wagerRef.current = wager;
    mineCountRef.current = mineCount;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
    gameIdRef.current = gameId;
    revealedRef.current = revealed;
  }, [wager, mineCount, coinType, profile, gameId, revealed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;
      const k = e.key.toLowerCase();
      const isBusy = busyRef.current;
      const isPlaying = gameIdRef.current !== null;
      if (k === " " || k === "enter") {
        e.preventDefault();
        if (isPlaying && !isBusy) void handleCashout();
        else if (!isPlaying && !isBusy) void handleStart();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyWager = (value: number) => {
    const maxBet = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(0.01, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const resetRound = () => {
    setGameId(null);
    gameIdRef.current = null;
    setGameCoinType(null);
    setRevealed(new Set());
    revealedRef.current = new Set();
    setMines(null);
  };

  const handleStart = async () => {
    if (busyRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    const wagerNow = wagerRef.current;
    const minesNow = mineCountRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const activeBalance =
      coinNow === "sweeps_coins" ? (profNow?.sweepsCoins ?? 0) : (profNow?.balance ?? 0);
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
      void refreshProfile();
      return;
    }

    setGameId(data.gameId);
    gameIdRef.current = data.gameId;
    setGameCoinType(data.coinType ?? coinNow);
    setPfNonce(data.nonce + 1);
    busyRef.current = false;
    setBusy(false);
  };

  const handleReveal = async (tile: number) => {
    const gameIdNow = gameIdRef.current;
    if (!gameIdNow || busyRef.current || revealedRef.current.has(tile)) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { data, error: revErr } = await revealMinesTile({
      gameId: gameIdNow,
      tile,
    });

    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }

    if (revErr || !data) {
      busyRef.current = false;
      setBusy(false);
      setError(revErr ?? "Reveal failed.");
      return;
    }

    if (data.hitMine) {
      setMines(new Set(data.mines ?? []));
      setRevealed(new Set([...(data.revealed ?? []), tile]));
      revealedRef.current = new Set([...(data.revealed ?? []), tile]);
      setLastOutcome("loss");
      setLastMessage("Mine hit — round over.");
      setGameId(null);
      gameIdRef.current = null;
      setGameCoinType(null);
      busyRef.current = false;
      setBusy(false);
      return;
    }

    const next = new Set(revealedRef.current);
    next.add(tile);
    setRevealed(next);
    revealedRef.current = next;

    if (data.autoCashout) {
      setLastOutcome("win");
      setLastMessage(`Cleared board — won ${formatCoins(data.payout ?? 0, gameCoinType ?? coinType)}`);
      setGameId(null);
      gameIdRef.current = null;
      setGameCoinType(null);
    }

    busyRef.current = false;
    setBusy(false);
  };

  const handleCashout = async (auto = false, knownGems?: number) => {
    const gameIdNow = gameIdRef.current;
    if (!gameIdNow || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    const { data, error: cashErr } = await cashoutMinesGame({ gameId: gameIdNow });

    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }

    if (cashErr || !data) {
      busyRef.current = false;
      setBusy(false);
      setError(cashErr ?? "Cashout failed.");
      return;
    }

    setLastOutcome("win");
    setLastMessage(`Cashed out — won ${formatCoins(data.payout ?? 0, gameCoinType ?? coinType)}`);
    if (data.mines) setMines(new Set(data.mines));
    setGameId(null);
    gameIdRef.current = null;
    setGameCoinType(null);
    busyRef.current = false;
    setBusy(false);
  };

  const tiles = Array.from({ length: GRID }, (_, i) => i);

  return (
    <div className="mines lc-game-page">
      <Seo
        title="Mines"
        description="Pick gems, avoid mines. Cash out any time. Provably fair."
        path="/mines"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Mines</h1>
        <p className="lc-page__subtitle">
          Reveal gems, avoid mines. Cash out whenever you want. Provably fair.
        </p>
      </header>

      <div className="mines__layout">
        <section className="mines__board-panel">
          <div className="mines__grid" role="grid" aria-label="Mines grid">
            {tiles.map((tile) => {
              const isRevealed = revealed.has(tile);
              const isMine = mines?.has(tile);
              const isGem = isRevealed && !isMine;
              return (
                <button
                  key={tile}
                  type="button"
                  className={[
                    "mines__tile",
                    isRevealed && "mines__tile--revealed",
                    isGem && "mines__tile--gem",
                    isMine && "mines__tile--mine",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => void handleReveal(tile)}
                  disabled={!isPlaying || busy || isRevealed}
                  aria-label={isMine ? "Mine" : isGem ? "Gem" : `Tile ${tile + 1}`}
                >
                  {isMine ? "💣" : isGem ? "💎" : ""}
                </button>
              );
            })}
          </div>

          {lastMessage && (
            <div
              className={`mines__outcome${lastOutcome === "win" ? " mines__outcome--win" : lastOutcome === "loss" ? " mines__outcome--loss" : ""}`}
              role="status"
            >
              {lastMessage}
            </div>
          )}
        </section>

        <aside className="mines__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <span className="game-controls__option-label">Mines</span>
              <div className="game-controls__presets">
                {MINE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`game-controls__preset${mineCount === n ? " game-controls__preset--active" : ""}`}
                    onClick={() => setMineCount(n)}
                    disabled={isPlaying || busy}
                  >
                    {n}
                  </button>
                ))}
              </div>
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
                disabled={isPlaying || busy}
              />
              <button type="button" className="game-controls__wager-adj" onClick={() => applyWager(wager / 2)} disabled={isPlaying || busy} aria-label="Half bet">½</button>
              <button type="button" className="game-controls__wager-adj" onClick={() => {
                const bal = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                applyWager(Math.min(wager * 2, bal));
              }} disabled={isPlaying || busy} aria-label="Double bet">2×</button>
            </div>
            {isPlaying && (
              <p className="game-controls__option-hint">
                {gems} gem{gems === 1 ? "" : "s"} · {multiplier.toFixed(2)}× · potential {formatCoins(potentialWin, coinType)}
              </p>
            )}
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {!isPlaying ? (
            <BetButton onClick={handleStart} busy={busy} busyLabel="Starting…" label="Bet" />
          ) : (
            <BetButton onClick={() => void handleCashout()} busy={busy} busyLabel="Cashing out…" label="Cash Out" />
          )}

          <NeedFundsHint />
        </aside>
      </div>
    </div>
  );
}
