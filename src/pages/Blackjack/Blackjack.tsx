import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import { cardRank, cardSuit, handValue, isRedCard } from "../../lib/games/blackjack";
import { formatCoins } from "../../lib/format";
import {
  doubleBlackjack,
  fetchActiveBlackjack,
  fetchBlackjackPfState,
  hitBlackjack,
  insuranceBlackjack,
  setBlackjackClientSeed,
  splitBlackjack,
  standBlackjack,
  startBlackjack,
  isActiveBlackjackConflict,
  isPlayableBlackjackStatus,
  isSettledBlackjackStatus,
  normalizeResumedBlackjack,
  type BlackjackActionResult,
} from "../../lib/blackjack";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import "../../styles/game-controls.css";
import "./Blackjack.css";

/** Idle → dealing → insurance_offer? → player_turn → settled. */
type BjPhase = "idle" | "dealing" | "insurance_offer" | "player_turn" | "settled";

type SessionRefs = {
  phase: BjPhase;
  wager: number;
  coinType: string;
  handId: string | null;
  busy: boolean;
  handCoinType: string | null;
  hand: BlackjackActionResult | null;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
  reduceMotion: boolean;
};

type BjHistoryEntry = {
  id: number;
  outcome: string;
  payout: number;
};

const BJ_HISTORY_MAX = 5;
const VALID_BJ_OUTCOMES = ["blackjack", "win", "push", "bust", "lose"] as const;

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function phaseFromHand(hand: BlackjackActionResult): BjPhase {
  if (isSettledBlackjackStatus(hand.status, hand.phase)) return "settled";
  if (hand.status === "insurance_offer" || hand.phase === "insurance_offer") {
    return "insurance_offer";
  }
  if (isPlayableBlackjackStatus(hand.status, hand.phase)) return "player_turn";
  return "player_turn";
}

function handHasCards(hand: BlackjackActionResult): boolean {
  if (hand.playerCards.length > 0) return true;
  return hand.playerHands.some((h) => h.cards.length > 0);
}

function CardView({
  card,
  hidden,
  index = 0,
  reduceMotion,
}: {
  card?: number;
  hidden?: boolean;
  index?: number;
  reduceMotion?: boolean;
}) {
  const delayStyle = reduceMotion
    ? undefined
    : { ["--card-deal-delay" as string]: `${index * 0.12}s` };

  if (hidden) {
    return (
      <div
        className="bj__card bj__card--hidden"
        aria-hidden="true"
        style={delayStyle}
      />
    );
  }
  if (card === undefined) return null;
  const rank = cardRank(card);
  const suit = cardSuit(card);
  const red = isRedCard(card);
  const suitName =
    suit === "♦" ? "diamonds" : suit === "♥" ? "hearts" : suit === "♠" ? "spades" : "clubs";
  return (
    <div
      className={`bj__card${red ? " bj__card--red" : ""}`}
      style={delayStyle}
      aria-label={`${rank} of ${suitName}`}
    >
      <span className="bj__card-corner bj__card-corner--tl" aria-hidden="true">
        <span className="bj__card-rank">{rank}</span>
        <span className="bj__card-suit">{suit}</span>
      </span>
      <span className="bj__card-center" aria-hidden="true">
        {suit}
      </span>
      <span className="bj__card-corner bj__card-corner--br" aria-hidden="true">
        <span className="bj__card-rank">{rank}</span>
        <span className="bj__card-suit">{suit}</span>
      </span>
    </div>
  );
}

function outcomeLabel(outcome: string | null | undefined) {
  switch (outcome) {
    case "blackjack":
      return "Blackjack!";
    case "win":
      return "You win";
    case "push":
      return "Push";
    case "bust":
      return "Bust";
    case "lose":
      return "Dealer wins";
    default:
      return "";
  }
}

function outcomeChipLabel(outcome: string): string {
  switch (outcome) {
    case "blackjack":
      return "BJ";
    case "win":
      return "Win";
    case "push":
      return "Push";
    case "bust":
      return "Bust";
    case "lose":
      return "Lose";
    default:
      return outcome;
  }
}

