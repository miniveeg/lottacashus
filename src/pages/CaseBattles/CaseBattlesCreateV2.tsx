/**
 * Case Battles v2 — Create battle (Diceblox-style)
 *
 * UX model:
 *  - "Add Cases" button opens a modal picker with every case in the catalog.
 *  - Each modal card shows a +/- counter; identical cases live in a single
 *    GROUP with a ×count badge so that "5× Phoenix" is one chip, not five.
 *  - Grouped chips can be reordered in three modes:
 *      • Cheapest → Most expensive   (auto-sort by price, ascending)
 *      • Most expensive → Cheapest   (auto-sort by price, descending)
 *      • Custom                      (drag-and-drop)
 *  - Identity constraint: identical cases never interleave because each
 *    case is exactly ONE chip (its count is the multiplier on rounds).
 *  - "Add Case" increments the matching group count (cap 10/copy, 50/cases).
 *  - "Remove Case" decrements; if count hits 0 the chip disappears.
 *
 * The wire `caseIds` array is the run-length expanded flat list used by the
 * server (5× Phoenix → ["phoenix","phoenix",…,"phoenix"] of length 5). The
 * `rounds` count comes from this array's length.
 */
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { createCaseBattle } from "./caseBattlesApi";
import { GAMEMODES, playerModeOptions, type BattleGamemode } from "./types";
import { CASE_CATALOG, getCaseById } from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import { entryAfterBorrow } from "../../lib/games/case-battles/config";
import { Plus, Minus, X, Search, ChevronDown, Info, GripVertical } from "lucide-react";
import "./CaseBattlesV2.css";

type SortMode = "price-low" | "price-high" | "custom";
type CaseGroup = { id: string; count: number };

const MAX_GROUPS = 50;
const MAX_COUNT_PER_GROUP = 10;

