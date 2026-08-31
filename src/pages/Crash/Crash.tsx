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
  fetchCrashPfState,
  placeCrashBet,
  cashOutCrash,
  setCrashClientSeed,
  fetchCrashFinalState,
} from "../../lib/crash";
import {
  CRASH_MIN_WAGER,
  truncateCrashMultiplier,
} from "../../lib/games/crash";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import { getActiveBalance, SC_MAX_WAGER } from "../../lib/gameWallet";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import "../../styles/game-controls.css";
import "./Crash.css";

// Animation uses a smooth curve that starts VERY slow near 1.00x and
// gradually accelerates — exactly like a real crash game.
// e^(k * t^1.6): at t=5s → ~1.11x, t=10s → ~1.37x, t=20s → ~2.6x, t=35s → ~10x
const CRASH_SPEED_K = 0.008;
const CRASH_SPEED_EXP = 1.6;
const CANVAS_BASE_WIDTH = 600;
const CANVAS_BASE_HEIGHT = 320;
// Maximum multiplier the client animation will render. We hard-stop the
// animation here so the user doesn't see the chart climbing forever. We
// DO NOT fabricate a "Crashed at CLIENT_MAX_MULTIPLIERx" outcome — we
// freeze the chart and show a "Confirming server settlement…" overlay
// until showCrashed() fires from realtime or the poll. The actual crash
// point (often 1.5x–20x) is what the user should see.
const CLIENT_MAX_MULTIPLIER = 1_000_000;

