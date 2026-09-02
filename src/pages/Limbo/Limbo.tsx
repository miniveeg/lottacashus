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
  LIMBO_MAX_TARGET,
  LIMBO_MIN_TARGET,
  limboWinChance,
} from "../../lib/games/limbo";
import { formatCoins } from "../../lib/format";
import {
  fetchLimboPfState,
  placeLimboBet,
  setLimboClientSeed,
} from "../../lib/limbo";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import "../../styles/game-controls.css";
import "./Limbo.css";

/** Idle → rolling (awaiting server) → won | loss → idle on next bet. */
type LimboPhase = "idle" | "rolling" | "won" | "loss";

const TARGET_PRESETS = [1.5, 2, 3, 5, 10, 25, 50, 100];
const REVEAL_DELAY_MS = 900;
const HISTORY_MAX = 8;
const SLIDER_MIN = LIMBO_MIN_TARGET;
const SLIDER_MAX = 10_000;

type HistoryEntry = { id: number; result: number; won: boolean };

type SessionRefs = {
  phase: LimboPhase;
  wager: number;
  target: number;
  coinType: string;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
};

function formatMultiplier(n: number): string {
  if (n >= 1000) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return n.toFixed(2);
}

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return LIMBO_MIN_TARGET;
  const truncated = Math.trunc(value * 100) / 100;
  return Math.min(LIMBO_MAX_TARGET, Math.max(LIMBO_MIN_TARGET, truncated));
}

function targetToPct(t: number): number {
  return Math.log(t / SLIDER_MIN) / Math.log(SLIDER_MAX / SLIDER_MIN);
}

function pctToTarget(pct: number): number {
  const raw = SLIDER_MIN * Math.pow(SLIDER_MAX / SLIDER_MIN, pct);
  return clampTarget(raw);
}

