/**
 * Case Battles v2 — Create battle (Diceblox-style)
 * - "Add Cases" button opens a modal picker
 * - Currency follows the global usePlayMode() (topbar GC/SC toggle).
 *   Previously had its own local coinType state + GC/SC toggle that
 *   duplicated the global one and could drift out of sync with the
 *   user's actual selected currency. Removed in audit v4.
 * - Mode dropdown + Crazy toggle + Borrow toggle + game type buttons.
 */

import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { createCaseBattle } from "./caseBattlesApi";
import { GAMEMODES, playerModeOptions, type BattleGamemode } from "./types";
import { CASE_CATALOG, getCaseById } from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import { entryAfterBorrow } from "../../lib/games/case-battles/config";
import { Plus, X, Search, ChevronDown, Info } from "lucide-react";
import "./CaseBattlesV2.css";

type SortKey = "popular" | "price-high" | "price-low" | "newest";

export function CaseBattlesCreateV2() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();
  const [gamemode, setGamemode] = useState<BattleGamemode>("standard");
  const [crazy, setCrazy] = useState(false);
  const [playerMode, setPlayerMode] = useState("1v1");
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [borrowPercent, setBorrowPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showCaseModal, setShowCaseModal] = useState(false);

  // Modal state
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

  // The currency the create-flow uses is now identical to the user's
  // selected currency — switching in the topbar immediately retargets
  // the balance check, prize labels, and entry cost.
  const balance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
  const entryCost = useMemo(
    () => caseIds.reduce((sum, id) => sum + (getCaseById(id)?.price ?? 0), 0),
    [caseIds],
  );
  const actualEntry = entryAfterBorrow(entryCost, borrowPercent);
  const canCreate = caseIds.length >= 1 && caseIds.length <= 50 && actualEntry <= balance && !busy;

  const pModes = playerModeOptions(gamemode);
  const canBeCrazy = GAMEMODES.find((g) => g.id === gamemode)?.canBeCrazy ?? false;

  const sortedCases = useMemo(() => {
    let list = [...CASE_CATALOG];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    switch (sort) {
      case "price-high": list.sort((a, b) => b.price - a.price); break;
      case "price-low": list.sort((a, b) => a.price - b.price); break;
      case "newest": list.reverse(); break;
      default: break; // popular = catalog order
    }
    return list;
  }, [search, sort]);

  function addCase(id: string) {
    setCaseIds((prev) => {
      if (prev.length >= 50) return prev;
      return [...prev, id];
    });
  }

  function removeLastCase(): void {
    setCaseIds((prev) => prev.slice(0, -1));
  }

  function removeAtIndex(index: number): void {
    setCaseIds((prev) => prev.filter((_, i) => i !== index));
  }

  function clearCases() {
    setCaseIds([]);
  }

  async function handleCreate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } = await createCaseBattle({
      gamemode,
      crazy: crazy && canBeCrazy,
      playerMode,
      caseIds,
      entryCost,
      coinType,
      borrowPercent,
    });
    busyRef.current = false;
    setBusy(false);
    if (err) {
      setError(err);
    } else if (data) {
      navigate(`/case-battles/${data}`);
    }
  }

  // Group identical case IDs for the active-battle strip — a player who
  // adds "Phoenix Case" twice sees one tile with a ×2 badge instead of two
  // identical tiles eating visual space.
  const groupedCases = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of caseIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return Array.from(counts.entries()).map(([id, count]) => ({ id, count }));
  }, [caseIds]);

  return (
    <div className="cb-create lc-page">
      <Seo title="Create Case Battle" path="/case-battles/create" noindex />

      {/* Top bar: exit + title */}
      <div className="cb-create__topbar">
        <button type="button" className="cb-create__exit" onClick={() => navigate("/case-battles")}>
          ← Exit
        </button>
        <h1 className="cb-create__title">Create Battle</h1>
        <span
          className={`cb-room__coin-badge cb-create__currency-badge cb-room__coin-badge--${coinType}`}
          aria-label={`Playing in ${coinLabel}`}
        >
          {coinLabel}
        </span>
      </div>

      {/* Currency notice: linkable to the topbar toggle so confused users */}
      <p className="cb-create__currency-note">
        <Info size={14} aria-hidden />
        Creating in <strong>{coinLabel}</strong>. Switch in the topbar to use the other balance.
      </p>

      {/* Settings bar */}
      <div className="cb-create__settings">
        {/* Player mode dropdown */}
        <div className="cb-create__setting">
          <label>Mode</label>
          <div className="cb-create__dropdown">
            <select value={playerMode} onChange={(e) => setPlayerMode(e.target.value)}>
              {pModes.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </div>
        </div>

        {/* Game type buttons */}
        <div className="cb-create__setting">
          <label>Type</label>
          <div className="cb-create__types">
            {GAMEMODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={"cb-type-btn" + (gamemode === mode.id ? " cb-type-btn--active" : "")}
                onClick={() => {
                  setGamemode(mode.id);
                  if (!mode.canBeCrazy) setCrazy(false);
                  const opts = playerModeOptions(mode.id);
                  if (!opts.find((o) => o.id === playerMode)) setPlayerMode(opts[0]!.id);
                }}
                title={mode.description}
              >
                {mode.icon} {mode.name}
              </button>
            ))}
          </div>
        </div>

        {/* Crazy toggle */}
        {canBeCrazy && (
          <div className="cb-create__setting">
            <label>Crazy</label>
            <button
              type="button"
              className={"cb-toggle" + (crazy ? " cb-toggle--on" : "")}
              onClick={() => setCrazy(!crazy)}
              aria-pressed={crazy}
            >
              <span className="cb-toggle__knob" />
            </button>
          </div>
        )}

        {/* Borrow toggle */}
        <div className="cb-create__setting">
          <label>Borrow</label>
          <button
            type="button"
            className={"cb-toggle" + (borrowPercent > 0 ? " cb-toggle--on" : "")}
            onClick={() => setBorrowPercent(borrowPercent > 0 ? 0 : 50)}
            aria-pressed={borrowPercent > 0}
            aria-label={`Borrow toggle, currently ${borrowPercent > 0 ? "on at " + borrowPercent + " percent" : "off"}`}
          >
            <span className="cb-toggle__knob" />
          </button>
          {borrowPercent > 0 && (
            <span className="cb-create__borrow-pct">{borrowPercent}%</span>
          )}
        </div>
      </div>

      {/* Case area */}
      <div className="cb-create__case-area">
        {groupedCases.length === 0 ? (
          <button type="button" className="cb-create__add-cases-btn" onClick={() => setShowCaseModal(true)}>
            <Plus size={24} />
            <span>Add Cases</span>
          </button>
        ) : (
          <>
            <div className="cb-create__case-list-header">
              <span>
                <strong>{caseIds.length}</strong> case{caseIds.length === 1 ? "" : "s"} · {formatCoins(entryCost, coinType)}
              </span>
              <div className="cb-create__case-list-actions">
                <button type="button" className="cb-create__small-btn" onClick={() => setShowCaseModal(true)} aria-label="Add more cases">
                  + Add more
                </button>
                <button type="button" className="cb-create__small-btn cb-create__small-btn--ghost" onClick={removeLastCase} aria-label="Undo last added case" disabled={caseIds.length === 0}>
                  Undo
                </button>
                <button type="button" className="cb-create__small-btn cb-create__small-btn--danger" onClick={clearCases} aria-label="Clear all cases">
                  Clear
                </button>
              </div>
            </div>
            <div className="cb-create__case-grid">
              {groupedCases.map(({ id, count }) => {
                const c = getCaseById(id);
                return (
                  <div
                    key={id}
                    className="cb-create__case-thumb-card"
                    style={{ borderColor: c?.accent ?? "var(--lc-border)" }}
                    title={c?.name}
                  >
                    <div
                      className="cb-create__case-thumb-bg"
                      style={{ background: c?.accent ?? "var(--lc-bg-active)" }}
                      aria-hidden
                    >
                      {c?.name.charAt(0).toUpperCase() ?? "?"}
                    </div>
                    <div className="cb-create__case-thumb-meta">
                      <span className="cb-create__case-thumb-name">{c?.name ?? id}</span>
                      <span className="cb-create__case-thumb-price">{formatCoins(c?.price ?? 0, coinType)}</span>
                    </div>
                    {count > 1 && <span className="cb-create__case-thumb-count" aria-label={`${count} of this case`}>×{count}</span>}
                    <button
                      type="button"
                      className="cb-create__case-thumb-remove"
                      onClick={() => removeAtIndex(caseIds.lastIndexOf(id))}
                      aria-label={`Remove one ${c?.name ?? id}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Bottom: summary + create button */}
      <div className="cb-create__bottom">
        <div className="cb-create__summary-bar">
          <div className="cb-create__summary-item">
            <span className="cb-create__summary-label">Entry</span>
            <span className="cb-create__summary-value">{formatCoins(actualEntry, coinType)}</span>
          </div>
          <div className="cb-create__summary-item">
            <span className="cb-create__summary-label">Balance</span>
            <span className="cb-create__summary-value">{formatCoins(balance, coinType)}</span>
          </div>
          <div className="cb-create__summary-item">
            <span className="cb-create__summary-label">Cases</span>
            <span className="cb-create__summary-value">{caseIds.length}/50</span>
          </div>
        </div>
        {error && <p className="cb-create__error" role="alert">{error}</p>}
        {actualEntry > balance && <p className="cb-create__error">Insufficient {coinLabel} balance</p>}
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-create__submit"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {busy ? "Creating…" : `Create Battle (${formatCoins(actualEntry, coinType)})`}
        </button>
      </div>

      {/* Case picker modal */}
      {showCaseModal && (
        <div className="cb-modal-overlay" onClick={() => setShowCaseModal(false)}>
          <div className="cb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cb-modal__header">
              <h2>Add Cases</h2>
              <button type="button" className="cb-modal__close" onClick={() => setShowCaseModal(false)} aria-label="Close case picker">
                <X size={20} />
              </button>
            </div>
            <div className="cb-modal__controls">
              <div className="cb-modal__search">
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  placeholder="Search cases…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="cb-modal__sort">
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort cases">
                  <option value="popular">Most Popular</option>
                  <option value="price-high">Highest Price</option>
                  <option value="price-low">Lowest Price</option>
                  <option value="newest">Newest</option>
                </select>
                <ChevronDown size={14} aria-hidden />
              </div>
            </div>
            <div className="cb-modal__grid">
              {sortedCases.slice(0, 200).map((lootCase) => {
                const count = caseIds.filter((id) => id === lootCase.id).length;
                return (
                  <button
                    key={lootCase.id}
                    type="button"
                    className={"cb-modal__case-card" + (count > 0 ? " cb-modal__case-card--selected" : "")}
                    onClick={() => addCase(lootCase.id)}
                    disabled={caseIds.length >= 50}
                  >
                    {count > 0 && <span className="cb-modal__case-count">{count}</span>}
                    <div className="cb-modal__case-thumb" style={{ background: lootCase.accent ?? "var(--lc-bg-active)" }}>
                      {lootCase.name.charAt(0)}
                    </div>
                    <span className="cb-modal__case-name">{lootCase.name}</span>
                    <span className="cb-modal__case-price">{formatCoins(lootCase.price, coinType)}</span>
                    <span className="cb-modal__case-add">+ Add</span>
                  </button>
                );
              })}
            </div>
            <div className="cb-modal__footer">
              <div className="cb-modal__footer-info">
                <span>{caseIds.length} cases</span>
                <span className="cb-modal__footer-total">{formatCoins(entryCost, coinType)}</span>
              </div>
              <div className="cb-modal__footer-actions">
                <button type="button" className="cb-btn cb-btn--ghost" onClick={() => setShowCaseModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="cb-btn cb-btn--primary"
                  onClick={() => setShowCaseModal(false)}
                  disabled={caseIds.length === 0}
                >
                  Add Cases ({caseIds.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