// ─── Smooth y-axis scaling ────────────────────────────────────────────
// The previous version used `Math.ceil(currentMult)` for maxY, which
// caused integer-threshold jumps (1.99x→2.0x shrank the line by 50%, 4.9x
// → 5.0x by 25%, etc.). At high values it also looped `maxY - 1` times per
// redraw, which is 50,000 iterations at 50,000x — a performance disaster.
//
// The new picker uses a log-spaced "nice number" sequence so the axis only
// re-scales at decade boundaries (10x→100x→1,000x). Within a band, the
// line just keeps climbing against a stable ceiling — visually smoother.
const NICE_CEILINGS = [
  1, 1.5, 2, 3, 5, 10, 15, 20, 30, 50, 100, 150, 200, 300, 500,
  1000, 1500, 2000, 3000, 5000, 10000, 15000, 20000, 30000, 50000,
  100000, 150000, 200000, 300000, 500000, 1000000,
] as const;
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 1) return 2;
  for (const n of NICE_CEILINGS) {
    if (n >= v) return n;
  }
  // Beyond 1M (e.g. during the brief CLIENT_MAX_MULTIPLIER stall) round
  // up to the next power of ten. The chart rarely sits here since the
  // server reveals the real crash point within seconds.
  return Math.pow(10, Math.ceil(Math.log10(v)));
}
function niceTicksUpTo(maxY: number, count = 5): number[] {
  if (maxY <= 1) return [1];
  // Linear ticks while the chart lives near 1–5× so 1.0× sits on the
  // floor and 2.0× is not clustered into the top 30% of a dead plot.
  if (maxY <= 5) {
    const step = maxY <= 2 ? 0.25 : 0.5;
    const ticks: number[] = [];
    for (let t = 1; t <= maxY + 1e-9; t += step) {
      ticks.push(Number(t.toFixed(2)));
    }
    if (ticks[ticks.length - 1] !== maxY) ticks.push(maxY);
    return ticks;
  }
  const exp = Math.log10(maxY);
  const ticks: number[] = [1];
  for (let i = 1; i < count; i++) {
    const v = (i / (count - 1)) * exp;
    const snapped = niceCeil(Math.pow(10, v));
    if (snapped > 1) ticks.push(snapped);
  }
  return Array.from(new Set(ticks)).sort((a, b) => a - b);
}
// Compact y-axis label: "1×" "10×" "100×" "1K×" "10K×" "1M×". For
// sub-10 multipliers show one decimal (1.5×) so the tick at 1.5 is
// distinguishable from 1.0. Stays readable at extreme values where the
// raw multiplier would be 157823.42.
function formatTick(v: number): string {
  if (v >= 1_000_000) {
    const n = v / 1_000_000;
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + "M×";
  }
  if (v >= 1000) {
    const n = v / 1000;
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + "K×";
  }
  return v < 10 ? v.toFixed(1) + "×" : v.toFixed(0) + "×";
}
// Compact multiplier text (the big "1.43x" number overlay). Density of
// digits scales with magnitude so the curve looks right at every tier:
//   1.00–9.99   → 2 decimals   ("1.43x")       densest when the curve is slow
//   10.0–99.9   → 1 decimal    ("12.7x")       each pixel of motion > a digit
//   100–999     → 0 decimals   ("137x")        the integer is the action
//   1.00K–9.99K → 2 decimals   ("1.43Kx")
//   10.0K–99.9K → 1 decimal    ("42.7Kx")
//   100K–999K   → 0 decimals   ("157Kx")       bypass 2-deci noise at extreme values
//   1M+         → 0–2 decimals ("1.5Mx", "12Mx")
function formatMultiplier(v: number): string {
  if (v >= 1_000_000) {
    const n = v / 1_000_000;
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + "M";
  }
  if (v >= 100_000) {
    // Catches the v ≈ 999,950..999,999 range where Math.round(v/1000)
    // would render "1000K" — wrong. Bump these to the M branch instead.
    const roundK = Math.round(v / 1000);
    if (roundK >= 1000) {
      const n = v / 1_000_000;
      return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + "M";
    }
    return roundK + "K";
  }
  if (v >= 10_000) return (v / 1000).toFixed(1) + "K";
  if (v >= 1000) return (v / 1000).toFixed(2) + "K";
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
// Polling interval for detecting server-side bet settlement (when the user
// never cashes out). The server's crash_settle_expired_bets cron runs every
// 60s; we poll every 2s for a responsive UX.
const SETTLEMENT_POLL_MS = 2_000;

export function Crash() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  // tickRef holds the most recent rAF `tick` closure so the visibilitychange
  // handler (audit H5) can resume the animation when the tab becomes visible
  // again. The closure captures the per-round `startTime`, `pts`, and canvas
  // context, so we must reuse the SAME function — not recreate it.
  const tickRef = useRef<(() => void) | null>(null);
  const phaseRef = useRef<CrashPhaseLocal>("idle");
  // The client NEVER knows the crash point during an active round (this is
  // the core provably-fair guarantee). The animation runs without an upper
  // bound; it stops when:
  //   1. The user clicks cash out (server returns success=true, payout)
  //   2. The user clicks cash out at the wrong moment (server returns
  //      success=false with the actual crash_point so we can show the crash)
  //   3. The server's auto-settle cron closes the bet (we poll for this via
  //      crash_bets_safe.completed_at)
  // crashPointRef holds the crash point ONLY AFTER the round is over.
  const crashPointRef = useRef<number | null>(null);
  const settlementPollRef = useRef<number | null>(null);
  // Realtime subscription on `crash_bets` filtered by betId. When the server
  // marks the bet completed_at (via cashOutCrash OR the cron), the realtime
  // UPDATE fires and we can call showCrashed() within < 1s of the actual
  // crash — fixing the "chart keeps climbing forever" bug (the user used to
  // see the multiplier go up indefinitely because the cron only ran every
  // 60s and only settled bets older than 2 min). The realtime payload leaks
  // crash_point, but we discard it and re-read the safe view to keep the
  // provably-fair flow honest.
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
  // wagerRef lets the global keyboard hotkey handler (added below) read
  // the latest wager value without re-registering the listener on every
  // wager change. Same pattern as multiplierRef / cancelledRef.
  const wagerRef = useRef(1);
  // profileRef is used by the hotkey handler so it can read wallet
  // balance via ref (instead of capturing `profile` in the closure).
  // The handler registers exactly once with empty `[]` deps, so it
  // doesn't churn addEventListener on every refreshProfile() call.
  const profileRef = useRef(profile);
  // coinTypeRef mirrors `profileRef`: the hotkey handler reads the
  // currently-active GC/SC via ref, not via closure. Without this the
  // handler's `coinType === "sweeps_coins"` check would freeze on the
  // first render's coin symbol and the `]` hotkey would double the wager
  // against the WRONG balance after the user toggled GC↔SC.
  const coinTypeRef = useRef(coinType);

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [phase, setPhase] = useState<CrashPhaseLocal>("idle");
  const [multiplier, setMultiplier] = useState(1);
  const [lastResult, setLastResult] = useState<{
    crashedAt: number;
    won: boolean;
    payout: number;
    cashedAt: number | null;
    /** M13: true when the user attempted to cash out but the server rejected
     *  it because the multiplier had already passed the crash point. The UI
     *  shows a distinct "cashout failed" banner instead of the generic
     *  "crashed" message so the user understands what happened. */
    cashoutFailed?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cashingOut, setCashingOut] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [betId, setBetId] = useState<string | null>(null);
  // True when the client animation self-capped at CLIENT_MAX_MULTIPLIER
  // (1,000,000x) before the server confirmed the actual crash point. We
  // freeze the chart and show a "Confirming server settlement…" overlay
  // instead of fabricating "Crashed at 1,000,000x" — that value is almost
  // never the real crash and was confusing players. showCrashed() fires
  // from realtime or the poll, which is the only path that should reveal
  // the actual crash point.
  const [confirming, setConfirming] = useState(false);

  const historyRef = useRef<{ x: number; y: number }[]>([{ x: 0, y: 1 }]);

  type CrashPhaseLocal = "idle" | "placing" | "running" | "crashed" | "cashed_out";

  // Keep display-phase/multiplier refs in sync with state on every render so
  // stable callbacks (resizeCanvas) read current values without being
  // re-created each frame (which previously caused ResizeObserver disconnect/
  // reconnect churn at 60fps).
  multiplierRef.current = multiplier;
  displayPhaseRef.current = phase;
  wagerRef.current = wager;
  profileRef.current = profile;
  coinTypeRef.current = coinType;

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

  // Pause the rAF loop when the tab is hidden (audit H5). Browsers throttle
  // rAF to ~1 fps on hidden tabs, but each throttled tick still calls
  // setMultiplier → React reconciliation + Canvas redraw. Cancelling the
  // rAF entirely eliminates that waste. When the tab becomes visible again
  // and the round is still running, resume the loop with the SAME tick
  // closure (captured via tickRef) so the chart continues smoothly.
  // NOTE: this does NOT pause the wall-clock `startTime` — the chart will
  // visually jump forward when the tab regains visibility. That drift is a
  // known limitation (the audit calls it out separately) and is bounded by
  // the server's auto-settle cron.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (animRef.current) {
          cancelAnimationFrame(animRef.current);
          animRef.current = 0;
        }
      } else if (phaseRef.current === "running" && tickRef.current) {
        animRef.current = requestAnimationFrame(tickRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Keyboard hotkeys — empty deps + reads from refs so the listener
  // registers exactly once. Bails if focus is on a text input or
  // contentEditable element (otherwise typing "c" in the wager box
  // would cash out, which would be terrible). Bails on Cmd/Ctrl/Alt
  // so we don't shadow browser shortcuts like Cmd+R.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        if (phaseRef.current === "running") {
          e.preventDefault();
          void handleCashOut();
        }
        return;
      }
      // Half / double wager only when we're between rounds.
      if (k === "[") {
        if (phaseRef.current === "running" || phaseRef.current === "placing") return;
        e.preventDefault();
        applyWager(wagerRef.current / 2);
        return;
      }
      if (k === "]") {
        if (phaseRef.current === "running" || phaseRef.current === "placing") return;
        e.preventDefault();
        const bal = getActiveBalance(profileRef.current);
        applyWager(Math.min(wagerRef.current * 2, bal));
        return;
      }
      // Enter or Space: idle → place bet, running → cash out.
      // Space's default behavior is to scroll the page so always
      // preventDefault when we handle it.
      if (k === "enter" || k === " ") {
        e.preventDefault();
        if (phaseRef.current === "running") {
          void handleCashOut();
        } else if (phaseRef.current === "idle") {
          void handleBet();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const applyWager = (value: number) => {
    const maxBet = SC_MAX_WAGER;
    const v = Math.max(CRASH_MIN_WAGER, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

  // Pulse-rate on the Cash Out button scales inversely with the multiplier
  // so the button "breathes faster" as the round gets tense. ~2.4s period
  // at 1.01x → ~0.9s at 100x+ (capped so it doesn't strobe). Suppressed
  // while a cashout is already in flight so the disabled state is calm.
  const cashoutPulseStyle: React.CSSProperties | undefined =
    phase === "running" && !cashingOut
      ? {
          animation: `crash-cashout-pulse ${(
            Math.max(0.9, 2.4 - Math.log10(Math.max(multiplier, 1.01)) * 0.5)
          ).toFixed(2)}s ease-in-out infinite`,
        }
      : undefined;

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

    // maxY uses niceCeil so the y-axis only re-scales at decade boundaries
    // (10x→100x→1,000x), eliminating the "snap shrink" the user saw every
    // integer crossover (1.99→2.0 used to drop the line by 50%). The 12%
    // headroom keeps the visible curve's tip away from the chart top.
    // The previous version's `Math.ceil(currentMult)` also iterated
    // `maxY - 1` times per redraw below — at 50Kx that's a 50K-op stall.
    const maxY = niceCeil(Math.max(2, currentMult * 1.12, ...pts.map((p) => p.y)));
    // 5 log-spaced ticks from 1 to maxY. Snapped to nearest nice number so
    // labels read as 1×, 5×, 10×, 50×, 100× (not 5.62×).
    const yTicks = niceTicksUpTo(maxY);
    const maxX = pts.length > 1 ? pts[pts.length - 1].x : 1;

    function mapX(x: number) { return pad + (x / Math.max(maxX, 0.001)) * graphW; }
    function mapY(y: number) { return pad + graphH - ((y - 1) / Math.max(maxY - 1, 0.001)) * graphH; }

    const colors = resolveChartColor();

    // Background subtle radial glow at origin
    const bgGrad = ctx.createRadialGradient(pad, pad + graphH, 0, pad, pad + graphH, graphW * 0.6);
    bgGrad.addColorStop(0, crashed ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.05)");
    bgGrad.addColorStop(1, "transparent");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Horizontal grid lines — log-spaced at nice ticks so the count stays
    // small (≤5 lines) regardless of maxY. Replaces the previous per-integer
    // loop that ran `maxY - 1` times per frame.
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (const t of yTicks) {
      const y = mapY(t);
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
    }
    ctx.stroke();

    // Vertical time grid lines (subtle)
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
    ctx.lineWidth = 1;
    const vDivisions = 4;
    for (let vi = 1; vi < vDivisions; vi++) {
      const vx = pad + (vi / vDivisions) * graphW;
      ctx.moveTo(vx, pad);
      ctx.lineTo(vx, pad + graphH);
    }
    ctx.stroke();

    if (pts.length === 0) return;

    // Area fill under the line — vertical gradient
    const fillGrad = ctx.createLinearGradient(0, pad, 0, pad + graphH);
    if (crashed) {
      fillGrad.addColorStop(0, "rgba(239, 68, 68, 0.22)");
      fillGrad.addColorStop(1, "rgba(239, 68, 68, 0.02)");
    } else {
      fillGrad.addColorStop(0, "rgba(34, 197, 94, 0.18)");
      fillGrad.addColorStop(1, "rgba(34, 197, 94, 0.01)");
    }
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
    ctx.fillStyle = fillGrad;
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

    // Glowing dot at the tip of the line (only while running). The glow
    // alpha + radius pulse via performance.now() so the dot feels alive
    // independent of the display refresh rate — a sine breath with
    // ~1.4s period keeps the dot from looking static during the long
    // slow start of the curve. The same wall-clock trick we used for
    // the rAF game loop.
    if (!crashed && pts.length > 1) {
      const last = pts[pts.length - 1];
      const tipX = mapX(last.x);
      const tipY = mapY(last.y);
      const breath = Math.sin(performance.now() / 220);
      const glowRadius = 12 + 2 * breath;
      const glowAlpha = 0.55 + 0.15 * breath;
      const coreRadius = 4 + 0.6 * breath;
      const glowGrad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, glowRadius);
      glowGrad.addColorStop(0, `rgba(34, 197, 94, ${glowAlpha})`);
      glowGrad.addColorStop(1, "rgba(34, 197, 94, 0)");
      ctx.beginPath();
      ctx.arc(tipX, tipY, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tipX, tipY, coreRadius, 0, Math.PI * 2);
      ctx.fillStyle = colors.line;
      ctx.fill();
    }

    // Y-axis labels — compact format (1×, 10×, 1K×, 1M×) so they stay
    // readable at extreme values where the raw multiplier would be a
    // 6-digit number (e.g. 157823).
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const t of yTicks) {
      const y = mapY(t);
      ctx.fillText(formatTick(t), 4, y);
    }
  }

  function startAnimation() {
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
    // CRITICAL FIX: do NOT set crashPointRef here — the client doesn't know
    // the crash point. It remains null until the server reveals it (via
    // cashOutCrash response or settlement poll).

    // Use wall-clock time so the growth rate is independent of the display's
    // refresh rate. The original `elapsed += 1/60` per tick made the animation
    // run half-speed on 30Hz displays and 2x speed on 120Hz displays.
    const startTime = performance.now();

    function tick() {
      if (cancelledRef.current) return;
      if (phaseRef.current !== "running") return;

      const elapsed = (performance.now() - startTime) / 1000;
      // Slow-start curve: e^(k * t^1.6) — near-flat for the first few seconds
      // so players have a real window to cash out at 1.01x–1.10x, then ramps.
      const current = Math.exp(CRASH_SPEED_K * Math.pow(elapsed, CRASH_SPEED_EXP));
      const truncated = truncateCrashMultiplier(current);

      // If a cashout is currently in-flight, freeze the chart at the current
      // multiplier and wait for the server response.
      if (cashingOutRef.current) {
        pts.push({ x: elapsed, y: truncated });
        drawGraph(ctx, w, h, pts, truncated, false);
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      // Hard-stop at CLIENT_MAX_MULTIPLIER — we DO NOT fabricate a crash
      // point here. Freezing the chart at 1M and labelling it as "Crashed
      // at 1,000,000x" was misleading (the real crash is usually 1.5–20x).
      // Now we just freeze the chart, light up the confirming overlay, and
      // rely on the realtime subscription / settlement poll to call
      // showCrashed() with the actual server crash_point.
      if (truncated >= CLIENT_MAX_MULTIPLIER) {
        pts.push({ x: elapsed, y: CLIENT_MAX_MULTIPLIER });
        drawGraph(ctx, w, h, pts, CLIENT_MAX_MULTIPLIER, true);
        multiplierRef.current = CLIENT_MAX_MULTIPLIER;
        setMultiplier(CLIENT_MAX_MULTIPLIER);
        setConfirming(true);
        return;
      }

      multiplierRef.current = truncated;
      setMultiplier(truncated);
      pts.push({ x: elapsed, y: truncated });
      drawGraph(ctx, w, h, pts, truncated, false);

      animRef.current = requestAnimationFrame(tick);
    }

    // Expose tick to the visibilitychange handler so it can resume the loop
    // when the tab becomes visible again (audit H5).
    tickRef.current = tick;
    animRef.current = requestAnimationFrame(tick);
  }

  /**
   * Freeze the chart WITHOUT tearing down the settlement poll + realtime
   * subscription. Called from the cash-out error path: we don't know the
   * outcome of the cashout, so we want to stop the rAF (freeze the chart)
   * but still let the existing poll / realtime path call showCrashed()
   * when the server-side auto-settle cron closes the bet.
   *
   * stopAnimation() (the full cleanup) tears down polling too; that's the
   * right thing for confirmed outcomes but the wrong thing for unknown
   * outcomes — calling it here would leave the UI stuck in
   * phase=running with no path to "crashed".
   */
  function freezeChart() {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }
    tickRef.current = null;
    // Deliberately do NOT clear settlementPollRef / realtimeChannelRef —
    // those need to stay alive so showCrashed() can fire when the server
    // eventually marks completed_at.
  }

  /** Stop the settlement poll, animation, AND realtime subscription. */
  function stopAnimation() {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }
    tickRef.current = null;
    if (settlementPollRef.current) {
      clearInterval(settlementPollRef.current);
      settlementPollRef.current = null;
    }
    if (realtimeChannelRef.current) {
      // removeChannel returns a Promise; safe to fire-and-forget since
      // the channel will be unsubscribed once the round resumes.
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  }

  /**
   * Subscribe to `crash_bets` UPDATE events filtered to the current betId.
   * When `completed_at` becomes non-null, the server has settled the bet
   * (cashout OR auto-cron) and we trigger a re-read via `revealCrashFromServer`.
   *
   * SECURITY (provably fair) — DO NOT REFACTOR WITHOUT THINKING:
   * Supabase Realtime delivers the FULL row on UPDATE, including
   * `crash_point`. We MUST NOT read `crash_point` from `payload.new`
   * under any circumstance. Doing so would let a client see the bust
   * point before resolving the round and defeat the game. The row is
   * used ONLY as a "round is over" sentinel via `completed_at`. The
   * authoritative `crash_point` value is read explicitly from
   * `crash_bets_safe`, which only exposes `crash_point` once
   * `completed_at` is set server-side.
   *
   * The `.subscribe()` status callback is mandatory: silent Realtime
   * failures push detection entirely onto the 2s poll, but for bets
   * <2 min old the safe view's `crash_point` is only exposed after
   * the 60s cron has run — meaning a silent failure means the user is
   * stuck on "Confirming server settlement…" for up to 2 minutes. We
   * surface WS failures loudly so a misconfig is caught in QA / prod.
   */
  function subscribeCrashRealtime(betId: string) {
    if (!isSupabaseConfigured) return;
    if (realtimeChannelRef.current) {
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    const channel = supabase
      .channel(`crash-bet-${betId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "crash_bets",
          filter: `id=eq.${betId}`,
        } as { event: "UPDATE"; schema: string; table: string; filter: string },
        (payload: { new: Record<string, unknown> | null }) => {
          if (cancelledRef.current) return;
          if (phaseRef.current !== "running") return;
          // SECURITY: never read `crash_point` here — use only completed_at
          // as the round-over sentinel; read the safe view explicitly.
          const row = payload.new;
          if (!row || !row.completed_at) return;
          void revealCrashFromServer(betId);
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn(
            "[Crash] Realtime subscription failed; falling back to poll only.",
            err
          );
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("[Crash] Realtime channel status:", status);
        }
      });
    realtimeChannelRef.current = channel;
  }

  /** Query `crash_bets_safe` once the server has marked the bet completed
   *  (post-cashout OR post-cron). Returns the canonical crash_point value
   *  the safe view exposes. Used by both the realtime path and the poll
   *  fallback so the user sees the correct crash animation < 1s after
   *  the server actually crashes the round. */
  async function revealCrashFromServer(betId: string) {
    try {
      const result = await fetchCrashFinalState(betId);
      if (!result) return;
      if (cancelledRef.current) return;
      if (phaseRef.current !== "running") return;
      showCrashed(result.crashPoint);
      void refreshProfile();
    } catch {
      // Swallow — the poll fallback will keep trying every 2s.
    }
  }

  /** Mark the round as crashed at `crashPoint` and update the UI. Used by both
   *  the cashout-failed path and the settlement-poll path. Resets `confirming`
   *  so the boolean isn't stale until the next handleBet (single source of
   *  truth — review finding). */
  function showCrashed(crashPoint: number) {
    stopAnimation();
    crashPointRef.current = crashPoint;
    phaseRef.current = "idle";
    displayPhaseRef.current = "crashed";
    setPhase("crashed");
    multiplierRef.current = crashPoint;
    setMultiplier(crashPoint);
    setConfirming(false);
    setLastResult((prev) => ({
      crashedAt: crashPoint,
      won: false,
      payout: 0,
      cashedAt: prev?.cashedAt ?? null,
    }));
  }

  /** Start polling crash_bets_safe for the server-side settlement of this bet.
   *  The server's auto-settle cron marks the bet as completed_at=now() after
   *  2 minutes if the user never cashed out. We detect this and reveal the
   *  crash_point (which the safe view exposes only after completed_at is set). */
  function startSettlementPoll(betId: string) {
    if (!isSupabaseConfigured) return;
    if (settlementPollRef.current) clearInterval(settlementPollRef.current);
    settlementPollRef.current = window.setInterval(async () => {
      if (cancelledRef.current) {
        if (settlementPollRef.current) clearInterval(settlementPollRef.current);
        return;
      }
      if (phaseRef.current !== "running") {
        if (settlementPollRef.current) clearInterval(settlementPollRef.current);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("crash_bets_safe")
          .select("crash_point, completed_at, won")
          .eq("id", betId)
          .maybeSingle();
        if (error) return;
        if (data?.completed_at && data.crash_point != null) {
          showCrashed(Number(data.crash_point));
          void refreshProfile();
        }
      } catch {
        // Swallow — polling errors are non-fatal; the next interval retries.
      }
    }, SETTLEMENT_POLL_MS);
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
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    const activeBalance = getActiveBalance(profile);
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    busyRef.current = true;
    setError(null);
    setLastResult(null);
    setBetId(null);
    setConfirming(false);
    // Intermediate "placing" phase: Bet is disabled, Cash Out is hidden
    // until we have a server-issued betId.
    setPhase("placing");
    phaseRef.current = "placing";
    displayPhaseRef.current = "placing";
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
    setPhase("running");
    phaseRef.current = "running";
    displayPhaseRef.current = "running";
    busyRef.current = false;
    // CRITICAL FIX: do NOT pass data.crashPoint — the server deliberately
    // withholds it (provably-fair guarantee). The animation runs without an
    // upper bound; it stops when the user cashes out, the cashout fails (server
    // reveals crash_point), or the settlement poll detects server-side close.
    startAnimation();
    startSettlementPoll(data.betId);
    // Realtime subscription is the primary detection path. The poll is a
    // fallback for environments where Realtime isn't configured. Without
    // this, the chart kept climbing indefinitely until the 60s cron fired
    // (the user's main bug report).
    subscribeCrashRealtime(data.betId);
    void refreshProfile();
  };

  const handleCashOut = async () => {
    // Double-cashout race: rapid clicks could trigger two cashOutCrash calls
    // before the first settled. busyRef + cashingOutRef guard both paths.
    if (busyRef.current || cashingOutRef.current) return;
    if (!betId || phaseRef.current !== "running") return;

    cashingOutRef.current = true;
    setCashingOut(true);

    // Capture the multiplier from the ref (synchronously updated in tick) so
    // the cashout value matches the latest drawn frame, not the stale state.
    const multAtClick = multiplierRef.current;

    // NOTE: Do NOT stop animation or change phase yet — keep the chart running
    // so the screen doesn't go black while we wait for the server. We'll stop
    // after we get a response.
    const { data, error: cashErr } = await cashOutCrash({
      betId,
      cashedAtMultiplier: multAtClick,
      coinType,
    });

    if (cashErr || !data) {
      if (cancelledRef.current) return;
      // Network/server error: we don't know the outcome. Freeze the chart
      // (cancel the rAF) but KEEP the settlement poll + realtime
      // subscription so they can still detect when the server's auto-settle
      // cron closes the bet and reveal the actual crash point via
      // showCrashed(). Calling stopAnimation() here would tear down the
      // poll+sub AND leave the UI stuck in phase=running with a frozen
      // chart — exactly the "crash game crashes but doesn't tell the user
      // that it crashed" symptom users were reporting.
      //
      // Order matches the success branch (cleanup before flags) so both
      // paths release resources in the same order.
      freezeChart();
      cashingOutRef.current = false;
      setCashingOut(false);
      // Show the same "Confirming server settlement…" overlay the CLIENT_MAX_MULTIPLIER
      // cap path uses, so the wait window between chart-freeze and the
      // poll firing showCrashed() isn't silent (SR-status would otherwise
      // keep announcing "Round in progress." with no visible signal that
      // something changed).
      setConfirming(true);
      setError(cashErr ?? "Cash out failed. The bet will be settled by the server.");
      void refreshProfile();
      return;
    }

    // Stop the animation + settlement poll now that we have the server result.
    stopAnimation();
    cashingOutRef.current = false;
    setCashingOut(false);
    phaseRef.current = "idle";

    if (data.won) {
      // Successful cashout.
      displayPhaseRef.current = "cashed_out";
      setPhase("cashed_out");
      const cashedAtMult = data.cashedAt;
      multiplierRef.current = cashedAtMult;
      setMultiplier(cashedAtMult);
      // If the server also revealed the crash_point (it does in the new schema),
      // store it for the result display.
      const crashPt = data.crashPoint ?? null;
      if (crashPt != null) crashPointRef.current = crashPt;
      setLastResult({
        crashedAt: crashPt ?? cashedAtMult,
        won: true,
        payout: data.payout,
        cashedAt: cashedAtMult,
      });
    } else {
      // Cashout failed because the user tried to cash out AFTER the crash point.
      // The server has settled the bet as a loss and revealed the crash_point.
      const crashPt = data.crashPoint ?? multAtClick;
      crashPointRef.current = crashPt;
      displayPhaseRef.current = "crashed";
      setPhase("crashed");
      multiplierRef.current = crashPt;
      setMultiplier(crashPt);
      // M13: flag this as a cashout-failure (not a natural crash) so the
      // outcome banner shows a distinct message explaining what happened.
      setLastResult((prev) => ({
        crashedAt: crashPt,
        won: false,
        payout: 0,
        cashedAt: prev?.cashedAt ?? null,
        cashoutFailed: true,
      }));
      // M13: the amber `crash__outcome--cashout-failed` banner already
      // explains what happened. The generic FormAlert duplicates the
      // message and was the "error" the user kept seeing — suppress here
      // so only the dedicated outcome banner renders.
    }
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
          Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="crash__layout">
        <section className="crash__stage-panel">
          <div className={`crash__canvas-wrap${phase === "running" ? " crash__canvas-wrap--running" : ""}${phase === "crashed" ? " crash__canvas-wrap--crashed" : ""}${phase === "cashed_out" ? " crash__canvas-wrap--win" : ""}${phase === "idle" ? " crash__canvas-wrap--idle" : ""}${confirming && phase === "running" ? " crash__canvas-wrap--confirming" : ""}`}>
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
                className={`crash__mult-value${phase === "crashed" ? " crash__mult-value--crashed" : ""}${phase === "cashed_out" ? " crash__mult-value--win" : ""}${confirming && phase === "running" ? " crash__mult-value--confirming" : ""}`}
                data-tier={phase === "running" ? (multiplier >= 10 ? "crimson" : multiplier >= 5 ? "amber" : undefined) : undefined}
              >
                {formatMultiplier(multiplier)}x
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
              {/* Show only when the client animation self-capped at
                  CLIENT_MAX_MULTIPLIER BEFORE the server confirmed the real
                  crash point. Previously we fabricated "Crashed at 1Mx"
                  which never matched the true crash point. Now we own the
                  wait state and let realtime / the poll reveal the real
                  point. */}
              {confirming && phase === "running" && (
                <span className="crash__mult-label crash__mult-label--confirming">
                  Confirming server settlement…
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
            <div
              className={`crash__outcome ${lastResult.cashoutFailed ? "crash__outcome--cashout-failed" : "crash__outcome--loss"}`}
              role="status"
              aria-live="assertive"
            >
              {lastResult.cashoutFailed ? (
                <p>
                  <strong>Cash out failed</strong> — the multiplier had already
                  crashed at <strong>{lastResult.crashedAt.toFixed(2)}x</strong>.
                  Your wager of <strong>{formatCoins(wager, coinType)}</strong> was lost.
                </p>
              ) : (
                <p>
                  Crashed at <strong>{lastResult.crashedAt.toFixed(2)}x</strong> — lost{" "}
                  <strong>{formatCoins(wager, coinType)}</strong>
                </p>
              )}
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
                disabled={phase === "running" || phase === "placing"}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={phase === "running" || phase === "placing"}
                aria-label="Half bet"
              >
                &frac12;
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => {
                  const activeBalance = getActiveBalance(profile);
                  applyWager(Math.min(wager * 2, activeBalance));
                }}
                disabled={phase === "running" || phase === "placing"}
                aria-label="Double bet"
              >
                2&times;
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const activeBalance = getActiveBalance(profile);
                  const maxBet = SC_MAX_WAGER;
                  applyWager(Math.min(maxBet, activeBalance));
                }}
                disabled={phase === "running" || phase === "placing"}
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
              style={cashoutPulseStyle}
              onClick={handleCashOut}
              disabled={cashingOut}
              aria-busy={cashingOut}
              aria-disabled={cashingOut}
            >
              {cashingOut
                ? "Cashing out…"
                : `Cash out at ${multiplier.toFixed(2)}x (${formatCoins(potentialPayout, coinType)})`}
            </button>
          ) : (
            <BetButton
              onClick={handleBet}
              busy={phase === "placing"}
              busyLabel="Placing bet…"
              label={
                phase === "crashed" || phase === "cashed_out" ? "Bet again" : "Bet"
              }
            />
          )}

          {error && <FormAlert>{error}</FormAlert>}

          <NeedFundsHint />

          <div className="crash__fairness">
            <button
              type="button"
              className="crash__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
              aria-expanded={showFairness}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="crash__fairness-body">
                <p>
                  <span className="crash__fairness-k">Server seed (hash)</span>
                  <code className="crash__hash">{pfHash ?? "…"}</code>
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
                  HMAC-SHA256 &rarr; 4-byte float &rarr; 2&sup2;&#8304;/(n+1)&times;0.965 &mdash; provably fair.
                </p>
                <p className="crash__fairness-note crash__fairness-note--disclosure">
                  RTP disclosure: the crash point distribution targets ~96.5% RTP
                  at fair payouts; no additional bias roll is applied to Crash.
                  The 96.5% RTP comes directly from the crash-point formula.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
