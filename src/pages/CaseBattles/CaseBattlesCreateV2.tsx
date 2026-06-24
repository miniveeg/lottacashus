/**
 * Case Battles v2 — Create battle
 * Pick gamemode, player mode, cases, borrow %.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { Seo } from "../../components/Seo/Seo";
import { createCaseBattle } from "./caseBattlesApi";
import { GAMEMODES, playerModeOptions, gamemodeLabelWithCrazy, type BattleGamemode } from "./types";
import { CASE_CATALOG, getCaseById } from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import { entryAfterBorrow } from "../../lib/games/case-battles/config";
import "./CaseBattlesV2.css";

export function CaseBattlesCreateV2() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const [gamemode, setGamemode] = useState<BattleGamemode>("standard");
  const [crazy, setCrazy] = useState(false);
  const [playerMode, setPlayerMode] = useState("1v1");
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [borrowPercent, setBorrowPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const balance = profile?.balance ?? 0;
  const entryCost = useMemo(
    () => caseIds.reduce((sum, id) => sum + (getCaseById(id)?.price ?? 0), 0),
    [caseIds],
  );
  const actualEntry = entryAfterBorrow(entryCost, borrowPercent);
  const canCreate = caseIds.length >= 1 && caseIds.length <= 50 && actualEntry <= balance && !busy;

  const pModes = playerModeOptions(gamemode);
  const canBeCrazy = GAMEMODES.find((g) => g.id === gamemode)?.canBeCrazy ?? false;

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CASE_CATALOG;
    return CASE_CATALOG.filter((c) => c.name.toLowerCase().includes(q));
  }, [search]);

  function toggleCase(id: string) {
    setCaseIds((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      if (prev.length >= 50) return prev;
      return [...prev, id];
    });
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createCaseBattle({
      gamemode,
      crazy: crazy && canBeCrazy,
      playerMode,
      caseIds,
      entryCost,
      borrowPercent,
    });
    setBusy(false);
    if (err) {
      setError(err);
    } else if (data) {
      navigate(`/case-battles/${data}`);
    }
  }

  return (
    <div className="cb-create lc-page">
      <Seo title="Create Case Battle" path="/case-battles/create" noindex />
      <header className="cb-create__header">
        <h1 className="cb-create__title">Create a battle</h1>
      </header>

      {/* Gamemode picker */}
      <section className="cb-create__section">
        <h2 className="cb-create__section-title">Game mode</h2>
        <div className="cb-create__modes">
          {GAMEMODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={"cb-mode-card" + (gamemode === mode.id ? " cb-mode-card--active" : "")}
              onClick={() => {
                setGamemode(mode.id);
                if (!mode.canBeCrazy) setCrazy(false);
                const opts = playerModeOptions(mode.id);
                if (!opts.find((o) => o.id === playerMode)) {
                  setPlayerMode(opts[0]!.id);
                }
              }}
            >
              <span className="cb-mode-card__icon">{mode.icon}</span>
              <span className="cb-mode-card__name">{mode.name}</span>
              <span className="cb-mode-card__desc">{mode.description}</span>
            </button>
          ))}
        </div>
        {/* Crazy toggle — only for Standard, Terminal, Jackpot (not Group) */}
        {canBeCrazy && (
          <button
            type="button"
            className={"cb-crazy-toggle" + (crazy ? " cb-crazy-toggle--active" : "")}
            onClick={() => setCrazy(!crazy)}
            aria-pressed={crazy}
          >
            <span className="cb-crazy-toggle__icon">🤪</span>
            <div className="cb-crazy-toggle__text">
              <span className="cb-crazy-toggle__label">Crazy Mode</span>
              <span className="cb-crazy-toggle__desc">
                {gamemode === "standard" && "Lowest total value wins"}
                {gamemode === "terminal" && "Lowest last round value wins"}
                {gamemode === "jackpot" && "Lowest pulled has highest win chance"}
              </span>
            </div>
          </button>
        )}
      </section>

      {/* Player mode picker */}
      <section className="cb-create__section">
        <h2 className="cb-create__section-title">Players</h2>
        <div className="cb-create__pmodes">
          {pModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={"cb-pmode" + (playerMode === mode.id ? " cb-pmode--active" : "")}
              onClick={() => setPlayerMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </section>

      {/* Case picker */}
      <section className="cb-create__section">
        <h2 className="cb-create__section-title">
          Cases ({caseIds.length}/50)
        </h2>
        <input
          type="search"
          className="cb-create__search"
          placeholder="Search cases…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="cb-create__case-grid">
          {filteredCases.slice(0, 100).map((lootCase) => {
            const count = caseIds.filter((id) => id === lootCase.id).length;
            return (
              <button
                key={lootCase.id}
                type="button"
                className={"cb-case-card" + (count > 0 ? " cb-case-card--selected" : "")}
                onClick={() => toggleCase(lootCase.id)}
              >
                {count > 0 && <span className="cb-case-card__count">{count}</span>}
                <span className="cb-case-card__name">{lootCase.name}</span>
                <span className="cb-case-card__price">${lootCase.price.toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Borrow slider */}
      <section className="cb-create__section">
        <h2 className="cb-create__section-title">Borrow</h2>
        <div className="cb-create__borrow">
          <input
            type="range"
            min="0"
            max="80"
            step="10"
            value={borrowPercent}
            onChange={(e) => setBorrowPercent(Number(e.target.value))}
          />
          <span className="cb-create__borrow-value">{borrowPercent}%</span>
          <p className="cb-create__borrow-hint">
            Borrow up to 80% of the entry cost. You keep only {100 - borrowPercent}% of winnings on the borrowed portion.
          </p>
        </div>
      </section>

      {/* Summary + create */}
      <section className="cb-create__summary">
        <div className="cb-create__summary-row">
          <span>Entry cost</span>
          <span>{formatCoins(entryCost, "balance")}</span>
        </div>
        <div className="cb-create__summary-row">
          <span>After borrow</span>
          <span>{formatCoins(actualEntry, "balance")}</span>
        </div>
        <div className="cb-create__summary-row">
          <span>Your balance</span>
          <span>{formatCoins(balance, "balance")}</span>
        </div>
        {actualEntry > balance && (
          <p className="cb-create__insufficient">Insufficient balance</p>
        )}
        {error && <p className="cb-create__error" role="alert">{error}</p>}
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-create__submit"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {busy ? "Creating…" : `Create battle (${formatCoins(actualEntry, "balance")})`}
        </button>
      </section>
    </div>
  );
}
