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
import { formatCoins } from "../../lib/format";
import {
  fetchCrashPfState,
  placeCrashBet,
  cashOutCrash,
  setCrashClientSeed,
  fetchCrashFinalState,
} from "../../lib/crash";
import { truncateCrashMultiplier } from "../../lib/games/crash";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import "../../styles/game-controls.css";
import "./Crash.css";

/** Idle → placing → running → cashed_out | crashed. */
type CrashPhase = "idle" | "placing" | "running" | "cashed_out" | "crashed";

type RoundResult = {
  crashedAt: number;
  won: boolean;
  payout: number;
  cashedAt: number | null;
  /** Late cash-out: server already past crash_point. */
  cashoutFailed?: boolean;
};

type SessionRefs = {
  phase: CrashPhase;
  wager: number;
  coinType: string;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
  betId: string | null;
  multiplier: number;
  cashingOut: boolean;
  reduceMotion: boolean;
};

type ChartPoint = { x: number; y: number };

const CRASH_SPEED_K = 0.008;
const CRASH_SPEED_EXP = 1.6;
const CANVAS_BASE_WIDTH = 600;
const CANVAS_BASE_HEIGHT = 320;
/** Hard-stop climb; never invent crash_point — wait for server. */
const CLIENT_MAX_MULTIPLIER = 1_000_000;
/** Poll is required — Realtime on crash_bets is often silent. */
const SETTLEMENT_POLL_MS = 400;

const NICE_CEILINGS = [
  1, 1.5, 2, 3, 5, 10, 15, 20, 30, 50, 100, 150, 200, 300, 500, 1000, 1500,
  2000, 3000, 5000, 10000, 15000, 20000, 30000, 50000, 100000, 150000, 200000,
  300000, 500000, 1000000,
] as const;

function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 1) return 2;
  for (const n of NICE_CEILINGS) {
    if (n >= v) return n;
  }
  return Math.pow(10, Math.ceil(Math.log10(v)));
}

function niceTicksUpTo(maxY: number, count = 5): number[] {
  if (maxY <= 1) return [1];
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
    const snapped = niceCeil(Math.pow(10, (i / (count - 1)) * exp));
    if (snapped > 1) ticks.push(snapped);
  }
  return Array.from(new Set(ticks)).sort((a, b) => a - b);
}

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