export function Blackjack() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<BjPhase>("idle");
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<BlackjackActionResult | null>(null);
  /** Coin type locked when the hand started (must match server debit). */
  const [handCoinType, setHandCoinType] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [handHistory, setHandHistory] = useState<BjHistoryEntry[]>([]);
  const handHistoryIdRef = useRef(0);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const cancelledRef = useRef(false);
  const busyRef = useRef(false);
  const wagerInputRef = useRef<HTMLInputElement | null>(null);

  const session = useRef<SessionRefs>({
    phase: "idle",
    wager: 1,
    coinType: "sweeps_coins",
    handId: null,
    busy: false,
    handCoinType: null,
    hand: null,
    profile,
    user,
    isGuest,
    reduceMotion: false,
  });

  session.current = {
    phase,
    wager,
    coinType,
    handId: hand?.handId ?? null,
    busy,
    handCoinType,
    hand,
    profile,
    user,
    isGuest,
    reduceMotion,
  };

  const insuranceOffer = phase === "insurance_offer";
  const playing = phase === "player_turn" || phase === "insurance_offer";
  const settled = phase === "settled";
  const showTable = Boolean(hand) && phase !== "idle";
  const controlsLocked = busy || phase === "dealing";

  useEffect(() => {
    setReduceMotion(readPrefersReducedMotion());
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      busyRef.current = false;
    };
  }, []);

  const loadPf = useCallback(async () => {
    const { data } = await fetchBlackjackPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  const applyHand = useCallback((data: BlackjackActionResult | null, nextPhase?: BjPhase) => {
    setHand(data);
    if (!data) {
      setPhase(nextPhase ?? "idle");
      return;
    }
    setPhase(nextPhase ?? phaseFromHand(data));
  }, []);

  /** Restore an in-progress server hand onto the felt. Returns true when playable. */
  const restoreActiveHand = useCallback(async (): Promise<boolean> => {
    const res = await fetchActiveBlackjack();
    if (cancelledRef.current) return false;

    if (res.error && !res.data) {
      // Surface restore failures (permission denied, edge down, etc.)
      setError(res.error);
      return false;
    }

    if (res.active === false || (!res.data && !res.error)) {
      setError((prev) => (isActiveBlackjackConflict(prev) ? null : prev));
      return false;
    }

    if (!res.data) return false;

    if (isSettledBlackjackStatus(res.data.status, res.data.phase)) {
      setError((prev) => (isActiveBlackjackConflict(prev) ? null : prev));
      return false;
    }

    const restored = normalizeResumedBlackjack(res.data);
    if (!restored.handId) {
      setError((prev) => (isActiveBlackjackConflict(prev) ? null : prev));
      return false;
    }

    applyHand(restored);
    if (restored.coinType) setHandCoinType(restored.coinType);
    if (restored.wager > 0) {
      setWager(restored.wager);
      setWagerInput(restored.wager.toFixed(2));
    }
    setError(null);
    return isPlayableBlackjackStatus(restored.status, restored.phase);
  }, [applyHand]);

  useEffect(() => {
    if (!user) return;
    void loadPf();
    void restoreActiveHand();
  }, [user, loadPf, restoreActiveHand]);

  const applyWager = (value: number) => {
    const bal = getActiveBalance(session.current.profile);
    const v = clampWager(value, bal);
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const finishSettled = (data: BlackjackActionResult) => {
    setLastMessage(
      `${outcomeLabel(data.outcome)}${
        data.payout ? ` — ${formatCoins(data.payout, coinType)}` : ""
      }`
    );
    applyHand({ ...data, status: "settled" }, "settled");
    const outcome =
      data.outcome && (VALID_BJ_OUTCOMES as readonly string[]).includes(data.outcome)
        ? data.outcome
        : "lose";
    setHandHistory((h) =>
      [
        {
          id: ++handHistoryIdRef.current,
          outcome,
          payout: Number(data.payout ?? 0),
        },
        ...h,
      ].slice(0, BJ_HISTORY_MAX)
    );
    setHandCoinType(null);
  };

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const handleStart = async () => {
    if (busyRef.current) return;
    const s = session.current;
    if (s.phase === "dealing" || s.phase === "player_turn" || s.phase === "insurance_offer") {
      return;
    }

    const authErr = realMoneyBetError(s.user, s.isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }

    const activeBalance = getActiveBalance(s.profile);
    if (activeBalance < s.wager) {
      setError("Insufficient balance.");
      return;
    }

    setBusyBoth(true);
    setError(null);
    setLastMessage(null);
    setHandCoinType(s.coinType);
    setPhase("dealing");

    const { data, error: err } = await startBlackjack(s.wager, s.coinType);
    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }

    if (err || !data) {
      if (isActiveBlackjackConflict(err)) {
        const restored = await restoreActiveHand();
        if (cancelledRef.current) {
          busyRef.current = false;
          return;
        }
        setBusyBoth(false);
        if (!restored) {
          // Never swallow — Deal → Dealing… → idle with no toast was the live bug.
          setError(
            err
              ? `${err} Could not restore the live hand — refresh or finish it first.`
              : "Could not start hand (active hand conflict). Refresh and try again."
          );
          setHandCoinType(null);
          setPhase("idle");
          void refreshProfile();
        }
        return;
      }
      setBusyBoth(false);
      setError(err ?? "Could not start hand.");
      setHandCoinType(null);
      setPhase("idle");
      void refreshProfile();
      return;
    }

    if (!data.handId) {
      setBusyBoth(false);
      setError("Deal succeeded but no hand id was returned. Refresh and try again.");
      setHandCoinType(null);
      setPhase("idle");
      applyHand(null, "idle");
      void refreshProfile();
      return;
    }

    if (!handHasCards(data)) {
      setBusyBoth(false);
      setError("Deal succeeded but no cards were returned. Refresh and try again.");
      setHandCoinType(null);
      setPhase("idle");
      applyHand(null, "idle");
      void refreshProfile();
      return;
    }

    setBusyBoth(false);
    if (isSettledBlackjackStatus(data.status, data.phase)) {
      finishSettled(data);
    } else {
      applyHand(data);
    }
    if (data.nonce != null) setPfNonce(data.nonce + 1);
    void refreshProfile();
  };

  const runAction = async (
    action: "hit" | "stand" | "double" | "split" | "insurance",
    insuranceTake?: boolean
  ) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setError(null);

    let current = session.current.hand;
    if (!current?.handId) {
      const restored = await restoreActiveHand();
      current = session.current.hand;
      if (cancelledRef.current) {
        busyRef.current = false;
        return;
      }
      if (!restored || !current?.handId) {
        setBusyBoth(false);
        setError("No active hand to play. Deal a new one.");
        void refreshProfile();
        return;
      }
    }

    const handId = current.handId;
    const actionCoin = current.coinType || session.current.handCoinType || session.current.coinType;

    const fn =
      action === "hit"
        ? hitBlackjack
        : action === "stand"
          ? standBlackjack
          : action === "double"
            ? doubleBlackjack
            : action === "split"
              ? splitBlackjack
              : (id: string, ct?: string) =>
                  insuranceBlackjack(id, Boolean(insuranceTake), ct);

    let { data, error: err } = await fn(handId, actionCoin);
    if (err && /active hand not found/i.test(err)) {
      const restored = await restoreActiveHand();
      current = session.current.hand;
      if (restored && current?.handId) {
        ({ data, error: err } = await fn(current.handId, actionCoin));
      }
    }

    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }

    setBusyBoth(false);
    if (err || !data) {
      setError(err ?? "Action failed.");
      void refreshProfile();
      return;
    }

    if (!data.handId && !isSettledBlackjackStatus(data.status, data.phase)) {
      setError("Server response missing hand id.");
      void refreshProfile();
      return;
    }

    if (isSettledBlackjackStatus(data.status, data.phase)) {
      finishSettled(data);
    } else {
      applyHand(data);
    }
    void refreshProfile();
  };

  // Hotkeys via session refs so 0.01 SC half/double/max stay correct.
  // Space/Enter contextual; H/S/D/P; I/N; [ ] M when idle.
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
      const isBusy = busyRef.current || s.busy || s.phase === "dealing";
      const activeBalance = getActiveBalance(s.profile);
      const idleLike = s.phase === "idle" || s.phase === "settled";

      if (k === "[") {
        if (isBusy || !idleLike) return;
        e.preventDefault();
        applyWager(s.wager / 2);
        wagerInputRef.current?.blur();
        return;
      }
      if (k === "]") {
        if (isBusy || !idleLike) return;
        e.preventDefault();
        applyWager(Math.min(s.wager * 2, activeBalance, SC_MAX_WAGER));
        wagerInputRef.current?.blur();
        return;
      }
      if (k === "m") {
        if (isBusy || !idleLike) return;
        e.preventDefault();
        applyWager(Math.min(SC_MAX_WAGER, activeBalance));
        wagerInputRef.current?.blur();
        return;
      }

      if (k === " " || k === "enter") {
        if (isBusy) return;
        e.preventDefault();
        if (s.phase === "idle" || s.phase === "settled") {
          void handleStart();
        } else if (s.phase === "player_turn") {
          void runAction("hit");
        } else if (s.phase === "insurance_offer") {
          void runAction("insurance", false);
        }
        return;
      }

      if (isBusy) return;

      if (s.phase === "insurance_offer") {
        if (k === "i") {
          e.preventDefault();
          if (activeBalance >= (s.hand?.insuranceAmount ?? 0)) {
            void runAction("insurance", true);
          }
          return;
        }
        if (k === "n") {
          e.preventDefault();
          void runAction("insurance", false);
        }
        return;
      }

      if (s.phase !== "player_turn") return;
      const handNow = s.hand;
      const splitActiveFinished =
        handNow?.isSplit &&
        handNow.playerHands[handNow.activeHandIndex]?.finished === true;

      if (k === "h") {
        if (!splitActiveFinished) {
          e.preventDefault();
          void runAction("hit");
        }
        return;
      }
      if (k === "s") {
        if (!splitActiveFinished) {
          e.preventDefault();
          void runAction("stand");
        }
        return;
      }
      if (k === "d") {
        if (handNow?.canDouble && activeBalance >= (handNow.wager || s.wager)) {
          e.preventDefault();
          void runAction("double");
        }
        return;
      }
      if (k === "p") {
        if (handNow?.canSplit && activeBalance >= (handNow.wager || s.wager)) {
          e.preventDefault();
          void runAction("split");
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over stable refs; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dealerTotal =
    hand?.dealerTotal ??
    (hand && hand.dealerCards.length > 0 ? handValue(hand.dealerCards).total : 0);

  // Hole card stays face-down until the server sets dealerRevealed.
  const hiddenDealerSlots =
    hand && !hand.dealerRevealed && hand.dealerCards.length === 1 ? 1 : 0;

  const displayHands =
    hand?.isSplit && hand.playerHands.length > 0
      ? hand.playerHands
      : hand
        ? [
            {
              cards: hand.playerCards,
              total: hand.playerTotal || handValue(hand.playerCards).total,
              wager: hand.wager,
              doubled: hand.doubled,
              finished: settled,
            },
          ]
        : [];

  const tableOutcomeClass =
    settled &&
    hand?.outcome &&
    (VALID_BJ_OUTCOMES as readonly string[]).includes(hand.outcome)
      ? ` bj__table-panel--${hand.outcome}`
      : "";

  const saveClientSeed = async () => {
    const { error: seedErr } = await setBlackjackClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else await loadPf();
  };

  return (
    <div className={`bj lc-game-page${reduceMotion ? " bj--reduced-motion" : ""}`}>
      <Seo
        title="Blackjack"
        description="Classic 21 vs the dealer. Hit, stand, double, or split. Blackjack pays 3:2. Provably fair, 96.5% RTP."
        path="/blackjack"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Blackjack</h1>
        <p className="lc-page__subtitle">
          Dealer hits soft 17. Blackjack pays 3:2. Split pairs and insurance — 96.5% RTP.
        </p>
      </header>

      <div className="bj__layout">
        <section className={`bj__table-panel${tableOutcomeClass}`}>
          <div className="bj__felt-rail" aria-hidden="true" />
          <div className="bj__table-inner">
            {settled && lastMessage && (
              <div className="bj__result-banner" role="status" aria-live="polite">
                <span className="bj__result-text">{lastMessage}</span>
              </div>
            )}

            {phase === "dealing" && !hand && (
              <p className="bj__dealing-label" role="status" aria-live="polite">
                Dealing…
              </p>
            )}

            {showTable ? (
              <div className="bj__table-play">
                <div className="bj__hand bj__hand--dealer">
                  <p className="bj__hand-label">
                    Dealer{" "}
                    <span className="bj__hand-total">{dealerTotal || "—"}</span>
                  </p>
                  <div className="bj__cards">
                    {hand?.dealerCards.map((c, i) => (
                      <CardView
                        key={`d-${i}-${c}`}
                        card={c}
                        index={i}
                        reduceMotion={reduceMotion}
                      />
                    ))}
                    {hiddenDealerSlots > 0 && (
                      <CardView
                        hidden
                        index={hand?.dealerCards.length ?? 0}
                        reduceMotion={reduceMotion}
                      />
                    )}
                  </div>
                </div>

                <div
                  className={`bj__player-zone${hand?.isSplit ? " bj__player-zone--split" : ""}`}
                >
                  {displayHands.map((line, index) => {
                    const active =
                      !settled &&
                      hand?.isSplit &&
                      index === hand.activeHandIndex &&
                      !line.finished;
                    return (
                      <div
                        key={`player-${index}`}
                        className={`bj__hand bj__hand--player${
                          active ? " bj__hand--active" : ""
                        }${line.finished && !settled ? " bj__hand--finished" : ""}`}
                      >
                        <p className="bj__hand-label">
                          {hand?.isSplit ? `Hand ${index + 1}` : "You"}
                          <span className="bj__hand-total">{line.total || "—"}</span>
                          {line.doubled && <span className="bj__hand-tag">Doubled</span>}
                        </p>
                        <div className="bj__cards">
                          {line.cards.map((c, i) => (
                            <CardView
                              key={`p-${index}-${i}-${c}`}
                              card={c}
                              index={i}
                              reduceMotion={reduceMotion}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bj__table-play">
                <div className="bj__hand bj__hand--dealer">
                  <p className="bj__hand-label">
                    Dealer <span className="bj__hand-total">—</span>
                  </p>
                  <div className="bj__cards" aria-hidden="true">
                    <div className="bj__card bj__card--slot" />
                    <div className="bj__card bj__card--slot" />
                  </div>
                </div>
                <p className="bj__press-to-deal" role="note">
                  Press <kbd>Space</kbd> or tap <strong>Deal</strong> to begin
                </p>
                <div className="bj__player-zone">
                  <div className="bj__hand bj__hand--player">
                    <p className="bj__hand-label">
                      You <span className="bj__hand-total">—</span>
                    </p>
                    <div className="bj__cards" aria-hidden="true">
                      <div className="bj__card bj__card--slot" />
                      <div className="bj__card bj__card--slot" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="bj__controls game-controls">
          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="bj-wager">
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="bj-wager"
                ref={wagerInputRef}
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : SC_MIN_WAGER);
                }}
                disabled={playing || controlsLocked}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={playing || controlsLocked}
                aria-label="Half bet"
              >
                ½
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => {
                  const activeBalance = getActiveBalance(profile);
                  applyWager(Math.min(wager * 2, activeBalance));
                }}
                disabled={playing || controlsLocked}
                aria-label="Double bet"
              >
                2×
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const activeBalance = getActiveBalance(profile);
                  applyWager(Math.min(SC_MAX_WAGER, activeBalance));
                }}
                disabled={playing || controlsLocked}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {!playing ? (
            <BetButton
              onClick={() => void handleStart()}
              busy={controlsLocked}
              busyLabel="Dealing…"
              label={settled ? "New hand" : "Deal"}
            />
          ) : insuranceOffer ? (
            <div className="bj__insurance">
              <p className="bj__insurance-text">
                Dealer shows Ace. Take insurance for{" "}
                {formatCoins(hand?.insuranceAmount ?? 0, coinType)}?
              </p>
              <div className="bj__actions">
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--insurance"
                  onClick={() => void runAction("insurance", true)}
                  disabled={
                    controlsLocked ||
                    getActiveBalance(profile) < (hand?.insuranceAmount ?? 0)
                  }
                >
                  Insurance
                </button>
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--stand"
                  onClick={() => void runAction("insurance", false)}
                  disabled={controlsLocked}
                >
                  No thanks
                </button>
              </div>
            </div>
          ) : (
            <div className="bj__actions">
              <button
                type="button"
                className="bj__action-btn"
                onClick={() => void runAction("hit")}
                disabled={controlsLocked}
              >
                Hit
              </button>
              <button
                type="button"
                className="bj__action-btn bj__action-btn--stand"
                onClick={() => void runAction("stand")}
                disabled={controlsLocked}
              >
                Stand
              </button>
              {hand?.canDouble && (
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--double"
                  onClick={() => void runAction("double")}
                  disabled={
                    controlsLocked || getActiveBalance(profile) < (hand?.wager ?? 0)
                  }
                >
                  Double
                </button>
              )}
              {hand?.canSplit && (
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--split"
                  onClick={() => void runAction("split")}
                  disabled={
                    controlsLocked || getActiveBalance(profile) < (hand?.wager ?? 0)
                  }
                >
                  Split
                </button>
              )}
            </div>
          )}

          {handHistory.length > 0 && (
            <div className="bj__history" aria-label="Recent hands">
              {handHistory.map((h) => (
                <span
                  key={h.id}
                  className={`bj__history-chip bj__history-chip--${h.outcome}`}
                  title={`${outcomeLabel(h.outcome)} · ${
                    h.payout > 0
                      ? `+${formatCoins(h.payout, coinType)}`
                      : "no win"
                  }`}
                  aria-label={`${outcomeLabel(h.outcome)}${
                    h.payout > 0 ? `, won ${formatCoins(h.payout, coinType)}` : ""
                  }`}
                >
                  {h.payout > 0
                    ? `+${formatCoins(h.payout, coinType)}`
                    : outcomeChipLabel(h.outcome)}
                </span>
              ))}
            </div>
          )}

          <NeedFundsHint />

          {!playing && !controlsLocked && (
            <p className="bj__hotkey-hint" role="note">
              <kbd>Space</kbd> deal · <kbd>[</kbd>/<kbd>]</kbd> wager · <kbd>M</kbd> max
            </p>
          )}
          {phase === "player_turn" && !controlsLocked && (
            <p className="bj__hotkey-hint bj__hotkey-hint--actions" role="note">
              <kbd>H</kbd> hit · <kbd>S</kbd> stand
              {hand?.canDouble ? (
                <>
                  {" "}
                  · <kbd>D</kbd> double
                </>
              ) : null}
              {hand?.canSplit ? (
                <>
                  {" "}
                  · <kbd>P</kbd> split
                </>
              ) : null}
            </p>
          )}
          {phase === "insurance_offer" && !controlsLocked && (
            <p className="bj__hotkey-hint bj__hotkey-hint--actions" role="note">
              <kbd>I</kbd> insurance · <kbd>N</kbd> decline
            </p>
          )}

          <div className="bj__fairness">
            <button
              type="button"
              className="bj__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
              aria-expanded={showFairness}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="bj__fairness-body">
                <p>
                  <span className="bj__fairness-k">Server seed (hash)</span>
                  <code className="bj__hash">{pfHash ?? "…"}</code>
                </p>
                <p>
                  <span className="bj__fairness-k">Next nonce</span>
                  <code>{pfNonce}</code>
                </p>
                <label className="bj__seed-label">
                  Client seed
                  <input
                    type="text"
                    className="bj__seed-input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={playing || controlsLocked}
                  />
                </label>
                <button
                  type="button"
                  className="bj__tool-btn"
                  onClick={() => void saveClientSeed()}
                  disabled={playing || controlsLocked}
                >
                  Save client seed
                </button>
                <p className="bj__fairness-note">
                  Fisher-Yates shuffle from HMAC-SHA256 (Stake card order).
                </p>
                <p className="bj__fairness-note bj__fairness-note--disclosure">
                  RTP disclosure: the shuffle is fair; the displayed 96.5% RTP is
                  enforced by a deterministic bias roll (same seeds) that
                  downgrades ~2.5% of would-be wins to losses. Verifiable after
                  seed rotation.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
