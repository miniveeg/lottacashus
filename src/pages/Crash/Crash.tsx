import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { formatCoins } from "../../lib/format";
import {
  fetchCrashPfState,
  placeCrashBet,
  cashOutCrash,
  setCrashClientSeed,
} from "../../lib/crash";
import { truncateCrashMultiplier } from "../../lib/games/crash";
import "../../styles/game-controls.css";
import "./Crash.css";

// Animation rate — multiplier grows ~9%/frame at 60fps (exponential, crash-like).
const ANIMATION_GROWTH = 1.009;
const CANVAS_BASE_WIDTH = 600;
const CANVAS_BASE_HEIGHT = 320;

export function Crash() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef<CrashPhaseLocal>("idle");
  const crashPointRef = useRef(1);
  // busyRef guards handleBet against double-clicks (Bet button disappears
  // immediately on phase=running, but a sub-ms race window exists between the
  // click and the re-render). cashingOutRef + cashingOut state guard
  // handleCashOut and disable the Cash Out button during the server round-trip.
  const busyRef = useRef(false);
  const cashingOutRef = useRef(false);
  // multiplierRef mirrors `multiplier` state synchronously inside tick() so
  // handleCashOut reads the latest drawn frame (not one render behind).
  // displayPhaseRef mirrors `phase` so the stable resizeCanvas callback can
  // read the current display phase without re-creating every frame.
  const multiplierRef = useRef(1);
  const displayPhaseRef = useRef<CrashPhaseLocal>("idle");
  const cancelledRef = useRef(false);

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
  const [error, setError] = useState<string | null>(null);
  const [cashingOut, setCashingOut] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [betId, setBetId] = useState<string | null>(null);

  const historyRef = useRef<{ x: number; y: number }[]>([{ x: 0, y: 1 }]);

  type CrashPhaseLocal = "idle" | "running" | "crashed" | "cashed_out";

  // Keep display-phase/multiplier refs in sync with state on every render so
  // stable callbacks (resizeCanvas) read current values without being
  // re-created each frame (which previously caused ResizeObserver disconnect/
  // reconnect churn at 60fps).
  multiplierRef.current = multiplier;
  displayPhaseRef.current = phase;

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
    const v = Math.max(1, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

  // Max-payout cap (audit R6): server enforces 100,000. The crash point is
  // unknown at bet time, but if the wager alone exceeds the cap (wager >
  // 100,000 / 1.01 ≈ 99,010), even a minimum (1.01×) cashout would exceed
  // it. We also warn the player about the cap so they understand the
  // server-side limit.
  const CRASH_MAX_PAYOUT = 100_000;
  const exceedsMaxPayout = wager > CRASH_MAX_PAYOUT / 1.01;

  /** Resolve theme color for the chart line so it stays consistent with the site palette. */
  function resolveChartColor(): { line: string; fill: string; crashed: string } {
    if (typeof window === "undefined") {
      return { line: "#22c55e", fill: "rgba(34,197,94,0.08)", crashed: "#ef4444" };
    }
    const styles = getComputedStyle(document.documentElement);
    const line = styles.getPropertyValue("--lc-emerald").trim() || "#22c55e";
    const ruby = styles.getPropertyValue("--lc-ruby").trim() || "#ef4444";
    // Convert hex to rgba with low alpha for the area fill.
    const fillAlpha = "0.10";
    const fill = line.startsWith("#") && line.length === 7
      ? `rgba(${parseInt(line.slice(1, 3), 16)}, ${parseInt(line.slice(3, 5), 16)}, ${parseInt(line.slice(5, 7), 16)}, ${fillAlpha})`
      : "rgba(34, 197, 94, 0.10)";
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

    // Horizontal grid lines + labels
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

    // Area fill under the line
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

    // Chart line
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

    // Y-axis labels
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
    // Capture the non-null context so closures don't re-widen the type.
    const ctx: CanvasRenderingContext2D = ctxRaw;

    const w = canvas.width;
    const h = canvas.height;
    const pts = historyRef.current;
    pts.length = 0;
    pts.push({ x: 0, y: 1 });
    phaseRef.current = "running";
    crashPointRef.current = crashPt;

    // Use wall-clock time so the growth rate is independent of the display's
    // refresh rate. The original `elapsed += 1/60` per tick made the animation
    // run half-speed on 30Hz displays and 2x speed on 120Hz displays.
    const startTime = performance.now();

    function tick() {
      if (cancelledRef.current) return;
      if (phaseRef.current !== "running") return;

      const elapsed = (performance.now() - startTime) / 1000;
      // Exponential growth — feels like a real crash multiplier.
      const current = Math.pow(ANIMATION_GROWTH, elapsed * 60);
      const truncated = truncateCrashMultiplier(current);

      if (truncated >= crashPt) {
        pts.push({ x: elapsed, y: crashPt });
        drawGraph(ctx, w, h, pts, crashPt, true);
        multiplierRef.current = crashPt;
        setMultiplier(crashPt);
        phaseRef.current = "idle";
        displayPhaseRef.current = "crashed";
        setPhase("crashed");
        setLastResult((prev) => ({
          crashedAt: crashPt,
          won: false,
          payout: 0,
          cashedAt: prev?.cashedAt ?? null,
        }));
        return;
      }

      multiplierRef.current = truncated;
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

  // Responsive canvas: scale the backing store to match the displayed size × DPR
  // for crisp chart rendering on retina/mobile displays. Stable (empty deps) —
  // reads current multiplier/phase from refs so it doesn't re-create every
  // animation frame (which previously caused ResizeObserver churn at 60fps).
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
    // Redraw the current history at the new resolution.
    const crashed = displayPhaseRef.current === "crashed";
    drawGraph(ctx, canvas.width, canvas.height, historyRef.current, multiplierRef.current, crashed);
  }, []);

  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [resizeCanvas]);

  // Unmount cleanup: cancel the rAF, mark cancelled so in-flight bet/cashout
  // awaits don't fire setState on a dead component, and release busy flags.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      phaseRef.current = "idle";
      busyRef.current = false;
      cashingOutRef.current = false;
      stopAnimation();
    };
  }, []);

  const handleBet = async () => {
    // Synchronous re-entrancy guard — Bet button disappears on phase=running,
    // but a sub-ms race window exists between the click and the re-render.
    if (busyRef.current) return;
    if (!user) {
      setError("Log in to play.");
      return;
    }
    const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    busyRef.current = true;
    setError(null);
    setLastResult(null);
    setBetId(null);
    setPhase("running");
    phaseRef.current = "running";
    displayPhaseRef.current = "running";
    setMultiplier(1);
    multiplierRef.current = 1;

    const { data, error: betErr } = await placeCrashBet({ wager, coinType });
    if (betErr || !data) {
      if (cancelledRef.current) return;
      setPhase("idle");
      phaseRef.current = "idle";
      displayPhaseRef.current = "idle";
      setError(betErr ?? "Bet failed.");
      // Server may have debited before failing — refresh to stay accurate.
      void refreshProfile();
      busyRef.current = false;
      return;
    }

    setBetId(data.betId);
    setPfNonce(data.nonce + 1);
    busyRef.current = false;
    startAnimation(data.crashPoint);
    void refreshProfile();
  };

  const handleCashOut = async () => {
    // Double-cashout race: rapid clicks could trigger two cashOutCrash calls
    // before the first settled. busyRef + cashingOutRef guard both paths.
    if (busyRef.current || cashingOutRef.current) return;
    if (!betId || phaseRef.current !== "running") return;

    cashingOutRef.current = true;
    setCashingOut(true);
    stopAnimation();
    phaseRef.current = "idle";

    // Capture the multiplier from the ref (synchronously updated in tick) so
    // the cashout value matches the latest drawn frame, not the stale state
    // (which lags one render behind the canvas paint).
    const multAtClick = multiplierRef.current;
    const { data, error: cashErr } = await cashOutCrash({
      betId,
      cashedAtMultiplier: multAtClick,
      coinType,
    });

    if (cashErr || !data) {
      if (cancelledRef.current) return;
      cashingOutRef.current = false;
      setCashingOut(false);
      // The most common failure is that the bet already crashed server-side
      // before the cashout was processed. Transition to the crashed state
      // rather than restarting the animation from 1× (which was jarring and
      // misleading — the chart would visibly climb again from the start). If
      // the cashout actually succeeded despite the network error,
      // refreshProfile() will reflect the updated balance.
      phaseRef.current = "idle";
      displayPhaseRef.current = "crashed";
      setPhase("crashed");
      multiplierRef.current = crashPointRef.current;
      setMultiplier(crashPointRef.current);
      setLastResult((prev) => ({
        crashedAt: crashPointRef.current,
        won: false,
        payout: 0,
        cashedAt: prev?.cashedAt ?? null,
      }));
      setError(cashErr ?? "Cash out failed — bet crashed.");
      void refreshProfile();
      return;
    }

    cashingOutRef.current = false;
    setCashingOut(false);
    phaseRef.current = "idle";
    displayPhaseRef.current = "cashed_out";
    setPhase("cashed_out");
    const cashedAtMult = data.cashedAt;
    multiplierRef.current = cashedAtMult;
    setMultiplier(cashedAtMult);
    setLastResult({
      crashedAt: crashPointRef.current,
      won: true,
      payout: data.payout,
      cashedAt: cashedAtMult,
    });
    void refreshProfile();
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
    <div className="crash lc-game-page">
      <Seo
        title="Crash"
        description="The multiplier climbs. Cash out before it crashes. Wait too long and you lose everything. Provably fair."
        path="/crash"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Crash</h1>
        <p className="lc-page__subtitle">
          Watch the multiplier rise. Cash out before it crashes to lock in your winnings.
          Provably fair — {((1 - 0.01) * 100).toFixed(1)}% RTP.
        </p>
      </header>

      <div className="crash__layout">
        <section className="crash__stage-panel">
          <div className={`crash__canvas-wrap${phase === "running" ? " crash__canvas-wrap--running" : ""}${phase === "crashed" ? " crash__canvas-wrap--crashed" : ""}${phase === "cashed_out" ? " crash__canvas-wrap--win" : ""}${phase === "idle" ? " crash__canvas-wrap--idle" : ""}`}>
            <canvas
              ref={canvasRef}
              className="crash__canvas"
              width={CANVAS_BASE_WIDTH}
              height={CANVAS_BASE_HEIGHT}
              role="img"
              aria-label="Crash multiplier chart"
            />
            <div className="crash__multiplier-overlay">
              <span
                className={`crash__mult-value${phase === "crashed" ? " crash__mult-value--crashed" : ""}${phase === "cashed_out" ? " crash__mult-value--win" : ""}`}
                data-tier={phase === "running" ? (multiplier >= 10 ? "crimson" : multiplier >= 5 ? "amber" : undefined) : undefined}
              >
                {multiplier.toFixed(2)}x
              </span>
              {phase === "idle" && (
                <span className="crash__mult-label">Place a bet to start</span>
              )}
              {phase === "crashed" && (
                <span className="crash__mult-label crash__mult-label--crashed">Crashed</span>
              )}
              {phase === "cashed_out" && (
                <span className="crash__mult-label crash__mult-label--win">
                  Cashed out — won {formatCoins(lastResult?.payout ?? 0, coinType)}
                </span>
              )}
            </div>
            {/* Visually-hidden SR-only status region. Announces phase changes
                (not every animation frame) to avoid spamming screen readers
                with 60fps multiplier updates. */}
            <div className="crash__sr-status" aria-live="polite" aria-atomic="true">
              {phase === "idle" && "Place a bet to start."}
              {phase === "running" && "Round in progress."}
              {phase === "crashed" &&
                `Crashed at ${lastResult?.crashedAt.toFixed(2) ?? multiplier.toFixed(2)}x. You lost.`}
              {phase === "cashed_out" &&
                `Cashed out at ${lastResult?.cashedAt?.toFixed(2) ?? multiplier.toFixed(2)}x. You won ${formatCoins(lastResult?.payout ?? 0, coinType)}.`}
            </div>
          </div>

          {lastResult && phase === "crashed" && (
            <div className="crash__outcome crash__outcome--loss" role="status" aria-live="assertive">
              <p>
                Crashed at <strong>{lastResult.crashedAt.toFixed(2)}x</strong> — lost{" "}
                <strong>{formatCoins(wager, coinType)}</strong>
              </p>
            </div>
          )}
        </section>

        <aside className="crash__controls game-controls">
          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="crash-wager">
              Bet amount ({coinLabel})
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
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
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
                &frac12;
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(wager * 2, activeBalance));
                }}
                disabled={phase === "running"}
                aria-label="Double bet"
              >
                2&times;
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(100_000, activeBalance));
                }}
                disabled={phase === "running"}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>

          </div>

          {phase === "running" ? (
            <button
              type="button"
              className="crash__cashout-btn"
              onClick={handleCashOut}
              disabled={cashingOut}
              aria-busy={cashingOut}
            >
              {cashingOut
                ? "Cashing out…"
                : `Cash out at ${multiplier.toFixed(2)}x (${formatCoins(potentialPayout, coinType)})`}
            </button>
          ) : (
            <button
              type="button"
              className="crash__bet-btn"
              onClick={handleBet}
              disabled={!user || exceedsMaxPayout}
            >
              {exceedsMaxPayout
                ? "Payout exceeds cap"
                : phase === "crashed" || phase === "cashed_out"
                  ? "Bet again"
                  : "Bet"}
            </button>
          )}

          {exceedsMaxPayout && phase === "idle" && (
            <p className="game-controls__option-hint game-controls__option-hint--warn" role="note">
              Max payout is {CRASH_MAX_PAYOUT.toLocaleString()}. Lower your wager — even a minimum
              cashout at this wager would exceed the cap.
            </p>
          )}

          {error && (
            <p className="crash__error" role="alert">
              {error}
            </p>
          )}

          <p className="crash__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <div className="crash__fairness">
            <button
              type="button"
              className="crash__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="crash__fairness-body">
                <p>
                  <span className="crash__fairness-k">Server seed (hash)</span>
                  <code className="crash__hash">{pfHash ?? "\u2026"}</code>
                </p>
                <p>
                  <span className="crash__fairness-k">Next nonce</span>
                  <code>{pfNonce}</code>
                </p>
                <label className="crash__seed-label">
                  Client seed
                  <input
                    type="text"
                    className="crash__seed-input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={phase === "running"}
                  />
                </label>
                <button type="button" className="crash__tool-btn" onClick={saveClientSeed} disabled={phase === "running"}>
                  Save client seed
                </button>
                <p className="crash__fairness-note">
                  HMAC-SHA256 &rarr; 4-byte float &rarr; 2&sup2;&#8304;/(n+1)&times;0.99 &mdash; provably fair.
                </p>
                <p className="crash__fairness-note crash__fairness-note--disclosure">
                  RTP disclosure: the crash point distribution targets ~99% RTP
                  at fair payouts; no additional bias roll is applied to Crash.
                  The 99% RTP comes directly from the crash-point formula.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
