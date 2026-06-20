import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { cardRank, cardSuit, handValue, isRedCard } from "../../lib/games/blackjack";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
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

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];

function CardView({ card, hidden, index = 0 }: { card?: number; hidden?: boolean; index?: number }) {
  if (hidden) {
    return (
      <div
        className="bj__card bj__card--hidden"
        aria-hidden="true"
        style={{ ["--card-deal-delay" as string]: `${index * 0.12}s` }}
      />
    );
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
      <span className="bj__card-center" aria-hidden="true">{suit}</span>
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

  const insuranceOffer = hand?.status === "insurance_offer";
  const playing = hand?.status === "player_turn" || insuranceOffer;
  const settled = hand?.status === "settled";
  const showTable = Boolean(hand);

  const activeBalance = useMemo(
    () => (coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0)),
    [coinType, profile]
  );

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

  const applyWager = (value: number) => {
    const v = Math.max(0.01, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const finishSettled = (data: BlackjackActionResult) => {
    setLastMessage(
      `${outcomeLabel(data.outcome)}${data.payout ? ` · ${formatCoins(data.payout, coinType)}` : ""}`
    );
    applyHand({ ...data, status: "settled" });
  };

  const handleStart = async () => {
    if (!user) {
      setError("Log in to play.");
      return;
    }
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }
    setError(null);
    setLastMessage(null);
    setHand(null);
    setBusy(true);
    const { data, error: err } = await startBlackjack(wager, coinType);
    setBusy(false);
    if (err || !data) {
      setError(err ?? "Could not start hand.");
      return;
    }
    applyHand(data);
    if (data.status === "settled") finishSettled(data);
    if (data.nonce != null) setPfNonce(data.nonce + 1);
    await refreshProfile();
  };

  const runAction = async (
    action: "hit" | "stand" | "double" | "split" | "insurance",
    insuranceTake?: boolean
  ) => {
    if (!hand?.handId) return;
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
              : (id: string) => insuranceBlackjack(id, Boolean(insuranceTake));
    const { data, error: err } = await fn(hand.handId, coinType);
    setBusy(false);
    if (err || !data) {
      setError(err ?? "Action failed.");
      return;
    }
    if (data.status === "settled") {
      finishSettled(data);
    } else {
      applyHand(data);
    }
    await refreshProfile();
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

  return (
    <div className="game-page bj">
      <header className="game-page__header">
        <div className="game-page__header-text">
          <h1 className="game-page__title">Blackjack</h1>
          <p className="game-page__subtitle">
            Classic blackjack with split, double, and insurance. Blackjack pays 3:2.
          </p>
        </div>
        <span className="game-page__rtp">99.5% RTP</span>
      </header>

      <div className="game-page__layout">
        <section className="game-page__stage bj__stage">
          {settled && lastMessage && (
            <div className="bj__result-banner" role="status" aria-live="polite">
              <span className="bj__result-text">{lastMessage}</span>
            </div>
          )}

          {showTable ? (
            <div className="bj__table">
              <div className="bj__hand bj__hand--dealer">
                <div className="bj__hand-head">
                  <span className="bj__hand-label">Dealer</span>
                  <span className="bj__hand-total">{dealerTotal || "—"}</span>
                </div>
                <div className="bj__cards">
                  {hand?.dealerCards.map((c, i) => (
                    <CardView key={`d-${i}`} card={c} index={i} />
                  ))}
                  {hiddenDealerSlots > 0 && <CardView hidden index={(hand?.dealerCards.length ?? 0)} />}
                </div>
              </div>

              <div className={`bj__player-zone${hand?.isSplit ? " bj__player-zone--split" : ""}`}>
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
                      <div className="bj__hand-head">
                        <span className="bj__hand-label">
                          {hand?.isSplit ? `Hand ${index + 1}` : "You"}
                        </span>
                        <span className="bj__hand-total">{line.total || "—"}</span>
                        {line.doubled && <span className="bj__hand-tag">Doubled</span>}
                      </div>
                      <div className="bj__cards">
                        {line.cards.map((c, i) => (
                          <CardView key={`p-${index}-${i}`} card={c} index={i} />
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
        </section>

        <aside className="game-page__controls game-controls">
          <div className="game-page__balance">
            <span className="game-page__balance-label">Balance · {coinLabel}</span>
            <span className="game-page__balance-value">{formatCoins(activeBalance, coinType)}</span>
            <span className="game-page__balance-usd">{formatUsd(coinsToUsd(activeBalance, coinType))}</span>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="bj-wager">
              Bet amount · {coinLabel}
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
                  applyWager(Number.isFinite(parsed) ? parsed : 0.01);
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
                onClick={() => applyWager(wager * 2)}
                disabled={playing || busy}
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
                  disabled={playing || busy}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="game-controls__error" role="alert">{error}</p>}

          {!playing ? (
            <button
              type="button"
              className="game-controls__play"
              onClick={handleStart}
              disabled={busy || !user}
            >
              {busy ? "Dealing…" : showTable && settled ? "New hand" : "Deal"}
            </button>
          ) : insuranceOffer ? (
            <div className="bj__actions">
              <button
                type="button"
                className="game-controls__play"
                onClick={() => runAction("insurance", true)}
                disabled={busy || activeBalance < (hand?.insuranceAmount ?? 0)}
              >
                Insurance · {formatCoins(hand?.insuranceAmount ?? 0, coinType)}
              </button>
              <button
                type="button"
                className="bj__action-secondary"
                onClick={() => runAction("insurance", false)}
                disabled={busy}
              >
                No thanks
              </button>
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
                className="bj__action-btn"
                onClick={() => runAction("stand")}
                disabled={busy}
              >
                Stand
              </button>
              {hand?.canDouble && (
                <button
                  type="button"
                  className="bj__action-btn"
                  onClick={() => runAction("double")}
                  disabled={busy || activeBalance < (hand?.wager ?? 0)}
                >
                  Double
                </button>
              )}
              {hand?.canSplit && (
                <button
                  type="button"
                  className="bj__action-btn"
                  onClick={() => runAction("split")}
                  disabled={busy || activeBalance < (hand?.wager ?? 0)}
                >
                  Split
                </button>
              )}
            </div>
          )}

          {settled && lastMessage && (
            <div className="game-controls__stats">
              <div className="game-controls__stat-row">
                <span className="game-controls__stat-label">Last hand</span>
                <span
                  className={`game-controls__stat-value${
                    hand?.outcome === "win" || hand?.outcome === "blackjack"
                      ? " game-controls__stat-value--win"
                      : hand?.outcome === "push"
                        ? ""
                        : " game-controls__stat-value--loss"
                  }`}
                >
                  {outcomeLabel(hand?.outcome)}
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
                  disabled={playing}
                />
              </div>
              <button
                type="button"
                className="game-page__fairness-save"
                onClick={async () => {
                  const { error: e } = await setBlackjackClientSeed(clientSeed);
                  if (e) setError(e);
                  else await loadPf();
                }}
                disabled={playing}
              >
                Save client seed
              </button>
              <p className="game-page__fairness-note">
                Fisher-Yates shuffle from HMAC-SHA256 (Stake card order).
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
