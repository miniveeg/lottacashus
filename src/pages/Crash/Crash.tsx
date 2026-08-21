import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import { formatCoins } from "../../lib/format";
import {
  placeCrashBet,
  cashOutCrash,
  fetchCrashPfState,
  setCrashClientSeed,
  subscribeCrashRealtime,
} from "../../lib/crash";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import "../../styles/game-controls.css";
import "./Crash.css";

type Phase = "idle" | "placing" | "running" | "cashed" | "crashed";

const SETTLEMENT_POLL_MS = 2_000;

export function Crash() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const displayPhaseRef = useRef<Phase>("idle");
  const multiplierRef = useRef(1);
  const betIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [phase, setPhase] = useState<Phase>("idle");
  const [multiplier, setMultiplier] = useState(1);
  const [betId, setBetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    cashed: boolean;
    multiplier: number;
    payout: number;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

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

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      busyRef.current = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;
      const k = e.key.toLowerCase();
      if ((k === " " || k === "enter") && phaseRef.current === "idle") {
        e.preventDefault();
        void handleBet();
        return;
      }
      if ((k === " " || k === "enter" || k === "c") && phaseRef.current === "running") {
        e.preventDefault();
        void handleCashOut();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyWager = (value: number) => {
    const maxBet = coinType === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(0.01, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const startAnimation = () => {
    const start = performance.now();
    const tick = (now: number) => {
      if (phaseRef.current !== "running") return;
      const t = (now - start) / 1000;
      // Approximate growth curve for display only — server is source of truth.
      const m = Math.max(1, Math.exp(0.06 * t));
      multiplierRef.current = m;
      setMultiplier(m);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  };

  const stopAnimation = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = 0;
  };

  const startSettlementPoll = (id: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      if (phaseRef.current !== "running") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        return;
      }
      // Settlement is driven primarily by Realtime; poll is a safety net.
      // cashOutCrash will fail if already settled and reveal crash point.
    }, SETTLEMENT_POLL_MS);
  };

  const handleBet = async () => {
    if (busyRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    const activeBalance =
      coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
    if (activeBalance < wager) {
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
      void refreshProfile();
      busyRef.current = false;
      return;
    }

    setBetId(data.betId);
    betIdRef.current = data.betId;
    setPfNonce(data.nonce + 1);
    setPhase("running");
    phaseRef.current = "running";
    displayPhaseRef.current = "running";
    busyRef.current = false;
    startAnimation();
    startSettlementPoll(data.betId);
    subscribeCrashRealtime(data.betId);
  };

  const handleCashOut = async () => {
    if (busyRef.current) return;
    const id = betIdRef.current;
    if (!id || phaseRef.current !== "running") return;
    busyRef.current = true;
    setConfirming(true);
    const multNow = multiplierRef.current;

    const { data, error: cashErr } = await cashOutCrash({ betId: id, multiplier: multNow });
    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }

    stopAnimation();
    if (pollRef.current) window.clearInterval(pollRef.current);

    if (cashErr || !data) {
      // Late cashout / already crashed
      setPhase("crashed");
      phaseRef.current = "crashed";
      displayPhaseRef.current = "crashed";
      setLastResult({
        cashed: false,
        multiplier: data?.crashPoint ?? multNow,
        payout: 0,
      });
      setError(cashErr ?? "Cash out failed — round already settled.");
      busyRef.current = false;
      setConfirming(false);
      setTimeout(() => {
        setPhase("idle");
        phaseRef.current = "idle";
        displayPhaseRef.current = "idle";
        setBetId(null);
        betIdRef.current = null;
      }, 2000);
      return;
    }

    setPhase("cashed");
    phaseRef.current = "cashed";
    displayPhaseRef.current = "cashed";
    setLastResult({
      cashed: true,
      multiplier: data.cashoutMultiplier ?? multNow,
      payout: data.payout ?? 0,
    });
    busyRef.current = false;
    setConfirming(false);
    setTimeout(() => {
      setPhase("idle");
      phaseRef.current = "idle";
      displayPhaseRef.current = "idle";
      setBetId(null);
      betIdRef.current = null;
    }, 2000);
  };

  return (
    <div className="crash lc-game-page">
      <Seo
        title="Crash"
        description="Watch the multiplier climb. Cash out before it crashes. Provably fair."
        path="/crash"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Crash</h1>
        <p className="lc-page__subtitle">
          Watch the multiplier climb. Cash out before it crashes. Provably fair.
        </p>
      </header>

      <div className="crash__layout">
        <section className="crash__stage-panel">
          <div className="crash__display" aria-live="polite">
            <span className="crash__display-label">
              {phase === "running"
                ? "Flying…"
                : phase === "placing"
                  ? "Placing…"
                  : phase === "cashed"
                    ? "Cashed out"
                    : phase === "crashed"
                      ? "Crashed"
                      : "Ready"}
            </span>
            <span className="crash__display-value">{multiplier.toFixed(2)}×</span>
          </div>

          {lastResult && phase !== "running" && phase !== "placing" && (
            <div
              className={`crash__outcome${lastResult.cashed ? " crash__outcome--win" : " crash__outcome--loss"}`}
              role="status"
            >
              {lastResult.cashed
                ? `Cashed at ${lastResult.multiplier.toFixed(2)}× — won ${formatCoins(lastResult.payout, coinType)}`
                : `Crashed at ${lastResult.multiplier.toFixed(2)}×`}
            </div>
          )}

          <canvas ref={canvasRef} className="crash__canvas" width={640} height={240} aria-hidden="true" />
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
                disabled={phase !== "idle"}
              />
              <button type="button" className="game-controls__wager-adj" onClick={() => applyWager(wager / 2)} disabled={phase !== "idle"} aria-label="Half bet">½</button>
              <button type="button" className="game-controls__wager-adj" onClick={() => {
                const bal = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                applyWager(Math.min(wager * 2, bal));
              }} disabled={phase !== "idle"} aria-label="Double bet">2×</button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {phase === "idle" || phase === "cashed" || phase === "crashed" ? (
            <BetButton onClick={handleBet} busy={phase === "placing"} busyLabel="Placing…" label="Bet" />
          ) : phase === "running" ? (
            <BetButton onClick={handleCashOut} busy={confirming} busyLabel="Cashing out…" label={`Cash Out ${multiplier.toFixed(2)}×`} />
          ) : (
            <BetButton onClick={() => {}} busy busyLabel="Placing…" label="Bet" disabled />
          )}

          <NeedFundsHint />
        </aside>
      </div>
    </div>
  );
}
