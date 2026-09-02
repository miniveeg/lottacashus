import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import {
  type RouletteBetType,
  type RouletteColor,
  roulettePotentialWin,
  rouletteWinChance,
} from "../../lib/games/roulette";
import { formatCoins } from "../../lib/format";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import {
  fetchRoulettePfState,
  placeRouletteBet,
  setRouletteClientSeed,
} from "../../lib/roulette";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import { RouletteWheel } from "./RouletteWheel";
import "../../styles/game-controls.css";
import "./Roulette.css";

/** Idle → spinning (await server) → settling (land on pocket) → won | loss. */
type RoulettePhase = "idle" | "spinning" | "settling" | "won" | "loss";

/** Settle CSS transition duration — keep in sync with Roulette.css. */
const SETTLE_MS = 2800;
const HISTORY_MAX = 8;

const BET_OPTIONS: {
  type: RouletteBetType;
  label: string;
  payout: string;
  odds: string;
}[] = [
  { type: "red", label: "Red", payout: "2×", odds: "18/37" },
  { type: "black", label: "Black", payout: "2×", odds: "18/37" },
  { type: "green", label: "Green (0)", payout: "36×", odds: "1/37" },
];

type HistoryEntry = { id: number; pocket: number; color: RouletteColor };

type RoundResult = {
  pocket: number;
  color: RouletteColor;
  won: boolean;
  payout: number;
  betType: RouletteBetType;
};

