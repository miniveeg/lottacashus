import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { LcSelect } from "../../components/LcSelect/LcSelect";
import {
  getPaytableRow,
  KENO_RISKS,
  type KenoRisk,
} from "../../lib/games/keno";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
import { fetchKenoPfState, placeKenoBet, setKenoClientSeed } from "../../lib/keno";
import "../../styles/game-controls.css";
import "./Keno.css";

const GRID_SIZE = 40;
const MAX_PICKS = 10;
const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];
const REVEAL_STAGGER_MS = 110;

function randomPick(count: number): number[] {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

export function Keno() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [risk, setRisk] = useState<KenoRisk>("classic");
  const [selected, setSelected] = useState<number[]>([]);
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<number[] | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  const [lastResult, setLastResult] = useState<{
    hits: number;
    multiplier: number;
    payout: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");

  const pickCount = selected.length;
  const paytable = useMemo(
    () => (pickCount > 0 ? getPaytableRow(pickCount, risk) : []),
    [pickCount, risk]
  );

  const activeBalance =
    coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);

  const loadPf = useCallback(async () => {
    const { data, error: pfErr } = await fetchKenoPfState();
    if (pfErr) return;
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  useEffect(() => {
    if (user) loadPf();
  }, [user, loadPf]);

  const toggleNumber = (n: number) => {
    if (drawing) return;
    setError(null);
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const clearTable = () => {
    if (drawing) return;
    setSelected([]);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    setError(null);
  };

  const autoPick = () => {
    if (drawing) return;
    const count = pickCount > 0 ? pickCount : 10;
    setSelected(randomPick(Math.min(count, MAX_PICKS)));
    setDrawn(null);
    setLastResult(null);
  };

  const applyWager = (value: number) => {
    const v = Math.max(0.01, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const handleBet = async () => {
    if (!user) {
      setError("Log in to play.");
      return;
    }
    if (selected.length < 1) {
      setError("Select at least one number.");
      return;
    }
    if (wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setDrawing(true);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);

    const { data, error: betErr } = await placeKenoBet({
      wager,
      picks: selected,
      risk,
      coinType,
    });

    if (betErr || !data) {
      setDrawing(false);
      setError(betErr ?? "Bet failed.");
      return;
    }

    setDrawn(data.drawn);
    data.drawn.forEach((_, i) => {
      window.setTimeout(() => {
        setRevealCount(i + 1);
        if (i === data.drawn.length - 1) {
          setLastResult({
            hits: data.hits,
            multiplier: data.multiplier,
            payout: data.payout,
          });
          setDrawing(false);
          setPfNonce(data.nonce + 1);
          void refreshProfile();
          void loadPf();
        }
      }, (i + 1) * REVEAL_STAGGER_MS);
    });
  };

  const saveClientSeed = async () => {
    const { error: seedErr } = await setKenoClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else await loadPf();
  };

  const drawnSet = drawn ? new Set(drawn.slice(0, revealCount)) : null;
  const selectedSet = new Set(selected);
  const revealComplete = drawn !== null && revealCount >= drawn.length;

  return (
    <div className="game-page keno">
      <header className="game-header">
        <h1 className="game-header__title">Keno</h1>
        <span className="game-header__rtp">94.5% RTP</span>
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
        <div className="keno__toolbar">
          <span className="keno__pick-count">
            <strong>{pickCount}</strong>/{MAX_PICKS} selected
          </span>
          <div className="keno__toolbar-actions">
            <button
              type="button"
              className="keno__tool-btn"
              onClick={autoPick}
              disabled={drawing}
            >
              Auto Pick
            </button>
            <button
              type="button"
              className="keno__tool-btn"
              onClick={clearTable}
              disabled={drawing}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="keno__grid" role="group" aria-label="Keno number grid">
          {Array.from({ length: GRID_SIZE }, (_, i) => i + 1).map((n) => {
            const isSelected = selectedSet.has(n);
            const isDrawn = drawnSet?.has(n);
            const isHit = isSelected && isDrawn;
            return (
              <button
                key={n}
                type="button"
                className={[
                  "keno__cell",
                  isSelected && "keno__cell--selected",
                  isDrawn && "keno__cell--drawn",
                  isHit && "keno__cell--hit",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => toggleNumber(n)}
                disabled={drawing}
                aria-pressed={isSelected}
              >
                <span>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {panelOpen && (
        <div className="game-panel" role="complementary" aria-label="Keno stats">
          <div className="game-panel__head">
            <h2 className="game-panel__title">Round info</h2>
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

          {lastResult && drawn && (
            <div className="game-panel__section">
              <h3 className="game-panel__section-title">Last result</h3>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Hits</span>
                <span className="game-panel__row-value game-panel__row-value--gold">
                  {lastResult.hits} · {lastResult.multiplier}×
                </span>
              </div>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Payout</span>
                <span
                  className={`game-panel__row-value${
                    lastResult.payout > 0
                      ? " game-panel__row-value--win"
                      : " game-panel__row-value--loss"
                  }`}
                >
                  {lastResult.payout > 0
                    ? formatCoins(lastResult.payout, coinType)
                    : "No win"}
                </span>
              </div>
            </div>
          )}

          {pickCount > 0 && (
            <div className="game-panel__section">
              <button
                type="button"
                className="keno__paytable-toggle"
                aria-expanded={showPaytable}
                onClick={() => setShowPaytable((v) => !v)}
              >
                <span>Payouts · {pickCount} picks · {risk}</span>
                <span className="keno__paytable-toggle-icon" aria-hidden>▾</span>
              </button>
              {showPaytable && (
                <div className="keno__paytable">
                  {paytable.map((mult, hits) => (
                    <div
                      key={hits}
                      className={[
                        "keno__paytable-cell",
                        lastResult?.hits === hits && drawn && "keno__paytable-cell--active",
                        mult > 0 && "keno__paytable-cell--pays",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="keno__paytable-hits">{hits}</span>
                      <span className="keno__paytable-mult">
                        {mult > 0 ? `${mult}×` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="game-panel__section game-panel__section--bare">
            <details className="game-fair">
              <summary className="game-fair__summary">Provably Fair</summary>
              <div className="game-fair__body">
                <div className="game-fair__row">
                  <span className="game-fair__k">Server seed (hash)</span>
                  <code className="game-fair__code">{pfHash ?? "…"}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Next nonce</span>
                  <code className="game-fair__code">{pfNonce}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Client seed</span>
                  <input
                    type="text"
                    className="game-fair__input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="game-fair__save"
                  onClick={saveClientSeed}
                >
                  Save client seed
                </button>
                <p className="game-fair__note">
                  Draws use HMAC-SHA256 with Fisher-Yates selection (Stake Keno).
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

        <LcSelect
          className="game-actionbar__select"
          value={risk}
          options={KENO_RISKS}
          onChange={setRisk}
          disabled={drawing}
          aria-label="Keno risk level"
        />

        <div className="game-actionbar__wager">
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager / 2)}
            disabled={drawing}
            aria-label="Half bet"
          >
            ½
          </button>
          <input
            id="keno-wager"
            type="text"
            inputMode="decimal"
            className="game-actionbar__input"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            onBlur={() => {
              const parsed = parseFloat(wagerInput.replace(/,/g, ""));
              applyWager(Number.isFinite(parsed) ? parsed : 0.01);
            }}
            disabled={drawing}
            aria-label="Bet amount"
          />
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager * 2)}
            disabled={drawing}
            aria-label="Double bet"
          >
            2×
          </button>
        </div>

        <div className="game-actionbar__presets">
          {BET_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`game-actionbar__preset${wager === p ? " game-actionbar__preset--active" : ""}`}
              onClick={() => applyWager(p)}
              disabled={drawing}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="game-actionbar__play"
          onClick={handleBet}
          disabled={drawing || pickCount < 1 || !user}
          aria-busy={drawing}
        >
          {drawing ? (revealComplete ? "Done…" : "Drawing…") : "Play"}
        </button>

        {error && <p className="game-actionbar__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
