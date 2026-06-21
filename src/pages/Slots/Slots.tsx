import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { useToast } from "../../contexts/ToastContext";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
import {
  fetchSlotsPfState,
  placeSlotsBet,
  setSlotsClientSeed,
  type SlotsBetResult,
} from "../../lib/slots";
import "../../styles/game-controls.css";
import "./Slots.css";

const REVEAL_DELAY_MS = 1200;
const REEL_STOP_STAGGER_MS = 180;
const SYMBOL_CYCLE_MS = 55;

const SYMBOL_GLYPH: Record<number, string> = {
  0: "\u{1F352}",
  1: "\u{1F514}",
  2: "7",
  3: "\u{1F4B0}",
  4: "\u{1F349}",
  5: "\u{2B50}",
  6: "\u{1F451}",
};

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];

type ReelState = "idle" | "spinning" | "landed";

export default function Slots() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();
  const toast = useToast();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1");
  const [rolling, setRolling] = useState(false);
  const [reels, setReels] = useState<number[]>([-1, -1, -1]);
  const [reelStates, setReelStates] = useState<ReelState[]>(["idle", "idle", "idle"]);
  const [lastResult, setLastResult] = useState<SlotsBetResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState<number | null>(null);
  const [clientSeed, setClientSeed] = useState("");

  const rafRef = useRef<number>(0);
  const lastCycleRef = useRef<number>(0);
  const reelStatesRef = useRef<ReelState[]>(["idle", "idle", "idle"]);
  const landingTimersRef = useRef<number[]>([]);

  const activeBalance = useMemo(() => {
    if (!user) return 0;
    return coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
  }, [user, coinType, profile]);

  useEffect(() => {
    reelStatesRef.current = reelStates;
  }, [reelStates]);

  const clearLandingTimers = useCallback(() => {
    for (const t of landingTimersRef.current) window.clearTimeout(t);
    landingTimersRef.current = [];
  }, []);

  useEffect(() => {
    fetchSlotsPfState().then(({ data }) => {
      if (data) {
        setPfHash(data.serverSeedHash);
        setPfNonce(data.nextNonce);
        setClientSeed(data.clientSeed);
      }
    });
  }, []);

  const applyWager = useCallback(
    (value: string) => {
      const parsed = parseFloat(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setWager(1);
        setWagerInput("1");
      } else {
        const clamped = Math.min(Math.max(parsed, 0.01), 100000);
        setWager(clamped);
        setWagerInput(String(clamped));
      }
    },
    []
  );

  function startRollAnimation() {
    setReelStates(["spinning", "spinning", "spinning"]);
    reelStatesRef.current = ["spinning", "spinning", "spinning"];
    lastCycleRef.current = performance.now();

    const tick = (now: number) => {
      if (!reelStatesRef.current.some((s) => s === "spinning")) return;
      if (now - lastCycleRef.current >= SYMBOL_CYCLE_MS) {
        lastCycleRef.current = now;
        setReels((prev) =>
          prev.map((s, i) =>
            reelStatesRef.current[i] === "spinning"
              ? Math.floor(Math.random() * 7)
              : s
          )
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopRollAnimation(finalReels: number[]) {
    finalReels.forEach((sym, i) => {
      const t = window.setTimeout(() => {
        setReels((prev) => {
          const next = [...prev];
          next[i] = sym;
          return next;
        });
        setReelStates((prev) => {
          const next = [...prev];
          next[i] = "landed";
          return next;
        });
      }, i * REEL_STOP_STAGGER_MS);
      landingTimersRef.current.push(t);
    });
  }

  async function handleSpin() {
    setError(null);
    setShowResult(false);
    setLastResult(null);

    if (!user) {
      setError("Log in to play.");
      return;
    }

    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    setRolling(true);
    startRollAnimation();

    const startedAt = Date.now();
    const { data, error: apiError } = await placeSlotsBet({ wager, coinType });

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, REVEAL_DELAY_MS - elapsed);

    await new Promise((r) => setTimeout(r, remaining));

    if (apiError || !data) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
      setRolling(false);
      setReelStates(["idle", "idle", "idle"]);
      setError(apiError ?? "No response from server.");
      setReels([-1, -1, -1]);
      return;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopRollAnimation(data.reels);

    const lastReelDelay = (data.reels.length - 1) * REEL_STOP_STAGGER_MS + 220;
    await new Promise((r) => setTimeout(r, lastReelDelay));

    setLastResult(data);
    setShowResult(true);
    setRolling(false);

    if (data.nonce != null) setPfNonce((prev) => (prev ?? 0) + 1);
    refreshProfile();
  }

  function handleSaveClientSeed() {
    const trimmed = clientSeed.trim();
    if (!trimmed) {
      toast.warning("Enter a client seed.");
      return;
    }
    setSlotsClientSeed(trimmed).then(({ error }) => {
      if (error) toast.error(error);
      else {
        toast.success("Client seed updated.");
        setClientSeed(trimmed);
      }
    });
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
    };
  }, [clearLandingTimers]);

  return (
    <div className="game-page slots">
      <header className="game-header">
        <h1 className="game-header__title">Slots</h1>
        <span className="game-header__rtp">~95% RTP</span>
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
        <div
          className={`slots__reels${
            !rolling && showResult && lastResult?.won ? " slots__reels--win" : ""
          }`}
          role="img"
          aria-label="Slot machine reels"
        >
          {reels.map((symbol, i) => {
            const state = reelStates[i];
            const isWinning =
              !rolling && showResult && lastResult?.won && state === "landed";
            const isLoss =
              !rolling && showResult && lastResult && !lastResult.won && state === "landed";
            return (
              <div
                key={i}
                className={`slots__reel${
                  state === "spinning" ? " slots__reel--rolling" : ""
                }${isWinning ? " slots__reel--win" : ""}${isLoss ? " slots__reel--loss" : ""}${
                  state === "landed" ? " slots__reel--landed" : ""
                }`}
              >
                {symbol >= 0 ? (
                  <span className="slots__symbol">
                    {SYMBOL_GLYPH[symbol] ?? symbol}
                  </span>
                ) : (
                  <span className="slots__symbol slots__symbol--empty" aria-label="Empty">
                    —
                  </span>
                )}
              </div>
            );
          })}
          <div className="slots__win-line" aria-hidden="true" />
        </div>

        {showResult && lastResult && (
          <div className="slots__outcome" role="status" aria-live="polite">
            {lastResult.won ? (
              <>
                <p className="slots__outcome-multiplier">
                  {lastResult.multiplier}× · {lastResult.symbols.join(" ")} win!
                </p>
                <p className="slots__outcome-payout">
                  +{formatCoins(lastResult.payout, coinType)}
                </p>
              </>
            ) : (
              <p className="slots__outcome-loss">No match · try again!</p>
            )}
          </div>
        )}
      </div>

      {panelOpen && (
        <div className="game-panel" role="complementary" aria-label="Slots stats">
          <div className="game-panel__head">
            <h2 className="game-panel__title">Spin info</h2>
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

          {lastResult && (
            <div className="game-panel__section">
              <h3 className="game-panel__section-title">Last spin</h3>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Symbols</span>
                <span className="game-panel__row-value game-panel__row-value--gold">
                  {lastResult.symbols.join(" ")}
                </span>
              </div>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Multiplier</span>
                <span className="game-panel__row-value game-panel__row-value--gold">
                  {lastResult.multiplier}×
                </span>
              </div>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Payout</span>
                <span
                  className={`game-panel__row-value${
                    lastResult.won
                      ? " game-panel__row-value--win"
                      : " game-panel__row-value--loss"
                  }`}
                >
                  {lastResult.won
                    ? `+${formatCoins(lastResult.payout, coinType)}`
                    : "No win"}
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
                  <code className="game-fair__code">{pfHash ?? "—"}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Next nonce</span>
                  <code className="game-fair__code">{pfNonce ?? "—"}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Client seed</span>
                  <input
                    type="text"
                    className="game-fair__input"
                    value={clientSeed}
                    onChange={(e) => setClientSeed(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="game-fair__save"
                  onClick={handleSaveClientSeed}
                >
                  Save client seed
                </button>
                <p className="game-fair__note">
                  HMAC-SHA256 — 3 reels drawn independently per spin.
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
            disabled={rolling}
            onClick={() => applyWager(String(Math.max(wager / 2, 0.01)))}
            aria-label="Half bet"
          >
            ½
          </button>
          <input
            id="slots-wager"
            type="text"
            inputMode="decimal"
            className="game-actionbar__input"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            onBlur={() => applyWager(wagerInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyWager(wagerInput);
            }}
            disabled={rolling}
            aria-label="Bet amount"
          />
          <button
            type="button"
            className="game-actionbar__adj"
            disabled={rolling}
            onClick={() => applyWager(String(Math.min(wager * 2, 100000)))}
            aria-label="Double bet"
          >
            2×
          </button>
        </div>

        <div className="game-actionbar__presets">
          {BET_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={rolling}
              className={`game-actionbar__preset${wager === preset ? " game-actionbar__preset--active" : ""}`}
              onClick={() => {
                setWager(preset);
                setWagerInput(String(preset));
              }}
            >
              {preset}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="game-actionbar__play"
          disabled={rolling}
          onClick={handleSpin}
        >
          {rolling ? "Spinning…" : "Spin"}
        </button>

        {error && <p className="game-actionbar__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
