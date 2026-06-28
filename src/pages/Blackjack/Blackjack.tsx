import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
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

export function Blackjack() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<BlackjackActionResult | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  // Refs for race-safety (busyRef) and async cleanup (cancelledRef).
  // Mirrors the KENO_MINES / LIMBO_CRASH agents' busyRef/cancelledRef pattern.
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  const insuranceOffer = hand?.status === "insurance_offer";
  const playing = hand?.status === "player_turn" || insuranceOffer;
  const settled = hand?.status === "settled";
  const showTable = Boolean(hand);

  // Max-payout cap (audit R7): blackjack pays 3:2, and a doubled hand can
  // win 2× the doubled wager at 3:2 = 5× the original wager. Wager × 5 >
  // 100,000 when wager > 20,000. The server enforces the cap; this is the UX.
  const BLACKJACK_MAX_PAYOUT = 100_000;
  const exceedsMaxPayout = !playing && wager * 5 > BLACKJACK_MAX_PAYOUT;

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

  const applyWager = (value: number) => {
    const maxBet = coinType === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(1, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const finishSettled = (data: BlackjackActionResult) => {
    setLastMessage(
      `${outcomeLabel(data.outcome)}${data.payout ? ` — ${formatCoins(data.payout, coinType)}` : ""}`
    );
    applyHand({ ...data, status: "settled" });
  };

  const handleStart = async () => {
    // Synchronous re-entrancy guard — the Deal button's `disabled={busy}`
    // prop relies on a re-render cycle that leaves a sub-ms race window
    // between the first click's setBusy(true) commit and a second click.
    if (busyRef.current) return;
    const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setLastMessage(null);
    setHand(null);
    setBusy(true);
    const { data, error: err } = await startBlackjack(wager, coinType);
    if (cancelledRef.current) {
      busyRef.current = false;
      return;
    }
    setBusy(false);
    busyRef.current = false;
    if (err || !data) {
      setError(err ?? "Could not start hand.");
      // Server may have debited before failing — refresh to stay accurate.
      void refreshProfile();
      return;
    }
    applyHand(data);
    if (data.status === "settled") finishSettled(data);
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
    const { data, error: err } = await fn(hand.handId, coinType);
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
  const VALID_BJ_OUTCOMES = ["blackjack", "win", "push", "bust", "lose"] as const;
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
              <p className="bj__hint-center">Place a bet to receive your cards.</p>
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
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
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
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(coinType === "sweeps_coins" ? 100_000 : 10_000_000, activeBalance));
                }}
                disabled={playing || busy}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && (
            <p className="bj__error" role="alert">
              {error}
            </p>
          )}

          {!playing ? (
            <button
              type="button"
              className="bj__deal-btn"
              onClick={handleStart}
              disabled={busy || exceedsMaxPayout}
            >
              {busy ? "Dealing…" : exceedsMaxPayout ? "Payout exceeds cap" : showTable && settled ? "New hand" : "Deal"}
            </button>
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
                    busy || (coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0)) < (hand?.insuranceAmount ?? 0)
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
                  disabled={busy || (coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0)) < (hand?.wager ?? 0)}
                >
                  Double
                </button>
              )}
              {hand?.canSplit && (
                <button
                  type="button"
                  className="bj__action-btn bj__action-btn--split"
                  onClick={() => runAction("split")}
                  disabled={busy || (coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0)) < (hand?.wager ?? 0)}
                >
                  Split
                </button>
              )}
            </div>
          )}

          {exceedsMaxPayout && !playing && (
            <p className="game-controls__option-hint game-controls__option-hint--warn" role="note">
              Max payout is {BLACKJACK_MAX_PAYOUT.toLocaleString()}. Lower your wager — a doubled
              blackjack would exceed the cap.
            </p>
          )}

          <p className="bj__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <div className="bj__fairness">
            <button
              type="button"
              className="bj__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
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