export function CaseBattlesCreateV2() {
  const navigate = useNavigate();
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

  // ─── Modal-local state ───────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [modalSort, setModalSort] = useState<"price-low" | "price-high" | "popular">("popular");

  const balance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
  const entryCost = useMemo(
    () => groups.reduce((s, g) => s + (getCaseById(g.id)?.price ?? 0) * g.count, 0),
    [groups],
  );
  const actualEntry = entryAfterBorrow(entryCost, borrowPercent);
  const totalRounds = useMemo(() => groups.reduce((s, g) => s + g.count, 0), [groups]);
  const canCreate = totalRounds >= 1 && totalRounds <= 50 && actualEntry <= balance && !busy;

  const pModes = playerModeOptions(gamemode);
  const canBeCrazy = GAMEMODES.find((g) => g.id === gamemode)?.canBeCrazy ?? false;

  // ─── Effective order — either user-controlled (`custom`) or auto-sorted ─
  const orderedGroups = useMemo<CaseGroup[]>(() => {
    if (sortMode === "custom") return groups;
    const enriched = groups.map((g) => ({ ...g, _price: getCaseById(g.id)?.price ?? 0 }));
    enriched.sort((a, b) => (sortMode === "price-low" ? a._price - b._price : b._price - a._price));
    return enriched.map(({ id, count }) => ({ id, count }));
  }, [groups, sortMode]);

  // ─── Modal case list (search + sort, with selection count badges) ─────
  const sortedCases = useMemo(() => {
    let list = [...CASE_CATALOG];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    switch (modalSort) {
      case "price-high": list.sort((a, b) => b.price - a.price); break;
      case "price-low":  list.sort((a, b) => a.price - b.price);  break;
      default: break; // popular = catalog order
    }
    return list;
  }, [search, modalSort]);

  // ─── counter helpers ─────────────────────────────────────────────────
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

  // ─── Drag-and-drop reordering (native HTML5 DnD) ──────────────────────
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

  // ─── Submit → flatten groups to ordered caseIds, send to backend ──────
  async function handleCreate() {
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

  // Read-from-refs variants so the hotkey handler (registered once with
  // [] deps) doesn't capture stale first-render state when the user adjusts
  // groups/types/wager/etc. via the controls before pressing the shortcut.
  const gamemodeRef = useRef<BattleGamemode>("standard");
  gamemodeRef.current = gamemode;
  const playerModeRef = useRef<string>("1v1");
  playerModeRef.current = playerMode;
  const busyRefRead = busyRef;

  // Keyboard hotkeys:
  //   E       → open the case picker modal (idle only)
  //   Esc     → close the case picker modal (when modal is open)
  //   Ctrl/⌘+Enter → submit (only valid when canCreate)
  // Focus + modifier guards prevent stealing input from text fields or
  // conflicts with browser shortcuts (Ctrl+Enter is a browser submit in
  // form contexts — we explicitly check e.preventDefault on the keyboard
  // path to avoid duplicate submits).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      // Note: SELECT bail not enforced — the case picker sort dropdown
      // is a <select> and Esc-to-close on it could conflict. We keep
      // Esc-to-close scoped to the modal (handled inside the modal below).
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
      // Ctrl/Cmd+Enter → submit. ctrlKey catches BOTH Ctrl (Windows/Linux)
      // and Cmd (mac) since browsers fire `metaKey` for Cmd — we check
      // either to support cross-platform. Without ctrl/meta the Enter
      // keystroke is intentionally NOT bound to create (Enter inside a
      // <select> or any other focusable would cause submits).
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
        <h1 className="cb-create__title">Create Battle</h1>
        <span
          className={`cb-room__coin-badge cb-create__currency-badge cb-room__coin-badge--${coinType}`}
          aria-label={`Playing in ${coinLabel}`}
        >
          {coinLabel}
        </span>
      </div>

      <p className="cb-create__currency-note">
        <Info size={14} aria-hidden />
        Creating in <strong>{coinLabel}</strong>. Switch in the topbar to use the other balance.
      </p>

      {/* Phase polish: contextual idle hint shown when no cases are picked
          yet and the player hasn't typed in any control. Stays out of the
          way once the user has focus on the type/toggle. */}
      {orderedGroups.length === 0 && (
        <p className="cb-create__press-to-add" role="note">
          Tap <strong>Add Cases</strong> or press <kbd>E</kbd> to begin
        </p>
      )}

      {/* ── Settings bar (mode / type / crazy / borrow) ────────────── */}
      <div className="cb-create__settings">
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

      {/* ── Case area: drop zone + grouped chip list with DnD ───── */}
      <div className="cb-create__case-area">
        {orderedGroups.length === 0 ? (
          <button type="button" className="cb-create__add-cases-btn" onClick={() => setShowCaseModal(true)}>
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

            {/* Order selector — switches between custom (DnD) and auto-sorted. */}
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
              {sortMode !== "custom" && (
                <span className="cb-create__order-hint">
                  Switch to Custom to drag-and-drop reorder
                </span>
              )}
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
                      <button
                        type="button"
                        className="cb-create__counter-btn"
                        onClick={() => decrementGroup(g.id)}
                        aria-label={`Remove one ${c?.name ?? g.id}`}
                      >
                        <Minus size={10} aria-hidden />
                      </button>
                      <span className="cb-create__counter-value">×{g.count}</span>
                      <button
                        type="button"
                        className="cb-create__counter-btn"
                        onClick={() => incrementGroup(g.id)}
                        aria-label={`Add one more ${c?.name ?? g.id}`}
                        disabled={g.count >= MAX_COUNT_PER_GROUP || totalRounds >= 50}
                      >
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

      {/* ── Summary bar + submit ─────────────────────────────────── */}
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
        {actualEntry > balance && <p className="cb-create__error">Insufficient {coinLabel} balance</p>}
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-create__submit"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {busy ? "Creating…" : `Create Battle (${formatCoins(actualEntry, coinType)})`}
        </button>
        {/* Phase polish: keyboard hint footer. Inside the bottom panel
            so it sits visually next to the submit button it describes. */}
        {!busy && (
          <p className="cb-create__hotkey-hint" role="note">
            <kbd>E</kbd> add cases · <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> create
          </p>
        )}
      </div>

      {/* ── Case picker modal ────────────────────────────────────── */}
      {showCaseModal && (
        <div
          className="cb-modal-overlay"
          onClick={() => setShowCaseModal(false)}
          role="presentation"
        >
          <div
            className="cb-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cb-picker-title"
          >
            <div className="cb-modal__header">
              <h2 id="cb-picker-title">Add Cases</h2>
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
                  <div
                    key={lootCase.id}
                    className={"cb-modal__case-card" + (current > 0 ? " cb-modal__case-card--selected" : "")}
                  >
                    {current > 0 && (
                      <span className="cb-modal__case-count" aria-label={`${current} selected`}>×{current}</span>
                    )}
                    <div className="cb-modal__case-thumb" style={{ background: lootCase.accent ?? "var(--lc-bg-active)" }}>
                      {lootCase.name?.charAt(0) ?? "?"}
                    </div>
                    <span className="cb-modal__case-name">{lootCase.name}</span>
                    <span className="cb-modal__case-price">{formatCoins(lootCase.price, coinType)}</span>
                    <div className="cb-modal__case-actions">
                      <button
                        type="button"
                        className="cb-modal__case-step-btn"
                        onClick={() => decrementGroup(lootCase.id)}
                        aria-label={`Remove one ${lootCase.name}`}
                        disabled={current <= 0}
                      >
                        <Minus size={10} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="cb-modal__case-step-btn cb-modal__case-step-btn--add"
                        onClick={() => incrementGroup(lootCase.id)}
                        aria-label={`Add one ${lootCase.name}`}
                        disabled={atCap}
                      >
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
                <button type="button" className="cb-btn cb-btn--ghost" onClick={() => setShowCaseModal(false)}>
                  Close
                </button>
                <button
                  type="button"
                  className="cb-btn cb-btn--primary"
                  onClick={() => setShowCaseModal(false)}
                  disabled={groups.length === 0}
                >
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
