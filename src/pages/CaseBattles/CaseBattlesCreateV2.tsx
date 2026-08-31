/**
 * Case Battles v2 — Create battle
 */
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { useCanPlay } from "../../lib/canPlay";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import { useAuth } from "../../contexts/AuthContext";
import { createCaseBattle } from "./caseBattlesApi";
import { GAMEMODES, playerModeOptions, type BattleGamemode } from "./types";
import { CASE_CATALOG, getCaseById } from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import { getActiveBalance } from "../../lib/gameWallet";
import { entryAfterBorrow } from "../../lib/games/case-battles/config";
import { Plus, Minus, X, Search, ChevronDown, Info, GripVertical } from "lucide-react";
import "./CaseBattlesV2.css";

type SortMode = "price-low" | "price-high" | "custom";
type CaseGroup = { id: string; count: number };

const MAX_GROUPS = 50;
const MAX_COUNT_PER_GROUP = 10;

export function CaseBattlesCreateV2() {
  const navigate = useNavigate();
  const canPlay = useCanPlay();
  const { user, isGuest } = useAuth();
  const { profile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();
  const [gamemode, setGamemode] = useState<BattleGamemode>("standard");
  const [crazy, setCrazy] = useState(false);
  const [playerMode, setPlayerMode] = useState("1v1");
  const [groups, setGroups] = useState<CaseGroup[]>([]);
  const [borrowPercent, setBorrowPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [search, setSearch] = useState("");
  const [modalSort, setModalSort] = useState<"price-low" | "price-high" | "popular">("popular");

  const balance = getActiveBalance(profile);
  const entryCost = useMemo(
    () => groups.reduce((s, g) => s + (getCaseById(g.id)?.price ?? 0) * g.count, 0),
    [groups],
  );
  const actualEntry = entryAfterBorrow(entryCost, borrowPercent);
  const totalRounds = useMemo(() => groups.reduce((s, g) => s + g.count, 0), [groups]);
  const canCreate =
    canPlay && totalRounds >= 1 && totalRounds <= 50 && actualEntry <= balance && !busy;

  const pModes = playerModeOptions(gamemode);
  const canBeCrazy = GAMEMODES.find((g) => g.id === gamemode)?.canBeCrazy ?? false;

  const orderedGroups = useMemo<CaseGroup[]>(() => {
    if (sortMode === "custom") return groups;
    const enriched = groups.map((g) => ({ ...g, _price: getCaseById(g.id)?.price ?? 0 }));
    enriched.sort((a, b) => (sortMode === "price-low" ? a._price - b._price : b._price - a._price));
    return enriched.map(({ id, count }) => ({ id, count }));
  }, [groups, sortMode]);

  const sortedCases = useMemo(() => {
    let list = [...CASE_CATALOG];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    switch (modalSort) {
      case "price-high": list.sort((a, b) => b.price - a.price); break;
      case "price-low":  list.sort((a, b) => a.price - b.price);  break;
      default: break;
    }
    return list;
  }, [search, modalSort]);

  const incrementGroup = useCallback((caseId: string) => {
    setGroups((prev) => {
      if (prev.reduce((s, g) => s + g.count, 0) >= 50) return prev;
      const idx = prev.findIndex((g) => g.id === caseId);
      if (idx >= 0) {
        const next = [...prev];
        if (next[idx]!.count >= MAX_COUNT_PER_GROUP) return prev;
        next[idx] = { id: caseId, count: next[idx]!.count + 1 };
        return next;
      }
      if (prev.length >= MAX_GROUPS) return prev;
      return [...prev, { id: caseId, count: 1 }];
    });
  }, []);

  const decrementGroup = useCallback((caseId: string) => {
    setGroups((prev) => {
      const idx = prev.findIndex((g) => g.id === caseId);
      if (idx < 0) return prev;
      const next = [...prev];
      const remaining = next[idx]!.count - 1;
      if (remaining <= 0) next.splice(idx, 1);
      else next[idx] = { id: caseId, count: remaining };
      return next;
    });
  }, []);

  const clearAll = () => setGroups([]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    if (sortMode !== "custom") {
      e.preventDefault();
      return;
    }
    setDragIndex(idx);
    dragIndexRef.current = idx;
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    if (sortMode !== "custom" || dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (idx !== dropTargetIndex) setDropTargetIndex(idx);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    dragIndexRef.current = null;
    setDropTargetIndex(null);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIdx: number) => {
    e.preventDefault();
    const src = dragIndexRef.current;
    if (src == null || src === dropIdx) {
      handleDragEnd();
      return;
    }
    setSortMode("custom");
    setGroups((prev) => {
      const next = [...prev];
      const [moved] = next.splice(src, 1);
      next.splice(dropIdx > src ? dropIdx - 1 : dropIdx, 0, moved!);
      return next;
    });
    handleDragEnd();
  };

  async function handleCreate() {
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const flatCaseIds = orderedGroups.flatMap((g) => Array(g.count).fill(g.id));
    const { data, error: err } = await createCaseBattle({
      gamemode,
      crazy: crazy && canBeCrazy,
      playerMode,
      caseIds: flatCaseIds,
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

  const busyRefRead = busyRef;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      const k = e.key.toLowerCase();
      if (k === "escape" && showCaseModal) {
        e.preventDefault();
        setShowCaseModal(false);
        return;
      }
      if (onTextInput) return;
      if (k === "e" && !showCaseModal && !busyRefRead.current) {
        e.preventDefault();
        setShowCaseModal(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "enter") {
        e.preventDefault();
        if (!busyRefRead.current && canCreate) {
          void handleCreate();
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCaseModal, canCreate]);

  return (
    <div className="cb-create lc-page">
      <Seo title="Create Case Battle" path="/case-battles/create" noindex />

      <div className="cb-create__topbar">
        <button type="button" className="cb-create__exit" onClick={() => navigate("/case-battles")}>
          ← Exit
        </button>
        <h1 className="cb-create__title">Create battle</h1>
      </div>

      <p className="cb-create__currency-note">
        <Info size={14} aria-hidden />
        Entry comes off your <strong>{coinLabel}</strong> stack.
      </p>

      {orderedGroups.length === 0 && (
        <p className="cb-create__press-to-add" role="note">
          {canPlay ? (
            <>
              Tap <strong>Add Cases</strong> or press <kbd>E</kbd> to begin
            </>
          ) : (
            <>Log in to create a battle</>
          )}
        </p>
      )}

      <div className="cb-create__settings">
        <div className="cb-create__setting">
          <label htmlFor="cb-create-mode">Mode</label>
          <div className="cb-create__dropdown">
            <select id="cb-create-mode" value={playerMode} onChange={(e) => setPlayerMode(e.target.value)} disabled={!canPlay}>
              {pModes.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </div>
        </div>
        <div className="cb-create__setting">
          <label>Type</label>
          <div className="cb-create__types">
            {GAMEMODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={"cb-type-btn" + (gamemode === mode.id ? " cb-type-btn--active" : "")}
                disabled={!canPlay}
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
        {canBeCrazy && (
          <div className="cb-create__setting">
            <label>Crazy</label>
            <button
              type="button"
              className={"cb-toggle" + (crazy ? " cb-toggle--on" : "")}
              onClick={() => setCrazy(!crazy)}
              disabled={!canPlay}
              aria-pressed={crazy}
            >
              <span className="cb-toggle__knob" />
            </button>
          </div>
        )}
        <div className="cb-create__setting">
          <label>Borrow</label>
          <button
            type="button"
            className={"cb-toggle" + (borrowPercent > 0 ? " cb-toggle--on" : "")}
            onClick={() => setBorrowPercent(borrowPercent > 0 ? 0 : 50)}
            disabled={!canPlay}
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

      <div className="cb-create__case-area">
        {orderedGroups.length === 0 ? (
          <button type="button" className="cb-create__add-cases-btn" onClick={() => setShowCaseModal(true)} disabled={!canPlay}>
            <Plus size={24} />
            <span>Add Cases</span>
          </button>
        ) : (
          <>
            <div className="cb-create__case-list-header">
              <span>
                <strong>{totalRounds}</strong> round{totalRounds === 1 ? "" : "s"} · {orderedGroups.length} type{orderedGroups.length === 1 ? "" : "s"} · {formatCoins(entryCost, coinType)}
              </span>
              <div className="cb-create__case-list-actions">
                <button type="button" className="cb-create__small-btn" onClick={() => setShowCaseModal(true)} aria-label="Add more cases">
                  + Add more
                </button>
                <button type="button" className="cb-create__small-btn cb-create__small-btn--danger" onClick={clearAll} aria-label="Clear all cases">
                  Clear
                </button>
              </div>
            </div>

            <div className="cb-create__order-bar">
              <span className="cb-create__order-label">Order:</span>
              {(["price-low", "price-high", "custom"] as SortMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={"cb-create__order-btn" + (sortMode === m ? " cb-create__order-btn--active" : "")}
                  onClick={() => setSortMode(m)}
                >
                  {m === "price-low" ? "Cheapest → Most expensive" : m === "price-high" ? "Most expensive → Cheapest" : "Custom (drag)"}
                </button>
              ))}
            </div>

            <div
              className={
                "cb-create__case-grid" +
                (sortMode === "custom" ? " cb-create__case-grid--sortable" : "")
              }
              role="list"
              aria-label="Selected case groups"
            >
              {orderedGroups.map((g, idx) => {
                const c = getCaseById(g.id);
                const isDragSrc = dragIndex === idx;
                const isDropTarget = dropTargetIndex === idx && dragIndex !== null && dragIndex !== idx;
                return (
                  <div
                    key={g.id}
                    role="listitem"
                    draggable={sortMode === "custom"}
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={
                      "cb-create__case-thumb-card" +
                      (isDragSrc ? " cb-create__case-thumb-card--dragging" : "") +
                      (isDropTarget ? " cb-create__case-thumb-card--drop-target" : "")
                    }
                    style={{ borderColor: c?.accent ?? "var(--lc-border)" }}
                  >
                    {sortMode === "custom" && (
                      <span className="cb-create__case-thumb-drag" aria-hidden title="Drag to reorder">
                        <GripVertical size={12} />
                      </span>
                    )}
                    <div
                      className="cb-create__case-thumb-bg"
                      style={{ background: c?.accent ?? "var(--lc-bg-active)" }}
                      aria-hidden
                    >
                      {c?.name?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div className="cb-create__case-thumb-meta">
                      <span className="cb-create__case-thumb-name">{c?.name ?? g.id}</span>
                      <span className="cb-create__case-thumb-price">{formatCoins(c?.price ?? 0, coinType)}</span>
                    </div>
                    <div className="cb-create__case-thumb-counter" aria-label={`Quantity ${g.count}`}>
                      <button type="button" className="cb-create__counter-btn" onClick={() => decrementGroup(g.id)} aria-label={`Remove one ${c?.name ?? g.id}`}>
                        <Minus size={10} aria-hidden />
                      </button>
                      <span className="cb-create__counter-value">×{g.count}</span>
                      <button type="button" className="cb-create__counter-btn" onClick={() => incrementGroup(g.id)} aria-label={`Add one more ${c?.name ?? g.id}`} disabled={g.count >= MAX_COUNT_PER_GROUP || totalRounds >= 50}>
                        <Plus size={10} aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

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
            <span className="cb-create__summary-value">{totalRounds}/50</span>
          </div>
        </div>
        {error && <p className="cb-create__error" role="alert">{error}</p>}
        {actualEntry > balance && canPlay && <p className="cb-create__error">Insufficient {coinLabel} balance</p>}
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-create__submit"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {!canPlay
            ? "Log in to create"
            : busy
              ? "Creating…"
              : `Create battle (${formatCoins(actualEntry, coinType)})`}
        </button>
        {!busy && canPlay && (
          <p className="cb-create__hotkey-hint" role="note">
            <kbd>E</kbd> add cases · <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> create
          </p>
        )}
      </div>

      {showCaseModal && (
        <div className="cb-modal-overlay" onClick={() => setShowCaseModal(false)} role="presentation">
          <div className="cb-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cb-picker-title">
            <div className="cb-modal__header">
              <h2 id="cb-picker-title">Add Cases</h2>
              <button type="button" className="cb-modal__close" onClick={() => setShowCaseModal(false)} aria-label="Close case picker">
                <X size={20} />
              </button>
            </div>
            <div className="cb-modal__controls">
              <div className="cb-modal__search">
                <Search size={16} aria-hidden />
                <input type="search" placeholder="Search cases…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search cases" />
              </div>
              <div className="cb-modal__sort">
                <select value={modalSort} onChange={(e) => setModalSort(e.target.value as typeof modalSort)} aria-label="Sort cases">
                  <option value="popular">Most Popular</option>
                  <option value="price-high">High → Low</option>
                  <option value="price-low">Low → High</option>
                </select>
                <ChevronDown size={14} aria-hidden />
              </div>
            </div>
            <div className="cb-modal__grid">
              {sortedCases.slice(0, 200).map((lootCase) => {
                const current = groups.find((g) => g.id === lootCase.id)?.count ?? 0;
                const atCap = current >= MAX_COUNT_PER_GROUP || totalRounds >= 50;
                return (
                  <div key={lootCase.id} className={"cb-modal__case-card" + (current > 0 ? " cb-modal__case-card--selected" : "")}>
                    {current > 0 && (
                      <span className="cb-modal__case-count" aria-label={`${current} selected`}>×{current}</span>
                    )}
                    <div className="cb-modal__case-thumb" style={{ background: lootCase.accent ?? "var(--lc-bg-active)" }}>
                      {lootCase.name?.charAt(0) ?? "?"}
                    </div>
                    <span className="cb-modal__case-name">{lootCase.name}</span>
                    <span className="cb-modal__case-price">{formatCoins(lootCase.price, coinType)}</span>
                    <div className="cb-modal__case-actions">
                      <button type="button" className="cb-modal__case-step-btn" onClick={() => decrementGroup(lootCase.id)} aria-label={`Remove one ${lootCase.name}`} disabled={current <= 0}>
                        <Minus size={10} aria-hidden />
                      </button>
                      <button type="button" className="cb-modal__case-step-btn cb-modal__case-step-btn--add" onClick={() => incrementGroup(lootCase.id)} aria-label={`Add one ${lootCase.name}`} disabled={atCap}>
                        <Plus size={10} aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="cb-modal__footer">
              <div className="cb-modal__footer-info">
                <span>
                  <strong>{totalRounds}</strong> round{totalRounds === 1 ? "" : "s"} · {groups.length} type{groups.length === 1 ? "" : "s"}
                </span>
                <span className="cb-modal__footer-total">{formatCoins(entryCost, coinType)}</span>
              </div>
              <div className="cb-modal__footer-actions">
                <button type="button" className="cb-btn cb-btn--ghost" onClick={() => setShowCaseModal(false)}>Close</button>
                <button type="button" className="cb-btn cb-btn--primary" onClick={() => setShowCaseModal(false)} disabled={groups.length === 0}>
                  Done ({totalRounds} rounds)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