type SessionRefs = {
  phase: RoulettePhase;
  wager: number;
  betType: RouletteBetType;
  coinType: string;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
  reduceMotion: boolean;
};

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Roulette() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<RoulettePhase>("idle");
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [betType, setBetType] = useState<RouletteBetType>("red");
  const [error, setError] = useState<string | null>(null);

  const [displayPocket, setDisplayPocket] = useState<number | null>(null);
  const [displayColor, setDisplayColor] = useState<RouletteColor | null>(null);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyIdRef = useRef(0);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const cancelledRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const session = useRef<SessionRefs>({
    phase: "idle",
    wager: 1,
    betType: "red",
    coinType: "sweeps_coins",
    profile,
    user,
    isGuest,
    reduceMotion: false,
  });

  const busy = phase === "spinning" || phase === "settling";
  const controlsLocked = busy;

  const winChance = useMemo(() => rouletteWinChance(betType), [betType]);
  const potentialWin = useMemo(
    () => roulettePotentialWin(wager, betType),
    [wager, betType]
  );

  useEffect(() => {
    session.current = {
      phase,
      wager,
      betType,
      coinType,
      profile,
      user,
      isGuest,
      reduceMotion,
    };
  }, [phase, wager, betType, coinType, profile, user, isGuest, reduceMotion]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setReduceMotion(readPrefersReducedMotion());
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const loadPf = useCallback(async () => {
    const { data } = await fetchRoulettePfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadPf();
  }, [user, loadPf]);

  const applyWager = (value: number) => {
    const bal = getActiveBalance(session.current.profile);
    const v = clampWager(value, bal);
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        resolve();
      }, ms);
    });

  const finalizeRound = useCallback(
    async (result: RoundResult, nonce: number) => {
      setLastResult(result);
      setHistory((h) =>
        [
          {
            id: ++historyIdRef.current,
            pocket: result.pocket,
            color: result.color,
          },
          ...h,
        ].slice(0, HISTORY_MAX)
      );
      setPfNonce(nonce + 1);
      setPhase(result.won ? "won" : "loss");
      await refreshProfile();
      await loadPf();
    },
    [loadPf, refreshProfile]
  );

  const handleBet = async () => {
    const s = session.current;
    if (s.phase === "spinning" || s.phase === "settling") return;

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
    setLastResult(null);
    setDisplayPocket(null);
    setDisplayColor(null);
    setPhase("spinning");

    const { data, error: betErr } = await placeRouletteBet({
      wager: s.wager,
      betType: s.betType,
      coinType: s.coinType,
    });

    if (betErr || !data) {
      if (cancelledRef.current) return;
      setPhase("idle");
      setError(betErr ?? "Bet failed.");
      void refreshProfile();
      void loadPf();
      return;
    }

    if (cancelledRef.current) return;

    // Server is source of truth for pocket / color / won / payout.
    const result: RoundResult = {
      pocket: data.resultPocket,
      color: data.resultColor,
      won: data.won,
      payout: data.payout,
      betType: data.betType,
    };

    setDisplayPocket(data.resultPocket);
    setDisplayColor(data.resultColor);

    if (session.current.reduceMotion) {
      await finalizeRound(result, data.nonce);
      return;
    }

    setPhase("settling");
    await wait(SETTLE_MS);
    if (cancelledRef.current) return;
    await finalizeRound(result, data.nonce);
  };

  // Hotkeys via session refs so 0.01 SC half/double/max stay correct.
  // Space/Enter → bet. [ half ] double m max. 1/2/3 colors.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) {
        return;
      }

      const s = session.current;
      const k = e.key.toLowerCase();
      const canEdit = s.phase !== "spinning" && s.phase !== "settling";

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (canEdit) void handleBet();
        return;
      }
      if (k === "[") {
        if (canEdit) {
          e.preventDefault();
          applyWager(s.wager / 2);
        }
        return;
      }
      if (k === "]") {
        if (canEdit) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(s.wager * 2, bal));
        }
        return;
      }
      if (k === "m") {
        if (canEdit) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(SC_MAX_WAGER, bal));
        }
        return;
      }
      if (k === "1") {
        if (canEdit) {
          e.preventDefault();
          setBetType("red");
        }
        return;
      }
      if (k === "2") {
        if (canEdit) {
          e.preventDefault();
          setBetType("black");
        }
        return;
      }
      if (k === "3") {
        if (canEdit) {
          e.preventDefault();
          setBetType("green");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over stable refs; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setRouletteClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  const phaseLabel =
    phase === "spinning"
      ? "Spinning"
      : phase === "settling"
        ? "Settling"
        : phase === "won"
          ? "Win"
          : phase === "loss"
            ? "Loss"
            : "Place a bet";

  const busyLabel =
    phase === "settling"
      ? "Settling…"
      : phase === "spinning"
        ? "Spinning…"
        : "Spinning…";

  return (
    <div className={`roulette lc-game-page roulette--${phase}`}>
      <Seo
        title="Roulette"
        description="European wheel — bet red, black, or green (zero). Provably fair, 96.5% RTP."
        path="/roulette"
      />

      <header className="lc-page__header">
        <h1 className="lc-page__title">Roulette</h1>
        <p className="lc-page__subtitle">
          European wheel — bet red, black, or zero. Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="roulette__layout">
        <section className="roulette__board-panel" aria-label="Roulette table">
          <div className="roulette__board-chrome">
            <div className="roulette__phase-pill" data-phase={phase}>
              {phaseLabel}
            </div>
            <span className="roulette__layout-tag">European · 0–36</span>
            {history.length > 0 && (
              <div className="roulette__history" aria-label="Recent results">
                {history.map((h) => (
                  <span
                    key={h.id}
                    className={`roulette__history-chip roulette__history-chip--${h.color}`}
                    title={`${h.color} ${h.pocket}`}
                  >
                    {h.pocket}
                  </span>
                ))}
              </div>
            )}
          </div>

          {phase === "idle" && !lastResult && (
            <p className="roulette__press-hint" role="note">
              Press <kbd>Space</kbd> or tap <strong>Bet</strong> ·{" "}
              <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> color
            </p>
          )}

          <div
            className={[
              "roulette__felt-stage",
              phase === "spinning" && "roulette__felt-stage--spinning",
              phase === "settling" && "roulette__felt-stage--settling",
              phase === "won" && "roulette__felt-stage--win",
              phase === "loss" && "roulette__felt-stage--loss",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <RouletteWheel
              phase={phase}
              resultPocket={displayPocket}
              resultColor={displayColor}
              reduceMotion={reduceMotion}
            />
          </div>

          <div className="roulette__paytable-wrap">
            <p className="roulette__paytable-title">Payouts</p>
            <div className="roulette__paytable" role="list" aria-label="Roulette payouts">
              <div className="roulette__paytable-cell roulette__paytable-cell--pays" role="listitem">
                <span className="roulette__paytable-hits">Red</span>
                <span className="roulette__paytable-mult">2×</span>
              </div>
              <div className="roulette__paytable-cell roulette__paytable-cell--pays" role="listitem">
                <span className="roulette__paytable-hits">Black</span>
                <span className="roulette__paytable-mult">2×</span>
              </div>
              <div className="roulette__paytable-cell roulette__paytable-cell--pays" role="listitem">
                <span className="roulette__paytable-hits">0</span>
                <span className="roulette__paytable-mult">36×</span>
              </div>
            </div>
          </div>

          <div className="roulette__live-stats" aria-live="polite">
            {lastResult && phase !== "spinning" && phase !== "settling" ? (
              <p
                className={`roulette__message${
                  phase === "won"
                    ? " roulette__message--win"
                    : phase === "loss"
                      ? " roulette__message--loss"
                      : ""
                }`}
                role="status"
              >
                Landed <strong>{lastResult.pocket}</strong> ({lastResult.color}
                ) —{" "}
                {lastResult.won ? (
                  <>
                    won{" "}
                    <strong>
                      {formatCoins(lastResult.payout, coinType)}
                    </strong>
                  </>
                ) : (
                  <>no payout this round</>
                )}
              </p>
            ) : (
              <span className="roulette__idle-hint">
                {phase === "spinning"
                  ? "Awaiting server result…"
                  : phase === "settling"
                    ? reduceMotion
                      ? "Settling round…"
                      : "Ball landing…"
                    : "Pick a color, set a wager, then bet."}
              </span>
            )}
          </div>
        </section>

        <aside className="roulette__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <span
                className="game-controls__option-label"
                id="roulette-bet-label"
              >
                Bet on
              </span>
              <div
                className="roulette__bet-grid"
                role="group"
                aria-labelledby="roulette-bet-label"
              >
                {BET_OPTIONS.map((opt) => {
                  const isSelected = betType === opt.type;
                  const isWinner =
                    !!lastResult?.won &&
                    lastResult.betType === opt.type &&
                    (phase === "won" || phase === "loss");
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      className={[
                        "roulette__bet-cell",
                        `roulette__bet-cell--${opt.type}`,
                        isSelected && "roulette__bet-cell--selected",
                        isWinner && "roulette__bet-cell--win",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setBetType(opt.type)}
                      disabled={controlsLocked}
                      aria-pressed={isSelected}
                    >
                      <span className="roulette__bet-cell-label">
                        {opt.label}
                      </span>
                      <span className="roulette__bet-cell-meta">
                        {opt.payout} · {opt.odds}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="game-controls__option-hint">
                Win chance {(winChance * 100).toFixed(2)}% · Payout{" "}
                {formatCoins(potentialWin, coinType)}
              </p>
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label
              className="game-controls__wager-label"
              htmlFor="roulette-wager"
            >
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="roulette-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(
                    Number.isFinite(parsed) ? parsed : SC_MIN_WAGER
                  );
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

          <div className="roulette__sr-status" role="status" aria-live="polite">
            {busy
              ? phase === "settling" && displayPocket !== null
                ? `Settling on ${displayPocket}.`
                : "Spinning."
              : lastResult
                ? `Round complete: ${lastResult.pocket} ${lastResult.color}, ${
                    lastResult.won ? "win" : "loss"
                  }.`
                : ""}
          </div>

          <BetButton
            onClick={() => void handleBet()}
            busy={busy}
            busyLabel={busyLabel}
            label="Bet"
          />

          {!busy && (
            <p className="roulette__hotkey-hint" role="note">
              <kbd>Space</kbd> bet · <kbd>[</kbd>/<kbd>]</kbd>/<kbd>M</kbd>{" "}
              wager · <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> color
            </p>
          )}

          <NeedFundsHint />

          <details
            className="roulette__fairness"
            open={showFairness}
            onToggle={(e) =>
              setShowFairness((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="roulette__fairness-toggle">
              Provably fair
            </summary>
            <div className="roulette__fairness-body">
              <p>
                <span className="roulette__fairness-k">Server seed (hash)</span>
                <code className="roulette__hash">{pfHash ?? "…"}</code>
              </p>
              <p>
                <span className="roulette__fairness-k">Next nonce</span>
                <code className="roulette__stat-num">{pfNonce}</code>
              </p>
              <label
                className="roulette__seed-label"
                htmlFor="roulette-client-seed"
              >
                Client seed
                <input
                  id="roulette-client-seed"
                  type="text"
                  className="roulette__seed-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="roulette__tool-btn"
                onClick={() => void saveClientSeed()}
                disabled={busy}
              >
                Save client seed
              </button>
              <p className="roulette__fairness-note">
                HMAC-SHA256 → pocket = floor(float × 37). European layout.
              </p>
              <p className="roulette__fairness-note roulette__fairness-note--disclosure">
                RTP disclosure: the wheel is fair (1/37 per pocket); the
                displayed 96.5% RTP is enforced by a deterministic bias roll
                (same seeds) that downgrades ~2.5% of would-be wins.
                Settlement is always server-side; the client never invents
                pocket, won, or payout.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
