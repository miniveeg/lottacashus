import { useCallback, useEffect, useRef, useState } from "react";
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
  type BlackjackActionResult,
} from "../../lib/blackjack";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import { getActiveBalance, SC_MAX_WAGER } from "../../lib/gameWallet";
import "../../styles/game-controls.css";
import "./Blackjack.css";

function CardView({ card, hidden, index = 0 }: { card?: number; hidden?: boolean; index?: number }) {
  if (hidden) {
    return <div className="bj__card bj__card--hidden" aria-hidden="true" style={{ ["--card-deal-delay" as string]: `${index * 0.12}s` }} />;
  }
  if (card === undefined) return null;
  const rank = cardRank(card);
  const suit = cardSuit(card);
  const red = isRedCard(card);
  return (
    <div
      className={`bj__card${red ? " bj__card--red" : ""}`}
      style={{ ["--card-deal-delay" as string]: `${index * 0.12}s` }}
      aria-label={`${rank} of ${suit === "♦" ? "diamonds" : suit === "♥" ? "hearts" : suit === "♠" ? "spades" : "clubs"}`}
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

// Recent-hands history parity with Roulette/Limbo (which both surface a
// last-N results strip on the board panel). Each entry carries a monotonic
// id so React keys are stable across identical-outcome runs (e.g. two
// consecutive pushes would otherwise collide on `key={i}`).
const BJ_HISTORY_MAX = 5;
type BjHistoryEntry = {
  id: number;
  outcome: string; // whitelist: "blackjack" | "win" | "push" | "bust" | "lose"
  payout: number;
};

// L11 (UI/UX audit): whitelist valid outcomes before interpolating into a
// CSS class — an unexpected `hand.outcome` from the server would otherwise
// produce a non-matching class name and silently skip the colored treatment.
// Reused by finishSettled (history entry filtering) AND by tableOutcomeClass
// (table-panel tinted ring). Declared here so it's available to both.
const VALID_BJ_OUTCOMES = ["blackjack", "win", "push", "bust", "lose"] as const;

// Trimmed outcome labels for the tight chip pill (vs. the full phrase used
// for the result banner — "Blackjack!" and "Dealer wins" don't fit there).
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

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<BlackjackActionResult | null>(null);
  /** Coin type locked when the hand started (must match server debit). */
  const [handCoinType, setHandCoinType] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [handHistory, setHandHistory] = useState<BjHistoryEntry[]>([]);
  // Monotonic id source for hand-history entries. Bumped each push so React
  // keys stay stable across identical-outcome runs.
  const handHistoryIdRef = useRef(0);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  // Refs for race-safety (busyRef) and async cleanup (cancelledRef).
  // Mirrors the KENO_MINES / LIMBO_CRASH agents' busyRef/cancelledRef pattern.
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  // Phase polish: ref mirrors for race-safe hotkey handler / async paths.
  // Mirrors the established Crash+Mines+Keno+Slots+Limbo+Roulette pattern.
  const wagerRef = useRef(1);
  const coinTypeRef = useRef<string>("balance");
  const profileRef = useRef(profile);
  const handRef = useRef<BlackjackActionResult | null>(null);
  // inputsRef points to the wager <input> so the hotkey handler can blur()
  // after a [/] or M wager adjust, freeing the player to immediately press
  // Space to deal without manually clicking out of the field.
  const inputsRef = useRef<HTMLInputElement | null>(null);

  const insuranceOffer = hand?.status === "insurance_offer";
  const playing = hand?.status === "player_turn" || insuranceOffer;
  const settled = hand?.status === "settled";
  const showTable = Boolean(hand);

  const loadPf = useCallback(async () => {
    const { data } = await fetchBlackjackPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  const applyHand = useCallback((data: BlackjackActionResult | null) => {
    if (!data) {
      setHand(null);
      return;
    }
    setHand(data);
  }, []);

  const resume = useCallback(async () => {
    const res = await fetchActiveBlackjack();
    if (cancelledRef.current) return;
    if (res.error || !res.data) return;
    if (res.data.status === "player_turn" || res.data.status === "insurance_offer") {
      applyHand(res.data);
    }
  }, [applyHand]);

  useEffect(() => {
    if (user) {
      loadPf();
      resume();
    }
  }, [user, loadPf, resume]);

  // Unmount cleanup: mark the component cancelled so in-flight action awaits
  // don't fire setState on a dead component (React 19 silently no-ops, but
  // this prevents the leak and clears the busy flag for any queued click).
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      busyRef.current = false;
    };
  }, []);

  // Sync ref mirrors for the hotkey handler and refactored async paths.
  useEffect(() => {
    wagerRef.current = wager;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
    handRef.current = hand;
  }, [wager, coinType, profile, hand]);

  // Keyboard hotkeys. Registered once with [] deps; readSession() pulls the
  // latest values from refs so stale first-render closures can't trap the
  // user. Focus + modifier guards keep this safe globally. Action hotkeys
  // (H/S/D/P/I/N) are gated behind `!busyRef.current` AND hand.status so
  // mashing keys during settle animations can't queue a bad action on the
  // next hand. Per the polish thinker: invalid keys are SILENT no-ops (no
  // toast spam); Space/Enter is contextual ("primary action of current
  // state", defaulting to "No thanks" during insurance_offer since
  // declining is the safer default for accidental spacebar taps).
  //   Space / Enter → Deal (no hand) | Hit (player_turn) | no-thanks (ins)
  //   H             → Hit (player_turn only — silent if already settled)
  //   S             → Stand (player_turn only)
  //   D             → Double (player_turn + canDouble + funds — silent else)
  //   P             → Split (player_turn + canSplit + funds — silent else)
  //   I             → Take insurance (insurance_offer only)
  //   N             → Decline insurance (insurance_offer only)
  //   [             → Half wager (idle only — also blurs input)
  //   ]             → Double wager (idle only — also blurs input)
  //   M             → Max wager (idle only — also blurs input)
  useEffect(() => {
    function readSession() {
      const wagerNow = wagerRef.current;
      const profNow = profileRef.current;
      const handNow = handRef.current;
      const activeBalance = getActiveBalance(profNow);
      return { wagerNow, handNow, activeBalance };
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;

      const k = e.key.toLowerCase();
      const { wagerNow, handNow, activeBalance } = readSession();
      const isBusy = busyRef.current;
      const status = handNow?.status;

      // === WAGER ADJUSTMENTS (idle only) ===
      if (k === "[") {
        if (isBusy || status === "player_turn" || status === "insurance_offer") return;
        e.preventDefault();
        const half = Math.max(wagerNow / 2, 1);
        setWager(half);
        setWagerInput(half.toFixed(2));
        inputsRef.current?.blur();
        return;
      }
      if (k === "]") {
        if (isBusy || status === "player_turn" || status === "insurance_offer") return;
        e.preventDefault();
        const cap = SC_MAX_WAGER;
        const doubled = Math.min(wagerNow * 2, activeBalance, cap);
        if (doubled >= 1) {
          setWager(doubled);
          setWagerInput(doubled.toFixed(2));
          inputsRef.current?.blur();
        }
        return;
      }
      if (k === "m") {
        if (isBusy || status === "player_turn" || status === "insurance_offer") return;
        e.preventDefault();
        const cap = SC_MAX_WAGER;
        const max = Math.min(cap, activeBalance);
        if (max >= 1) {
          setWager(max);
          setWagerInput(max.toFixed(2));
          inputsRef.current?.blur();
        }
        return;
      }

      // === PRIMARY ACTION (contextual Space/Enter) ===
      // No hand → Deal; player_turn → Hit; insurance_offer → decline (safer
      // default for accidental mashing); settled → deal a new hand.
      if (k === " " || k === "enter") {
        if (isBusy) return;
        e.preventDefault();
        if (!status) {
          void handleStart();
        } else if (status === "player_turn") {
          void runAction("hit");
        } else if (status === "insurance_offer") {
          void runAction("insurance", false);
        } else if (status === "settled") {
          void handleStart();
        }
        return;
      }

      // All action hotkeys below require !isBusy AND a matching status.
      if (isBusy) return;

      // === INSURANCE OFFER ===
      if (status === "insurance_offer") {
        if (k === "i") {
          e.preventDefault();
          if (activeBalance >= (handNow?.insuranceAmount ?? 0)) {
            void runAction("insurance", true);
          }
          return;
        }
        if (k === "n") {
          e.preventDefault();
          void runAction("insurance", false);
          return;
        }
        return; // Don't fall through to H/S/D/P during insurance.
      }

      // === PLAYER TURN ===
      if (status !== "player_turn") return;
      // In split mode, skip action keys if the currently-active hand is
      // already finished. Without this guard, pressing H/S on the wrong
      // hand (after the other hand auto-resolved) would send a hit/stand
      // to the server for a non-active hand and surface an error to the
      // player. Better to silently no-op (per polish thinker guideline).
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
        // Silent no-op if canDouble/funds unavailable (per polish thinker).
        if (handNow?.canDouble && activeBalance >= wagerNow) {
          e.preventDefault();
          void runAction("double");
        }
        return;
      }
      if (k === "p") {
        if (handNow?.canSplit && activeBalance >= wagerNow) {
          e.preventDefault();
          void runAction("split");
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyWager = (value: number) => {
    // Read coin type from ref so this is safe from the hotkey's [] deps.
    const maxBet = SC_MAX_WAGER;
    const v = Math.max(1, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const finishSettled = (data: BlackjackActionResult) => {
    setLastMessage(
      `${outcomeLabel(data.outcome)}${data.payout ? ` — ${formatCoins(data.payout, coinType)}` : ""}`
    );
    applyHand({ ...data, status: "settled" });
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
  };

  // Phase polish: capture the wager <input> so the hotkey wager-adjust
  // handler can blur() it after [/] / M, freeing the player to press
  // Space immediately to deal (without manually clicking out of the field).
  // Apply via a ref-callback attribute on the wager input below.
  const handleStart = async () => {
    // Synchronous re-entrancy guard — the Deal button's `disabled={busy}`
    // prop relies on a re-render cycle that leaves a sub-ms race window
    // between the first click's setBusy(true) commit and a second click.
    if (busyRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    // Read all session values from refs so this handler is safe from any
    // binding context (JSX onClick, hotkey listener, etc.).
    const wagerNow = wagerRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const activeBalanceNow = getActiveBalance(profNow);
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
      // Server may have debited before failing — refresh to stay accurate.
      void refreshProfile();
      return;
    }
    applyHand(data);
    if (data.status === "settled") {
      finishSettled(data);
      setHandCoinType(null);
    }
    if (data.nonce != null) setPfNonce(data.nonce + 1);
    // No refreshProfile() here — ProfileContext's realtime subscription on
    // `profiles` pushes the new balance (wager debit) the instant the server
    // commits start_blackjack_hand. Calling it would fire 2 redundant RPCs
    // (ensure_user_profile + is_current_user_admin) per bet.
  };

  const runAction = async (
    action: "hit" | "stand" | "double" | "split" | "insurance",
    insuranceTake?: boolean
  ) => {
    // Synchronous re-entrancy guard — same sub-ms race window as handleStart.
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
              : (id: string, ct?: string) => insuranceBlackjack(id, Boolean(insuranceTake), ct);
    // Always use the coin type locked when the hand started.
    const actionCoin = handCoinType ?? coinType;
    const { data, error: err } = await fn(hand.handId, actionCoin);
    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }
    setBusy(false);
    busyRef.current = false;
    if (err || !data) {
      setError(err ?? "Action failed.");
      // Server may have debited before failing — refresh to stay accurate.
      void refreshProfile();
      return;
    }
    if (data.status === "settled") {
      finishSettled(data);
      setHandCoinType(null);
    } else {
      applyHand(data);
    }
    // No refreshProfile() here — ProfileContext's realtime subscription on
    // `profiles` pushes the new balance the instant the server commits any
    // debit/credit from this action (double/split/insurance or settlement).
    // Calling it would fire 2 redundant RPCs per action.
  };

  const dealerTotal =
    hand?.dealerTotal ??
    (hand && hand.dealerCards.length > 0 ? handValue(hand.dealerCards).total : 0);

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

  // L11 (UI/UX audit): whitelist valid outcomes before interpolating into a
  // CSS class — an unexpected `hand.outcome` from the server would otherwise
  // produce a non-matching class name and silently skip the colored treatment.
  const tableOutcomeClass =
    settled && hand?.outcome && (VALID_BJ_OUTCOMES as readonly string[]).includes(hand.outcome)
      ? ` bj__table-panel--${hand.outcome}`
      : "";

  return (
    <div className="bj lc-game-page">
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
          <div className="bj__table-inner">
            {settled && lastMessage && (
              <div className="bj__result-banner" role="status" aria-live="polite">
                <span className="bj__result-text">{lastMessage}</span>
              </div>
            )}

            {showTable ? (
              <div className="bj__table-play">
                <div className="bj__hand bj__hand--dealer">
                  <p className="bj__hand-label">
                    Dealer <span className="bj__hand-total">{dealerTotal || "—"}</span>
                  </p>
                  <div className="bj__cards">
                    {hand?.dealerCards.map((c, i) => (
                      <CardView key={`d-${i}-${c}`} card={c} index={i} />
                    ))}
                    {hiddenDealerSlots > 0 && <CardView hidden index={(hand?.dealerCards.length ?? 0)} />}
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
                        className={`bj__hand bj__hand--player${active ? " bj__hand--active" : ""}${line.finished && !settled ? " bj__hand--finished" : ""}`}
                      >
                        <p className="bj__hand-label">
                          {hand?.isSplit ? `Hand ${index + 1}` : "You"}
                          <span className="bj__hand-total">{line.total || "—"}</span>
                          {line.doubled && <span className="bj__hand-tag">Doubled</span>}
                        </p>
                        <div className="bj__cards">
                          {line.cards.map((c, i) => (
                            <CardView key={`p-${index}-${i}-${c}`} card={c} index={i} />
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
                ref={inputsRef}
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
                }}
                disabled={playing || busy}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={playing || busy}
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
                disabled={playing || busy}
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
                disabled={playing || busy}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {!playing ? (
            <BetButton
              onClick={handleStart}
              busy={busy}
              busyLabel="Dealing…"
              label={showTable && settled ? "New hand" : "Deal"}
            />
          ) : insuranceOffer ? (
            <div className="bj__insurance">
              <p className="bj__insurance-text">
                Dealer shows Ace. Take insurance for {formatCoins(hand?.insuranceAmount ?? 0, coinType)}?
              </p>
              <div className="bj__actions">
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--insurance"
                  onClick={() => runAction("insurance", true)}
                  disabled={
                    busy || (getActiveBalance(profile)) < (hand?.insuranceAmount ?? 0)
                  }
                >
                  Insurance
                </button>
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--stand"
                  onClick={() => runAction("insurance", false)}
                  disabled={busy}
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
                onClick={() => runAction("hit")}
                disabled={busy}
              >
                Hit
              </button>
              <button
                type="button"
                className="bj__action-btn bj__action-btn--stand"
                onClick={() => runAction("stand")}
                disabled={busy}
              >
                Stand
              </button>
              {hand?.canDouble && (
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--double"
                  onClick={() => runAction("double")}
                  disabled={busy || (getActiveBalance(profile)) < (hand?.wager ?? 0)}
                >
                  Double
                </button>
              )}
              {hand?.canSplit && (
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--split"
                  onClick={() => runAction("split")}
                  disabled={busy || (getActiveBalance(profile)) < (hand?.wager ?? 0)}
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

          {/* Phase polish: state-aware hotkey hint footer. Tells desktop
              users the primary bindings for the current game phase. The
              hint NEVER appears during busy/playing settle so it doesn't
              shift while the player focuses on cards. Mirrors the Slots /
              Limbo / Roulette footer pattern. */}
          {!playing && !busy && (
            <p className="bj__hotkey-hint" role="note">
              <kbd>Space</kbd> deal · <kbd>[</kbd>/<kbd>]</kbd> wager · <kbd>M</kbd> max
            </p>
          )}
          {hand?.status === "player_turn" && !busy && (
            <p className="bj__hotkey-hint bj__hotkey-hint--actions" role="note">
              <kbd>H</kbd> hit · <kbd>S</kbd> stand
              {hand?.canDouble ? <> · <kbd>D</kbd> double</> : null}
              {hand?.canSplit ? <> · <kbd>P</kbd> split</> : null}
            </p>
          )}
          {hand?.status === "insurance_offer" && !busy && (
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
                    disabled={playing}
                  />
                </label>
                <button
                  type="button"
                  className="bj__tool-btn"
                  onClick={async () => {
                    const { error: e } = await setBlackjackClientSeed(clientSeed);
                    if (e) setError(e);
                    else await loadPf();
                  }}
                  disabled={playing}
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
