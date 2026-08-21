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
  startBlackjack,
  hitBlackjack,
  standBlackjack,
  doubleBlackjack,
  splitBlackjack,
  insuranceBlackjack,
  fetchBlackjackPfState,
  setBlackjackClientSeed,
  resumeBlackjack,
  type BlackjackHand,
} from "../../lib/blackjack";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import "../../styles/game-controls.css";
import "./Blackjack.css";

export function Blackjack() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<BlackjackHand | null>(null);
  const [handCoinType, setHandCoinType] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const wagerRef = useRef(1);
  const coinTypeRef = useRef<string>("sweeps_coins");
  const profileRef = useRef(profile);

  const loadPf = useCallback(async () => {
    const { data } = await fetchBlackjackPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  const resume = useCallback(async () => {
    const { data } = await resumeBlackjack();
    if (data) {
      setHand(data);
      setHandCoinType(data.coinType ?? null);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadPf();
      resume();
    }
  }, [user, loadPf, resume]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      busyRef.current = false;
    };
  }, []);

  useEffect(() => {
    wagerRef.current = wager;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
  }, [wager, coinType, profile]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;
      const k = e.key.toLowerCase();
      if ((k === " " || k === "enter") && !hand) {
        e.preventDefault();
        void handleStart();
        return;
      }
      if (k === "h" && hand?.status === "player_turn") {
        e.preventDefault();
        void runAction("hit");
        return;
      }
      if (k === "s" && hand?.status === "player_turn") {
        e.preventDefault();
        void runAction("stand");
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hand]);

  const applyWager = (value: number) => {
    const maxBet = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(0.01, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const applyHand = (data: BlackjackHand) => {
    setHand(data);
  };

  const finishSettled = (data: BlackjackHand) => {
    if (data.payout != null && data.payout > 0) {
      setLastMessage(`Won ${formatCoins(data.payout, handCoinType ?? coinType)}`);
    } else if (data.status === "settled") {
      setLastMessage(data.resultMessage ?? "Round settled.");
    }
  };

  const handleStart = async () => {
    if (busyRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    const wagerNow = wagerRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const activeBalanceNow =
      coinNow === "sweeps_coins"
        ? (profNow?.sweepsCoins ?? 0)
        : (profNow?.balance ?? 0);
    if (activeBalanceNow < wagerNow) {
      setError("Insufficient balance.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setLastMessage(null);
    setHand(null);
    setHandCoinType(coinNow);
    setBusy(true);
    const { data, error: err } = await startBlackjack(wagerNow, coinNow);
    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }
    setBusy(false);
    busyRef.current = false;
    if (err || !data) {
      setError(err ?? "Could not start hand.");
      setHandCoinType(null);
      void refreshProfile();
      return;
    }
    applyHand(data);
    if (data.status === "settled") {
      finishSettled(data);
      setHandCoinType(null);
    }
    if (data.nonce != null) setPfNonce(data.nonce + 1);
  };

  const runAction = async (
    action: "hit" | "stand" | "double" | "split" | "insurance",
    insuranceTake?: boolean
  ) => {
    if (busyRef.current) return;
    if (!hand?.handId) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const fn =
      action === "hit"
        ? hitBlackjack
        : action === "stand"
          ? standBlackjack
          : action === "double"
            ? doubleBlackjack
            : action === "split"
              ? splitBlackjack
              : insuranceBlackjack;
    const { data, error: err } =
      action === "insurance"
        ? await insuranceBlackjack(hand.handId, Boolean(insuranceTake))
        : await fn(hand.handId);
    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }
    setBusy(false);
    busyRef.current = false;
    if (err || !data) {
      setError(err ?? `${action} failed.`);
      return;
    }
    applyHand(data);
    if (data.status === "settled") {
      finishSettled(data);
      setHandCoinType(null);
    }
  };

  const inHand = hand && hand.status !== "settled";

  return (
    <div className="blackjack lc-game-page">
      <Seo
        title="Blackjack"
        description="Classic blackjack. Hit, stand, double, split. Provably fair."
        path="/blackjack"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Blackjack</h1>
        <p className="lc-page__subtitle">
          Beat the dealer to 21. Provably fair.
        </p>
      </header>

      <div className="blackjack__layout">
        <section className="blackjack__table-panel">
          {hand && (
            <div className="blackjack__hands">
              <div className="blackjack__hand">
                <h2>Dealer</h2>
                <p className="blackjack__cards">
                  {(hand.dealerCards ?? []).join(" ") || "—"}
                </p>
                {hand.dealerValue != null && (
                  <p className="blackjack__value">Value: {hand.dealerValue}</p>
                )}
              </div>
              <div className="blackjack__hand">
                <h2>You</h2>
                <p className="blackjack__cards">
                  {(hand.playerCards ?? []).join(" ") || "—"}
                </p>
                {hand.playerValue != null && (
                  <p className="blackjack__value">Value: {hand.playerValue}</p>
                )}
              </div>
            </div>
          )}

          {lastMessage && (
            <div className="blackjack__outcome" role="status">
              {lastMessage}
            </div>
          )}

          {inHand && (
            <div className="blackjack__actions">
              <button type="button" className="blackjack__action" onClick={() => void runAction("hit")} disabled={busy}>
                Hit
              </button>
              <button type="button" className="blackjack__action" onClick={() => void runAction("stand")} disabled={busy}>
                Stand
              </button>
              {hand?.canDouble && (
                <button type="button" className="blackjack__action" onClick={() => void runAction("double")} disabled={busy}>
                  Double
                </button>
              )}
              {hand?.canSplit && (
                <button type="button" className="blackjack__action" onClick={() => void runAction("split")} disabled={busy}>
                  Split
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="blackjack__controls game-controls">
          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="bj-wager">
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="bj-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
                }}
                disabled={Boolean(inHand) || busy}
              />
              <button type="button" className="game-controls__wager-adj" onClick={() => applyWager(wager / 2)} disabled={Boolean(inHand) || busy} aria-label="Half bet">½</button>
              <button type="button" className="game-controls__wager-adj" onClick={() => {
                const bal = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                applyWager(Math.min(wager * 2, bal));
              }} disabled={Boolean(inHand) || busy} aria-label="Double bet">2×</button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {!inHand && (
            <BetButton onClick={handleStart} busy={busy} busyLabel="Dealing…" label="Deal" />
          )}

          <NeedFundsHint />
        </aside>
      </div>
    </div>
  );
}