export function Limbo() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<LimboPhase>("idle");
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [target, setTarget] = useState(2);
  const [targetInput, setTargetInput] = useState("2.00");
  const [error, setError] = useState<string | null>(null);

  const [displayMult, setDisplayMult] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<{
    result: number;
    won: boolean;
    payout: number;
  } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyIdRef = useRef(0);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  const cancelledRef = useRef(false);
  const session = useRef<SessionRefs>({
    phase: "idle",
    wager: 1,
    target: 2,
    coinType: "sweeps_coins",
    profile,
    user,
    isGuest,
  });

  const busy = phase === "rolling";
  const controlsLocked = busy;

  const winChance = useMemo(() => limboWinChance(target), [target]);
  const potentialWin = useMemo(
    () => Math.round(wager * target * 100) / 100,
    [wager, target]
  );
  const sliderPct = Math.min(1, Math.max(0, targetToPct(target)));
  const sliderStyle = {
    "--limbo-risk": sliderPct,
  } as CSSProperties;

  useEffect(() => {
    session.current = {
      phase,
      wager,
      target,
      coinType,
      profile,
      user,
      isGuest,
    };
  }, [phase, wager, target, coinType, profile, user, isGuest]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const loadPf = useCallback(async () => {
    const { data } = await fetchLimboPfState();
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

  const applyTarget = (value: number) => {
    const v = clampTarget(value);
    setTarget(v);
    setTargetInput(v.toFixed(2));
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const handleBet = async () => {
    const s = session.current;
    if (s.phase === "rolling") return;

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
    setDisplayMult(null);
    setPhase("rolling");

    const startedAt = Date.now();
    const { data, error: betErr } = await placeLimboBet({
      wager: s.wager,
      target: s.target,
      coinType: s.coinType,
    });

    if (betErr || !data) {
      if (cancelledRef.current) return;
      setPhase("idle");
      setError(betErr ?? "Bet failed.");
      void refreshProfile();
      return;
    }

    const remaining = Math.max(0, REVEAL_DELAY_MS - (Date.now() - startedAt));
    await wait(remaining);

    if (cancelledRef.current) return;

    // Server is source of truth for result / won / payout.
    setDisplayMult(data.resultMultiplier);
    setLastResult({
      result: data.resultMultiplier,
      won: data.won,
      payout: data.payout,
    });
    setHistory((h) =>
      [
        {
          id: ++historyIdRef.current,
          result: data.resultMultiplier,
          won: data.won,
        },
        ...h,
      ].slice(0, HISTORY_MAX)
    );
    setPfNonce(data.nonce + 1);
    setPhase(data.won ? "won" : "loss");

    await refreshProfile();
    await loadPf();
  };

  // Hotkeys via session refs so 0.01 SC half/double/max stay correct.
  // Space/Enter → bet. [ half ] double m max — only when not rolling.
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
      const canAct = s.phase !== "rolling";

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (canAct) void handleBet();
        return;
      }
      if (k === "[") {
        if (canAct) {
          e.preventDefault();
          applyWager(s.wager / 2);
        }
        return;
      }
      if (k === "]") {
        if (canAct) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(s.wager * 2, bal));
        }
        return;
      }
      if (k === "m") {
        if (canAct) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(SC_MAX_WAGER, bal));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over stable refs; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setLimboClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  const phaseLabel =
    phase === "rolling"
      ? "Rolling"
      : phase === "won"
        ? "Win"
        : phase === "loss"
          ? "Loss"
          : "Place a bet";

  return (
    <div className={`limbo lc-game-page limbo--${phase}`}>
      <Seo
        title="Limbo"
        description="Name your target multiplier. If the roll beats it, you win. Provably fair, 96.5% RTP."
        path="/limbo"
      />

      <header className="lc-page__header">
        <h1 className="lc-page__title">Limbo</h1>
        <p className="lc-page__subtitle">
          Set a target multiplier. If the round result is equal or higher, you
          win bet × target. Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="limbo__layout">
        <section className="limbo__stage-panel" aria-label="Limbo table">
          <div className="limbo__board-chrome">
            <div className="limbo__phase-pill" data-phase={phase}>
              {phaseLabel}
            </div>
            {history.length > 0 && (
              <div className="limbo__history" aria-label="Recent results">
                {history.map((h) => (
                  <span
                    key={h.id}
                    className={`limbo__history-chip${
                      h.won
                        ? " limbo__history-chip--win"
                        : " limbo__history-chip--loss"
                    }`}
                    title={`${formatMultiplier(h.result)}× — ${
                      h.won ? "win" : "loss"
                    }`}
                  >
                    {formatMultiplier(h.result)}×
                  </span>
                ))}
              </div>
            )}
          </div>

          {phase === "idle" && !lastResult && (
            <p className="limbo__press-to-spin" role="note">
              Press <kbd>Space</kbd> or tap <strong>Bet</strong> to play
            </p>
          )}

          <div
            className={[
              "limbo__rocket-stage",
              phase === "rolling" && "limbo__rocket-stage--rolling",
              phase === "won" && "limbo__rocket-stage--win",
              phase === "loss" && "limbo__rocket-stage--loss",
              phase === "idle" && !lastResult && "limbo__rocket-stage--idle",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          >
            {(phase === "won" || phase === "loss") && (
              <span
                className={`limbo__ripple limbo__ripple--${
                  phase === "won" ? "win" : "loss"
                }`}
              />
            )}
            <svg
              className="limbo__rocket-svg"
              viewBox="0 0 320 160"
              xmlns="http://www.w3.org/2000/svg"
            >
              <line
                x1="0"
                y1="140"
                x2="320"
                y2="140"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
              <line
                x1="0"
                y1="100"
                x2="320"
                y2="100"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
              <line
                x1="0"
                y1="60"
                x2="320"
                y2="60"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
              />
              <g className="limbo__target-bar">
                <line
                  className="limbo__target-line"
                  x1="20"
                  y1="90"
                  x2="300"
                  y2="90"
                  strokeWidth="2"
                  strokeDasharray="8 4"
                />
                <text
                  className="limbo__target-label"
                  x="298"
                  y="94"
                  textAnchor="end"
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {target.toFixed(2)}×
                </text>
              </g>
              <g
                className={[
                  "limbo__rocket",
                  phase === "rolling" && "limbo__rocket--flying",
                  phase === "won" && "limbo__rocket--win",
                  phase === "loss" && "limbo__rocket--loss",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <ellipse
                  cx="160"
                  cy="138"
                  rx="7"
                  ry="12"
                  fill="rgba(251,146,60,0.85)"
                  className="limbo__flame"
                />
                <ellipse
                  cx="160"
                  cy="136"
                  rx="4"
                  ry="7"
                  fill="rgba(253,224,71,0.9)"
                  className="limbo__flame-inner"
                />
                <ellipse
                  cx="160"
                  cy="112"
                  rx="12"
                  ry="20"
                  fill="rgba(255,255,255,0.9)"
                />
                <ellipse
                  cx="160"
                  cy="95"
                  rx="8"
                  ry="10"
                  fill="rgba(200,210,255,0.95)"
                />
                <circle
                  cx="160"
                  cy="108"
                  r="5"
                  fill="rgba(100,160,255,0.8)"
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth="1"
                />
                <polygon
                  points="148,128 140,142 148,135"
                  fill="rgba(220,220,240,0.8)"
                />
                <polygon
                  points="172,128 180,142 172,135"
                  fill="rgba(220,220,240,0.8)"
                />
              </g>
            </svg>
          </div>

          <div
            className={[
              "limbo__display",
              phase === "rolling" && "limbo__display--rolling",
              phase === "won" && "limbo__display--win",
              phase === "loss" && "limbo__display--loss",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-live="polite"
          >
            <span className="limbo__display-label">Result</span>
            <span
              className={[
                "limbo__display-value",
                displayMult != null && "limbo__display-value--pop",
                displayMult == null && "limbo__display-value--waiting",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {displayMult != null
                ? `${formatMultiplier(displayMult)}×`
                : "···"}
            </span>
            <span className="limbo__display-target">
              Target {formatMultiplier(target)}×
            </span>
          </div>

          <div className="limbo__live-stats" aria-live="polite">
            {lastResult && phase !== "rolling" ? (
              <p
                className={`limbo__message${
                  phase === "won"
                    ? " limbo__message--win"
                    : phase === "loss"
                      ? " limbo__message--loss"
                      : ""
                }`}
                role="status"
              >
                {lastResult.won ? (
                  <>
                    Hit <strong>{formatMultiplier(lastResult.result)}×</strong>{" "}
                    — won{" "}
                    <strong>
                      {formatCoins(lastResult.payout, coinType)}
                    </strong>
                  </>
                ) : (
                  <>
                    Landed{" "}
                    <strong>{formatMultiplier(lastResult.result)}×</strong> —
                    below target
                  </>
                )}
              </p>
            ) : (
              <span className="limbo__idle-hint">
                {phase === "rolling"
                  ? "Waiting on the server roll…"
                  : "Pick a target, set a wager, then launch."}
              </span>
            )}
          </div>
        </section>

        <aside className="limbo__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <label
                className="game-controls__option-label"
                htmlFor="limbo-target"
              >
                Target multiplier
              </label>
              <input
                id="limbo-target"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(targetInput.replace(/,/g, ""));
                  applyTarget(
                    Number.isFinite(parsed) ? parsed : LIMBO_MIN_TARGET
                  );
                }}
                disabled={controlsLocked}
              />
              <input
                type="range"
                className="game-controls__mines-slider limbo__target-slider"
                min={0}
                max={1}
                step={0.001}
                value={sliderPct}
                style={sliderStyle}
                onChange={(e) =>
                  applyTarget(pctToTarget(Number(e.target.value)))
                }
                disabled={controlsLocked}
                aria-label="Target multiplier slider"
                aria-valuemin={LIMBO_MIN_TARGET}
                aria-valuemax={LIMBO_MAX_TARGET}
                aria-valuenow={target}
                aria-valuetext={`${formatMultiplier(target)}×`}
              />
              <div className="game-controls__presets limbo__target-presets">
                {TARGET_PRESETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`game-controls__preset${
                      target === t ? " game-controls__preset--active" : ""
                    }`}
                    onClick={() => applyTarget(t)}
                    disabled={controlsLocked}
                  >
                    {t}×
                  </button>
                ))}
              </div>
              <div
                className="limbo__paytable-pill"
                aria-label="Win chance and potential payout"
              >
                <span className="limbo__paytable-pill-cell">
                  <span className="limbo__paytable-pill-k">Win chance</span>
                  <strong className="limbo__paytable-pill-v">
                    {(winChance * 100).toFixed(2)}%
                  </strong>
                </span>
                <span
                  className="limbo__paytable-pill-divider"
                  aria-hidden="true"
                />
                <span className="limbo__paytable-pill-cell">
                  <span className="limbo__paytable-pill-k">Payout</span>
                  <strong className="limbo__paytable-pill-v">
                    {formatCoins(potentialWin, coinType)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="limbo-wager">
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="limbo-wager"
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

          <BetButton
            onClick={() => void handleBet()}
            busy={busy}
            busyLabel="Rolling…"
            label="Bet"
          />

          <NeedFundsHint />

          <details
            className="limbo__fairness"
            open={showFairness}
            onToggle={(e) =>
              setShowFairness((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="limbo__fairness-toggle">Provably fair</summary>
            <div className="limbo__fairness-body">
              <p>
                <span className="limbo__fairness-k">Server seed (hash)</span>
                <code className="limbo__hash">{pfHash ?? "…"}</code>
              </p>
              <p>
                <span className="limbo__fairness-k">Next nonce</span>
                <code className="limbo__stat-num">{pfNonce}</code>
              </p>
              <label className="limbo__seed-label" htmlFor="limbo-client-seed">
                Client seed
                <input
                  id="limbo-client-seed"
                  type="text"
                  className="limbo__seed-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="limbo__tool-btn"
                onClick={() => void saveClientSeed()}
                disabled={busy}
              >
                Save client seed
              </button>
              <p className="limbo__fairness-note">
                HMAC-SHA256 float → result multiplier (Stake Limbo shape). Win
                odds are capped to 96.5% RTP — payout stays bet × target.
              </p>
              <p className="limbo__fairness-note limbo__fairness-note--disclosure">
                Display win chance uses 0.965 / target. Settlement is always
                server-side; the client never invents won or payout.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
