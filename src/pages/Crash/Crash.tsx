import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
import {
  fetchCrashPfState,
  placeCrashBet,
  cashOutCrash,
  setCrashClientSeed,
} from "../../lib/crash";
import { truncateCrashMultiplier } from "../../lib/games/crash";
import "../../styles/game-controls.css";
import "./Crash.css";

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];
const ANIMATION_GROWTH = 1.009;
const HISTORY_MAX = 10;

type CrashPhaseLocal = "idle" | "running" | "crashed" | "cashed_out";
type HistoryEntry = { crashedAt: number };

function historyChipClass(crashedAt: number): string {
  if (crashedAt >= 2) return "crash__history-chip--high";
  if (crashedAt >= 1.4) return "crash__history-chip--mid";
  return "crash__history-chip--low";
}

export function Crash() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef<CrashPhaseLocal>("idle");
  const crashPointRef = useRef(1);

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [phase, setPhase] = useState<CrashPhaseLocal>("idle");
  const [multiplier, setMultiplier] = useState(1);
  const [lastResult, setLastResult] = useState<{
    crashedAt: number;
    won: boolean;
    payout: number;
    cashedAt: number | null;
  } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [betId, setBetId] = useState<string | null>(null);

  const historyRef = useRef<{ x: number; y: number }[]>([{ x: 0, y: 1 }]);

  const activeBalance =
    coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);

  const loadPf = useCallback(async () => {
    const { data } = await fetchCrashPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  useEffect(() => {
    if (user) loadPf();
  }, [user, loadPf]);

  const applyWager = (value: number) => {
    const v = Math.max(0.01, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

  function resolveChartColor(): { line: string; fill: string; crashed: string } {
    if (typeof window === "undefined") {
      return { line: "#f5b942", fill: "rgba(245,185,66,0.08)", crashed: "#ef4444" };
    }
    const styles = getComputedStyle(document.documentElement);
    const line = styles.getPropertyValue("--lc-crimson").trim() || "#f5b942";
    const ruby = styles.getPropertyValue("--lc-ruby").trim() || "#ef4444";
    const fillAlpha = "0.10";
    const fill = line.startsWith("#") && line.length === 7
      ? `rgba(${parseInt(line.slice(1, 3), 16)}, ${parseInt(line.slice(3, 5), 16)}, ${parseInt(line.slice(5, 7), 16)}, ${fillAlpha})`
      : "rgba(245, 185, 66, 0.10)";
    return { line, fill, crashed: ruby };
  }

  function drawGraph(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    pts: { x: number; y: number }[],
    currentMult: number,
    crashed: boolean
  ) {
    ctx.clearRect(0, 0, w, h);

    const pad = Math.max(28, Math.min(48, Math.floor(w * 0.07)));
    const graphW = w - pad * 2;
    const graphH = h - pad * 2;

    const maxY = Math.max(2, Math.ceil(Math.max(currentMult, ...pts.map((p) => p.y))));
    const maxX = pts.length > 1 ? pts[pts.length - 1].x : 1;

    function mapX(x: number) { return pad + (x / Math.max(maxX, 0.001)) * graphW; }
    function mapY(y: number) { return pad + graphH - ((y - 1) / Math.max(maxY - 1, 0.001)) * graphH; }

    const colors = resolveChartColor();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < maxY; i++) {
      const y = mapY(i);
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
    }
    ctx.stroke();

    if (pts.length === 0) return;

    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = mapX(pts[i].x);
      const py = mapY(pts[i].y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineTo(mapX(pts[pts.length - 1].x), pad + graphH);
    ctx.lineTo(mapX(pts[0].x), pad + graphH);
    ctx.closePath();
    ctx.fillStyle = crashed ? "rgba(239, 68, 68, 0.10)" : colors.fill;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = crashed ? colors.crashed : colors.line;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 0; i < pts.length; i++) {
      const px = mapX(pts[i].x);
      const py = mapY(pts[i].y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let i = 1; i < maxY; i++) {
      const y = mapY(i);
      ctx.fillText(`${i}x`, 4, y);
    }
  }

  function startAnimation(crashPt: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx: CanvasRenderingContext2D = ctxRaw;

    const w = canvas.width;
    const h = canvas.height;
    let elapsed = 0;
    let current = 1;
    const pts = historyRef.current;
    pts.length = 0;
    pts.push({ x: 0, y: 1 });
    phaseRef.current = "running";
    crashPointRef.current = crashPt;

    function tick() {
      if (phaseRef.current !== "running") return;

      elapsed += 1 / 60;
      current = Math.pow(ANIMATION_GROWTH, elapsed * 60);
      const truncated = truncateCrashMultiplier(current);

      if (truncated >= crashPt) {
        current = crashPt;
        pts.push({ x: elapsed, y: crashPt });
        drawGraph(ctx, w, h, pts, crashPt, true);
        setMultiplier(crashPt);
        setPhase("crashed");
        phaseRef.current = "idle";
        setLastResult((prev) => ({
          crashedAt: crashPt,
          won: false,
          payout: 0,
          cashedAt: prev?.cashedAt ?? null,
        }));
        setHistory((h2) => [{ crashedAt: crashPt }, ...h2].slice(0, HISTORY_MAX));
        return;
      }

      setMultiplier(truncated);
      pts.push({ x: elapsed, y: truncated });
      drawGraph(ctx, w, h, pts, truncated, false);

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }
  }

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const targetW = Math.floor(cssW * dpr);
    const targetH = Math.floor(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx: CanvasRenderingContext2D = ctxRaw;
    const crashed = phaseRef.current === "idle" && phase === "crashed";
    drawGraph(ctx, canvas.width, canvas.height, historyRef.current, multiplier, crashed);
  }, [multiplier, phase]);

  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    return () => stopAnimation();
  }, []);

  const handleBet = async () => {
    if (!user) {
      setError("Log in to play.");
      return;
    }
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastResult(null);
    setBetId(null);
    setPhase("running");
    phaseRef.current = "running";
    setMultiplier(1);

    const { data, error: betErr } = await placeCrashBet({ wager, coinType });
    if (betErr || !data) {
      setPhase("idle");
      phaseRef.current = "idle";
      setError(betErr ?? "Bet failed.");
      return;
    }

    setBetId(data.betId);
    setPfNonce(data.nonce + 1);
    startAnimation(data.crashPoint);
    await refreshProfile();
  };

  const handleCashOut = async () => {
    if (!betId || phase !== "running") return;

    stopAnimation();
    phaseRef.current = "idle";

    const { data, error: cashErr } = await cashOutCrash({ betId, cashedAtMultiplier: multiplier, coinType });
    if (cashErr || !data) {
      setError(cashErr ?? "Cash out failed. Your bet may still be active.");
      setPhase("running");
      phaseRef.current = "running";
      startAnimation(crashPointRef.current);
      return;
    }

    setPhase("cashed_out");
    const cashedAtMult = data.cashedAt;
    setMultiplier(cashedAtMult);
    setLastResult({
      crashedAt: crashPointRef.current,
      won: true,
      payout: data.payout,
      cashedAt: cashedAtMult,
    });
    setHistory((h) => [{ crashedAt: crashPointRef.current }, ...h].slice(0, HISTORY_MAX));
    await refreshProfile();
  };

  const saveClientSeed = async () => {
    const { error: seedErr } = await setCrashClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  return (
    <div className="game-page crash">
      <header className="game-page__header">
        <div className="game-page__header-text">
          <h1 className="game-page__title">Crash</h1>
          <p className="game-page__subtitle">
            Watch the multiplier rise. Cash out before it crashes.
          </p>
        </div>
        <span className="game-page__rtp">99% RTP</span>
      </header>

      <div className="game-page__layout">
        <section className="game-page__stage crash__stage">
          <div
            className={[
              "crash__canvas-wrap",
              phase === "running" && "crash__canvas-wrap--running",
              phase === "crashed" && "crash__canvas-wrap--crashed",
              phase === "cashed_out" && "crash__canvas-wrap--win",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <canvas
              ref={canvasRef}
              className="crash__canvas"
              aria-label={`Crash multiplier ${multiplier.toFixed(2)}x`}
            />
            <div className="crash__multiplier-overlay" aria-live="polite" aria-atomic="true">
              <span
                className={[
                  "crash__mult-value",
                  phase === "crashed" && "crash__mult-value--crashed",
                  phase === "cashed_out" && "crash__mult-value--win",
                  phase === "running" && "crash__mult-value--running",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {multiplier.toFixed(2)}×
              </span>
              {phase === "idle" && (
                <span className="crash__mult-label">Place a bet to start</span>
              )}
              {phase === "crashed" && (
                <span className="crash__mult-label crash__mult-label--crashed">Crashed</span>
              )}
              {phase === "cashed_out" && (
                <span className="crash__mult-label crash__mult-label--win">
                  Cashed out · won {formatCoins(lastResult?.payout ?? 0, coinType)}
                </span>
              )}
            </div>
          </div>

          {history.length > 0 && (
            <div className="crash__history" aria-label="Recent crash points">
              {history.map((h, i) => (
                <span
                  key={`${h.crashedAt}-${i}`}
                  className={`crash__history-chip ${historyChipClass(h.crashedAt)}`}
                  title={`Crashed at ${h.crashedAt.toFixed(2)}×`}
                >
                  {h.crashedAt.toFixed(2)}×
                </span>
              ))}
            </div>
          )}
        </section>

        <aside className="game-page__controls game-controls">
          <div className="game-page__balance">
            <span className="game-page__balance-label">Balance · {coinLabel}</span>
            <span className="game-page__balance-value">{formatCoins(activeBalance, coinType)}</span>
            <span className="game-page__balance-usd">{formatUsd(coinsToUsd(activeBalance, coinType))}</span>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="crash-wager">
              Bet amount · {coinLabel}
            </label>
            <div className="game-controls__wager-row">
              <input
                id="crash-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : 0.01);
                }}
                disabled={phase === "running"}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={phase === "running"}
                aria-label="Half bet"
              >
                ½
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager * 2)}
                disabled={phase === "running"}
                aria-label="Double bet"
              >
                2×
              </button>
            </div>
            <div className="game-controls__presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`game-controls__preset${wager === p ? " game-controls__preset--active" : ""}`}
                  onClick={() => applyWager(p)}
                  disabled={phase === "running"}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="game-controls__error" role="alert">{error}</p>}

          {phase === "running" ? (
            <button
              type="button"
              className="game-controls__play game-controls__play--cashout"
              onClick={handleCashOut}
            >
              Cash out · {multiplier.toFixed(2)}× · {formatCoins(potentialPayout, coinType)}
            </button>
          ) : (
            <button
              type="button"
              className="game-controls__play"
              onClick={handleBet}
              disabled={!user}
            >
              {phase === "crashed" || phase === "cashed_out" ? "Bet again" : "Play"}
            </button>
          )}

          {lastResult && phase !== "running" && (
            <div className="game-controls__stats">
              <div className="game-controls__stat-row">
                <span className="game-controls__stat-label">Last round</span>
                <span
                  className={`game-controls__stat-value${
                    lastResult.won
                      ? " game-controls__stat-value--win"
                      : " game-controls__stat-value--loss"
                  }`}
                >
                  {lastResult.won
                    ? `Won ${formatCoins(lastResult.payout, coinType)}`
                    : `Lost at ${lastResult.crashedAt.toFixed(2)}×`}
                </span>
              </div>
            </div>
          )}

          <p className="game-page__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <details className="game-page__fairness">
            <summary>Provably Fair</summary>
            <div className="game-page__fairness-body">
              <div className="game-page__fairness-row">
                <span className="game-page__fairness-k">Server seed (hash)</span>
                <code className="game-page__fairness-code">{pfHash ?? "…"}</code>
              </div>
              <div className="game-page__fairness-row">
                <span className="game-page__fairness-k">Next nonce</span>
                <code className="game-page__fairness-code">{pfNonce}</code>
              </div>
              <div className="game-page__fairness-row">
                <span className="game-page__fairness-k">Client seed</span>
                <input
                  type="text"
                  className="game-page__fairness-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={phase === "running"}
                />
              </div>
              <button
                type="button"
                className="game-page__fairness-save"
                onClick={saveClientSeed}
                disabled={phase === "running"}
              >
                Save client seed
              </button>
              <p className="game-page__fairness-note">
                HMAC-SHA256 → 4-byte float → 2²⁴/(n+1)×0.99 — provably fair.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