function formatMultiplier(v: number): string {
  if (v >= 1_000_000) {
    const n = v / 1_000_000;
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + "M";
  }
  if (v >= 100_000) {
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

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function resolveChartColor(): { line: string; fill: string; crashed: string } {
  if (typeof window === "undefined") {
    return { line: "#22c55e", fill: "rgba(34,197,94,0.08)", crashed: "#ef4444" };
  }
  const styles = getComputedStyle(document.documentElement);
  const line = styles.getPropertyValue("--lc-emerald").trim() || "#22c55e";
  const ruby = styles.getPropertyValue("--lc-ruby").trim() || "#ef4444";
  const fill =
    line.startsWith("#") && line.length === 7
      ? `rgba(${parseInt(line.slice(1, 3), 16)}, ${parseInt(line.slice(3, 5), 16)}, ${parseInt(line.slice(5, 7), 16)}, 0.10)`
      : "rgba(34, 197, 94, 0.10)";
  return { line, fill, crashed: ruby };
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: ChartPoint[],
  currentMult: number,
  crashed: boolean
) {
  ctx.clearRect(0, 0, w, h);

  const pad = Math.max(28, Math.min(48, Math.floor(w * 0.07)));
  const graphW = w - pad * 2;
  const graphH = h - pad * 2;
  const maxY = niceCeil(Math.max(2, currentMult * 1.12, ...pts.map((p) => p.y)));
  const yTicks = niceTicksUpTo(maxY);
  const maxX = pts.length > 1 ? pts[pts.length - 1]!.x : 1;

  const mapX = (x: number) => pad + (x / Math.max(maxX, 0.001)) * graphW;
  const mapY = (y: number) =>
    pad + graphH - ((y - 1) / Math.max(maxY - 1, 0.001)) * graphH;

  const colors = resolveChartColor();

  const bgGrad = ctx.createRadialGradient(
    pad,
    pad + graphH,
    0,
    pad,
    pad + graphH,
    graphW * 0.6
  );
  bgGrad.addColorStop(0, crashed ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.05)");
  bgGrad.addColorStop(1, "transparent");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (const t of yTicks) {
    const y = mapY(t);
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
  ctx.lineWidth = 1;
  for (let vi = 1; vi < 4; vi++) {
    const vx = pad + (vi / 4) * graphW;
    ctx.moveTo(vx, pad);
    ctx.lineTo(vx, pad + graphH);
  }
  ctx.stroke();

  if (pts.length === 0) return;

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
    const px = mapX(pts[i]!.x);
    const py = mapY(pts[i]!.y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineTo(mapX(pts[pts.length - 1]!.x), pad + graphH);
  ctx.lineTo(mapX(pts[0]!.x), pad + graphH);
  ctx.closePath();
  ctx.fillStyle = fillGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = crashed ? colors.crashed : colors.line;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 0; i < pts.length; i++) {
    const px = mapX(pts[i]!.x);
    const py = mapY(pts[i]!.y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  if (!crashed && pts.length > 1) {
    const last = pts[pts.length - 1]!;
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

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (const t of yTicks) {
    ctx.fillText(formatTick(t), 4, mapY(t));
  }
}

export function Crash() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<CrashPhase>("idle");
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [multiplier, setMultiplier] = useState(1);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cashingOut, setCashingOut] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [betId, setBetId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const tickRef = useRef<(() => void) | null>(null);
  const settlementPollRef = useRef<number | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );
  const historyRef = useRef<ChartPoint[]>([{ x: 0, y: 1 }]);
  const crashPointRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const busyRef = useRef(false);
  const cashingOutRef = useRef(false);
  const phaseRef = useRef<CrashPhase>("idle");
  const multiplierRef = useRef(1);
  const betIdRef = useRef<string | null>(null);
  const actionsRef = useRef<{
    bet: () => void;
    cashOut: () => void;
    applyWager: (v: number) => void;
  }>({ bet: () => {}, cashOut: () => {}, applyWager: () => {} });

  const session = useRef<SessionRefs>({
    phase: "idle",
    wager: 1,
    coinType: "sweeps_coins",
    profile,
    user,
    isGuest,
    betId: null,
    multiplier: 1,
    cashingOut: false,
    reduceMotion: false,
  });

  const controlsLocked = phase === "placing" || phase === "running";
  const potentialPayout = useMemo(
    () => Math.round(wager * multiplier * 100) / 100,
    [wager, multiplier]
  );

  const cashoutPulseStyle: CSSProperties | undefined =
    phase === "running" && !cashingOut && !reduceMotion
      ? {
          animation: `crash-cashout-pulse ${(
            Math.max(0.9, 2.4 - Math.log10(Math.max(multiplier, 1.01)) * 0.5)
          ).toFixed(2)}s ease-in-out infinite`,
        }
      : undefined;

  // Keep session + phase/bet refs aligned every render (Cash Out must not
  // early-return while the button still shows running).
  session.current = {
    phase,
    wager,
    coinType,
    profile,
    user,
    isGuest,
    betId,
    multiplier,
    cashingOut,
    reduceMotion,
  };
  multiplierRef.current = multiplier;
  if (phase === "running" || phase === "placing") {
    phaseRef.current = phase;
  }
  if (betId) betIdRef.current = betId;

  useEffect(() => {
    setReduceMotion(readPrefersReducedMotion());
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const loadPf = useCallback(async () => {
    const { data } = await fetchCrashPfState();
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

  /** Freeze rAF only — keep poll + realtime so settle can still reveal. */
  function freezeChart() {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }
    tickRef.current = null;
  }

  function stopAnimation() {
    freezeChart();
    if (settlementPollRef.current) {
      clearInterval(settlementPollRef.current);
      settlementPollRef.current = null;
    }
    if (realtimeChannelRef.current) {
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  }

  function showCrashed(crashPoint: number) {
    stopAnimation();
    crashPointRef.current = crashPoint;
    phaseRef.current = "crashed";
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

  async function revealCrashFromServer(id: string) {
    try {
      const result = await fetchCrashFinalState(id);
      if (!result || cancelledRef.current) return;
      if (phaseRef.current !== "running") return;
      showCrashed(result.crashPoint);
      void refreshProfile();
    } catch {
      // Poll retries.
    }
  }

  function subscribeCrashRealtime(id: string) {
    if (!isSupabaseConfigured) return;
    if (realtimeChannelRef.current) {
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    const channel = supabase
      .channel(`crash-bet-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "crash_bets",
          filter: `id=eq.${id}`,
        } as { event: "UPDATE"; schema: string; table: string; filter: string },
        (payload: { new: Record<string, unknown> | null }) => {
          if (cancelledRef.current) return;
          if (phaseRef.current !== "running") return;
          // SECURITY: never read crash_point from realtime payload.
          const row = payload.new;
          if (!row || !row.completed_at) return;
          void revealCrashFromServer(id);
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn("[Crash] Realtime failed; poll is primary.", err);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          console.warn("[Crash] Realtime channel status:", status);
        }
      });
    realtimeChannelRef.current = channel;
  }

  function startSettlementPoll(id: string) {
    if (!isSupabaseConfigured) return;
    if (settlementPollRef.current) clearInterval(settlementPollRef.current);

    const pollOnce = async () => {
      if (cancelledRef.current) {
        if (settlementPollRef.current) clearInterval(settlementPollRef.current);
        return;
      }
      if (phaseRef.current !== "running") {
        if (settlementPollRef.current) clearInterval(settlementPollRef.current);
        return;
      }
      try {
        const { data, error: pollErr } = await supabase
          .from("crash_bets_safe")
          .select("crash_point, completed_at, won")
          .eq("id", id)
          .maybeSingle();
        if (pollErr) {
          const msg = pollErr.message ?? "Settlement poll failed.";
          if (
            msg.includes("crash_bets_safe") ||
            msg.includes("does not exist") ||
            msg.includes("permission")
          ) {
            setError(
              (prev) =>
                prev ??
                `Crash settlement view unavailable (${msg}). Cash out still works if the round id is set.`
            );
          }
          return;
        }
        if (data?.completed_at && data.crash_point != null) {
          showCrashed(Number(data.crash_point));
          void refreshProfile();
        }
      } catch {
        // Non-fatal — next interval retries.
      }
    };

    void pollOnce();
    settlementPollRef.current = window.setInterval(() => {
      void pollOnce();
    }, SETTLEMENT_POLL_MS);
  }

  function startAnimation() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx: CanvasRenderingContext2D = ctxRaw;

    const w = canvas.width;
    const h = canvas.height;
    const pts = historyRef.current;
    pts.length = 0;
    pts.push({ x: 0, y: 1 });
    phaseRef.current = "running";
    // Client never knows crash_point during the climb.
    crashPointRef.current = null;

    const startTime = performance.now();

    function tick() {
      if (cancelledRef.current) return;
      if (phaseRef.current !== "running") return;

      const elapsed = (performance.now() - startTime) / 1000;
      const current = Math.exp(
        CRASH_SPEED_K * Math.pow(elapsed, CRASH_SPEED_EXP)
      );
      const truncated = truncateCrashMultiplier(current);

      if (cashingOutRef.current) {
        pts.push({ x: elapsed, y: truncated });
        drawGraph(ctx, w, h, pts, truncated, false);
        animRef.current = requestAnimationFrame(tick);
        return;
      }

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

    tickRef.current = tick;
    animRef.current = requestAnimationFrame(tick);
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
    const crashed = phaseRef.current === "crashed";
    drawGraph(
      ctxRaw,
      canvas.width,
      canvas.height,
      historyRef.current,
      multiplierRef.current,
      crashed
    );
  }, []);

  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [resizeCanvas]);

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

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      phaseRef.current = "idle";
      busyRef.current = false;
      cashingOutRef.current = false;
      stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBet = async () => {
    if (busyRef.current) return;
    const s = session.current;
    if (s.phase === "placing" || s.phase === "running") return;

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

    busyRef.current = true;
    setError(null);
    setLastResult(null);
    setBetId(null);
    betIdRef.current = null;
    setConfirming(false);
    setPhase("placing");
    phaseRef.current = "placing";
    setMultiplier(1);
    multiplierRef.current = 1;

    const { data, error: betErr } = await placeCrashBet({
      wager: s.wager,
      coinType: s.coinType,
    });

    if (betErr || !data) {
      if (cancelledRef.current) return;
      setPhase("idle");
      phaseRef.current = "idle";
      setError(betErr ?? "Bet failed.");
      void refreshProfile();
      busyRef.current = false;
      return;
    }

    const id = String(data.betId ?? "").trim();
    if (!id) {
      setPhase("idle");
      phaseRef.current = "idle";
      setError("Bet placed but no round id was returned. Refresh and try again.");
      busyRef.current = false;
      void refreshProfile();
      return;
    }

    // place-crash-bet must not expose crash_point — ignore if present.
    betIdRef.current = id;
    setBetId(id);
    setPfNonce(data.nonce + 1);
    setPhase("running");
    phaseRef.current = "running";
    busyRef.current = false;
    startAnimation();
    startSettlementPoll(id);
    subscribeCrashRealtime(id);
    void refreshProfile();
  };

  const handleCashOut = async () => {
    if (busyRef.current || cashingOutRef.current) return;

    const s = session.current;
    const id = (betIdRef.current || s.betId || "").trim();

    if (phaseRef.current !== "running" && s.phase !== "running") {
      setError("No active Crash round to cash out.");
      return;
    }
    if (!id) {
      setError(
        "Missing round id — cannot cash out. Refresh and place a new bet."
      );
      return;
    }
    betIdRef.current = id;

    cashingOutRef.current = true;
    setCashingOut(true);
    setError(null);

    const multAtClick = multiplierRef.current;

    try {
      const { data, error: cashErr } = await cashOutCrash({
        betId: id,
        cashedAtMultiplier: Math.max(1.01, multAtClick),
        coinType: session.current.coinType,
      });

      if (cashErr || !data) {
        if (cancelledRef.current) return;
        // Network fail: freeze chart, keep poll, surface error.
        freezeChart();
        void revealCrashFromServer(id);
        setConfirming(true);
        setError(
          cashErr ?? "Cash out failed. The bet will be settled by the server."
        );
        void refreshProfile();
        return;
      }

      stopAnimation();
      phaseRef.current = data.won ? "cashed_out" : "crashed";

      if (data.won) {
        setPhase("cashed_out");
        const cashedAtMult = data.cashedAt;
        multiplierRef.current = cashedAtMult;
        setMultiplier(cashedAtMult);
        const crashPt = data.crashPoint ?? null;
        if (crashPt != null) crashPointRef.current = crashPt;
        setLastResult({
          crashedAt: crashPt ?? cashedAtMult,
          won: true,
          payout: data.payout,
          cashedAt: cashedAtMult,
        });
      } else {
        // Late cash-out: server loss + crashPoint.
        const crashPt = data.crashPoint ?? multAtClick;
        crashPointRef.current = crashPt;
        setPhase("crashed");
        multiplierRef.current = crashPt;
        setMultiplier(crashPt);
        setLastResult((prev) => ({
          crashedAt: crashPt,
          won: false,
          payout: 0,
          cashedAt: prev?.cashedAt ?? null,
          cashoutFailed: true,
        }));
      }
      void refreshProfile();
    } catch (err) {
      if (cancelledRef.current) return;
      freezeChart();
      void revealCrashFromServer(id);
      setConfirming(true);
      setError(
        err instanceof Error ? err.message : "Cash out failed. Try again."
      );
      void refreshProfile();
    } finally {
      cashingOutRef.current = false;
      setCashingOut(false);
    }
  };

  actionsRef.current = {
    bet: () => {
      void handleBet();
    },
    cashOut: () => {
      void handleCashOut();
    },
    applyWager,
  };

  // Hotkeys: c/Space cash-out when running; [ ] wager at 0.01 floor.
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
      const running = s.phase === "running";
      const canWager = s.phase !== "running" && s.phase !== "placing";

      if (k === "c") {
        if (running) {
          e.preventDefault();
          actionsRef.current.cashOut();
        }
        return;
      }
      if (k === " " || k === "enter") {
        e.preventDefault();
        if (running) actionsRef.current.cashOut();
        else if (s.phase === "idle" || s.phase === "crashed" || s.phase === "cashed_out") {
          actionsRef.current.bet();
        }
        return;
      }
      if (k === "[") {
        if (canWager) {
          e.preventDefault();
          actionsRef.current.applyWager(s.wager / 2);
        }
        return;
      }
      if (k === "]") {
        if (canWager) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          actionsRef.current.applyWager(Math.min(s.wager * 2, bal));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setCrashClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  const wrapClass = [
    "crash__canvas-wrap",
    phase === "running" && "crash__canvas-wrap--running",
    phase === "crashed" && "crash__canvas-wrap--crashed",
    phase === "cashed_out" && "crash__canvas-wrap--win",
    phase === "idle" && "crash__canvas-wrap--idle",
    confirming && phase === "running" && "crash__canvas-wrap--confirming",
  ]
    .filter(Boolean)
    .join(" ");

  const multClass = [
    "crash__mult-value",
    phase === "crashed" && "crash__mult-value--crashed",
    phase === "cashed_out" && "crash__mult-value--win",
    confirming && phase === "running" && "crash__mult-value--confirming",
  ]
    .filter(Boolean)
    .join(" ");

  const multTier =
    phase === "running"
      ? multiplier >= 10
        ? "crimson"
        : multiplier >= 5
          ? "amber"
          : undefined
      : undefined;

  const hasBetId = Boolean((betIdRef.current || betId || "").trim());

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
          Watch the multiplier rise. Cash out before it crashes to lock in your
          winnings. Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="crash__layout">
        <section className="crash__stage-panel">
          <div className="crash__board-chrome">
            <span className="crash__phase-pill" data-phase={phase}>
              {phase === "placing"
                ? "Placing"
                : phase === "running"
                  ? confirming
                    ? "Confirming"
                    : "In flight"
                  : phase === "cashed_out"
                    ? "Cashed out"
                    : phase === "crashed"
                      ? "Crashed"
                      : "Ready"}
            </span>
            {(phase === "idle" ||
              phase === "crashed" ||
              phase === "cashed_out") && (
              <p className="crash__press-hint">
                Press <kbd>Space</kbd> to bet · <kbd>C</kbd> / <kbd>Space</kbd>{" "}
                cash out · <kbd>[</kbd> <kbd>]</kbd> wager
              </p>
            )}
          </div>

          <div className={wrapClass}>
            <canvas
              ref={canvasRef}
              className="crash__canvas"
              width={CANVAS_BASE_WIDTH}
              height={CANVAS_BASE_HEIGHT}
              role="img"
              aria-label="Crash multiplier chart"
            />
            <div className="crash__multiplier-overlay">
              <span className={multClass} data-tier={multTier}>
                {formatMultiplier(multiplier)}x
              </span>
              {phase === "idle" && (
                <span className="crash__mult-label">Place a bet to start</span>
              )}
              {phase === "placing" && (
                <span className="crash__mult-label">Placing bet…</span>
              )}
              {phase === "crashed" && (
                <span className="crash__mult-label crash__mult-label--crashed">
                  Crashed
                </span>
              )}
              {phase === "cashed_out" && (
                <span className="crash__mult-label crash__mult-label--win">
                  Cashed out — won{" "}
                  {formatCoins(lastResult?.payout ?? 0, coinType)}
                </span>
              )}
              {confirming && phase === "running" && (
                <span className="crash__mult-label crash__mult-label--confirming">
                  Confirming server settlement…
                </span>
              )}
            </div>
            <div className="crash__sr-status" aria-live="polite" aria-atomic="true">
              {phase === "idle" && "Place a bet to start."}
              {phase === "placing" && "Placing bet."}
              {phase === "running" &&
                (confirming
                  ? "Confirming server settlement."
                  : "Round in progress.")}
              {phase === "crashed" &&
                `Crashed at ${lastResult?.crashedAt.toFixed(2) ?? multiplier.toFixed(2)}x. You lost.`}
              {phase === "cashed_out" &&
                `Cashed out at ${lastResult?.cashedAt?.toFixed(2) ?? multiplier.toFixed(2)}x. You won ${formatCoins(lastResult?.payout ?? 0, coinType)}.`}
            </div>
          </div>

          {lastResult && phase === "crashed" && (
            <div
              className={`crash__outcome ${
                lastResult.cashoutFailed
                  ? "crash__outcome--cashout-failed"
                  : "crash__outcome--loss"
              }`}
              role="status"
              aria-live="assertive"
            >
              {lastResult.cashoutFailed ? (
                <p>
                  <strong>Cash out failed</strong> — the multiplier had already
                  crashed at <strong>{lastResult.crashedAt.toFixed(2)}x</strong>.
                  Your wager of <strong>{formatCoins(wager, coinType)}</strong>{" "}
                  was lost.
                </p>
              ) : (
                <p>
                  Crashed at <strong>{lastResult.crashedAt.toFixed(2)}x</strong>{" "}
                  — lost <strong>{formatCoins(wager, coinType)}</strong>
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

          {phase === "running" ? (
            <button
              type="button"
              className="crash__cashout-btn"
              style={cashoutPulseStyle}
              onClick={() => {
                void handleCashOut();
              }}
              disabled={cashingOut || !hasBetId}
              aria-busy={cashingOut}
              aria-disabled={cashingOut || !hasBetId}
            >
              {cashingOut
                ? "Cashing out…"
                : `Cash out ${multiplier.toFixed(2)}x (${formatCoins(potentialPayout, coinType)})`}
            </button>
          ) : (
            <BetButton
              onClick={() => void handleBet()}
              busy={phase === "placing"}
              busyLabel="Placing bet…"
              label={
                phase === "crashed" || phase === "cashed_out"
                  ? "Bet again"
                  : "Bet"
              }
            />
          )}

          {error && <FormAlert>{error}</FormAlert>}

          <NeedFundsHint />

          <details
            className="crash__fairness"
            open={showFairness}
            onToggle={(e) =>
              setShowFairness((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="crash__fairness-toggle">Provably fair</summary>
            <div className="crash__fairness-body">
              <p>
                <span className="crash__fairness-k">Server seed (hash)</span>
                <code className="crash__hash">{pfHash ?? "…"}</code>
              </p>
              <p>
                <span className="crash__fairness-k">Next nonce</span>
                <code>{pfNonce}</code>
              </p>
              <label className="crash__seed-label" htmlFor="crash-client-seed">
                Client seed
                <input
                  id="crash-client-seed"
                  type="text"
                  className="crash__seed-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={controlsLocked}
                />
              </label>
              <button
                type="button"
                className="crash__tool-btn"
                onClick={() => void saveClientSeed()}
                disabled={controlsLocked}
              >
                Save client seed
              </button>
              <p className="crash__fairness-note">
                HMAC-SHA256 → 4-byte float → 2²⁴/(n+1)×0.965 — provably fair.
                Crash point is revealed only after settle; the client never
                invents it mid-round.
              </p>
              <p className="crash__fairness-note crash__fairness-note--disclosure">
                RTP disclosure: the crash point distribution targets ~96.5% RTP
                at fair payouts; no additional bias roll is applied to Crash.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
