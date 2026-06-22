import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Package } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import {
  battleEntryCostFromCaseIds,
  CASE_CATALOG,
  getCaseById,
} from "../../lib/games/case-battles";
import {
  canAddCaseToSelection,
  entryAfterBorrow,
  GAMEMODES,
  MAX_BORROW_PERCENT,
  MAX_CASES_PER_BATTLE,
  MAX_COPIES_PER_CASE_TYPE,
  GROUP_PLAYER_MODES,
  isGroupPlayerMode,
  maxPlayersForMode,
  payoutKeepMultiplier,
  SOLO_PLAYER_MODES,
  TEAM_PLAYER_MODES,
  type BattleGamemode,
  type PlayerModeId,
} from "../../lib/games/case-battles/config";
import { formatCoins } from "../../lib/format";
import { createCaseBattle } from "../../lib/caseBattles";
import { CaseBattleRoundsStrip } from "./CaseBattleRoundsStrip";
import { CaseBattlesTopbar } from "./CaseBattlesTopbar";
import { gamemodeIcon, gamemodeLabel } from "./caseBattlesUi";
import "./CaseBattlesCreate.css";

type GroupedCase = { caseId: string; count: number };
type SortOrder = "asc" | "desc";

function groupCaseIds(ids: string[]): GroupedCase[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (!counts.has(id)) order.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return order.map((caseId) => ({ caseId, count: counts.get(caseId)! }));
}

function countCaseInList(ids: string[], caseId: string): number {
  return ids.filter((id) => id === caseId).length;
}

export function CaseBattlesCreate() {
  const { user, loading: authLoading } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const navigate = useNavigate();

  const [gamemode, setGamemode] = useState<BattleGamemode>("normal");
  const [playerMode, setPlayerMode] = useState<PlayerModeId>("1v1");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [borrow, setBorrow] = useState(false);
  const [borrowPercent, setBorrowPercent] = useState(50);
  const [fastSpin, setFastSpin] = useState(false);
  const [crazy, setCrazy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSort, setCatalogSort] = useState<SortOrder>("asc");

  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  // Signal in-flight async work to stop touching state on unmount.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      busyRef.current = false;
    };
  }, []);

  const createTotal = useMemo(
    () => battleEntryCostFromCaseIds(selectedCaseIds),
    [selectedCaseIds]
  );
  const groupedCases = useMemo(() => groupCaseIds(selectedCaseIds), [selectedCaseIds]);
  const isGroup = gamemode === "group";
  const effectiveBorrow = borrow ? borrowPercent : 0;
  const upfrontCost = useMemo(
    () => entryAfterBorrow(createTotal, effectiveBorrow),
    [createTotal, effectiveBorrow]
  );
  const maxPlayers = maxPlayersForMode(playerMode);
  const maxPot = createTotal * maxPlayers;
  const balance = profile?.balance ?? 0;
  const canCreate =
    !!user && selectedCaseIds.length > 0 && balance >= upfrontCost && !busy;

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const list = CASE_CATALOG.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
    return [...list].sort((a, b) =>
      catalogSort === "asc" ? a.price - b.price : b.price - a.price
    );
  }, [catalogSearch, catalogSort]);

  const caseCountInSelection = useCallback(
    (caseId: string) => countCaseInList(selectedCaseIds, caseId),
    [selectedCaseIds]
  );

  const addCase = useCallback((caseId: string) => {
    setSelectedCaseIds((prev) => {
      if (!canAddCaseToSelection(prev, caseId)) {
        if (prev.length >= MAX_CASES_PER_BATTLE) {
          setError(`Maximum ${MAX_CASES_PER_BATTLE} cases per battle.`);
        } else {
          setError(`Maximum ${MAX_COPIES_PER_CASE_TYPE} of each case type.`);
        }
        return prev;
      }
      setError(null);
      return [...prev, caseId];
    });
  }, []);

  const adjustCaseQty = useCallback((caseId: string, delta: number) => {
    setSelectedCaseIds((prev) => {
      if (delta > 0) {
        if (!canAddCaseToSelection(prev, caseId)) {
          if (prev.length >= MAX_CASES_PER_BATTLE) {
            setError(`Maximum ${MAX_CASES_PER_BATTLE} cases per battle.`);
          } else {
            setError(`Maximum ${MAX_COPIES_PER_CASE_TYPE} of each case type.`);
          }
          return prev;
        }
        setError(null);
        return [...prev, caseId];
      }
      const idx = prev.lastIndexOf(caseId);
      if (idx === -1) return prev;
      setError(null);
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

  const removeCaseGroup = useCallback((caseId: string) => {
    setSelectedCaseIds((prev) => prev.filter((id) => id !== caseId));
    setError(null);
  }, []);

  const sortCasesAsc = useCallback(() => {
    setSelectedCaseIds((prev) =>
      [...prev].sort((a, b) => (getCaseById(a)?.price ?? 0) - (getCaseById(b)?.price ?? 0))
    );
  }, []);

  const sortCasesDesc = useCallback(() => {
    setSelectedCaseIds((prev) =>
      [...prev].sort((a, b) => (getCaseById(b)?.price ?? 0) - (getCaseById(a)?.price ?? 0))
    );
  }, []);

  const randomizeCases = useCallback(() => {
    setSelectedCaseIds((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
      return next;
    });
  }, []);

  const selectGamemode = (id: BattleGamemode) => {
    setGamemode(id);
    if (id === "group") {
      setPlayerMode("2p");
      setCrazy(false);
    } else if (isGroupPlayerMode(playerMode)) {
      setPlayerMode("1v1");
    }
  };

  const handleCreate = async () => {
    // Double-click race guard: the Create button's `disabled={!canCreate}`
    // (where canCreate includes `!busy`) prevents most double-clicks, but
    // there's a sub-ms window between the first click's setBusy(true) state
    // commit and the second click's handler execution. The ref closes that
    // window synchronously.
    if (busyRef.current) return;

    if (!user) {
      setError("Log in to create a battle.");
      return;
    }
    if (!selectedCaseIds.length) {
      setError("Add at least one case to your battle.");
      return;
    }
    if (balance < upfrontCost) {
      setError("Insufficient balance for your entry.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { data, error: createErr } = await createCaseBattle({
      caseIds: selectedCaseIds,
      playerMode,
      gamemode,
      crazyMode: crazy && !isGroup,
      fastSpin,
      borrowPercent: effectiveBorrow,
    });
    if (cancelledRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (createErr || !data) {
      setError(createErr ?? "Could not create battle.");
      // Server may have debited the entry before failing — refresh to get the
      // authoritative balance.
      void refreshProfile();
      return;
    }
    await refreshProfile();
    if (cancelledRef.current) return;
    navigate(`/case-battles/${data.battleId}`);
  };

  if (authLoading) {
    return (
      <div className="cb-page lc-page">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={loginUrl("/case-battles/create")} replace />;
  }

  return (
    <div className="cb-page cb-page--compact cbc">
      <CaseBattlesTopbar
        backTo="/case-battles"
        backLabel="Battles"
        title="Create battle"
        subtitle={`${selectedCaseIds.length} / ${MAX_CASES_PER_BATTLE} rounds · ${formatCoins(createTotal, "balance")} per seat`}
      />

      {error && (
        <p className="cb-page__error" role="alert">
          {error}
        </p>
      )}

      <div className="cbc__layout">
        {/* ─────────────────────────────────────────────────────────────
            LEFT — Case catalog grid
            ───────────────────────────────────────────────────────────── */}
        <main className="cbc__main">
          <section className="cbc__catalog">
            <div className="cbc__catalog-head">
              <div className="cbc__catalog-head-text">
                <h2 className="cbc__block-title">Case selection</h2>
                <p className="cbc__block-sub">
                  Browse {CASE_CATALOG.length} cases · tap{" "}
                  <span className="cbc__plus-glyph" aria-hidden>
                    +
                  </span>{" "}
                  to add a round
                </p>
              </div>
              <div className="cbc__catalog-tools">
                <label className="cbc__search">
                  <span className="cbc__search-icon" aria-hidden>
                    ⌕
                  </span>
                  <input
                    type="search"
                    placeholder="Search cases…"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    aria-label="Search cases"
                  />
                </label>
                <div className="cbc__sort" role="group" aria-label="Sort by price">
                  <button
                    type="button"
                    className={
                      "cbc__sort-btn" +
                      (catalogSort === "asc" ? " cbc__sort-btn--active" : "")
                    }
                    onClick={() => setCatalogSort("asc")}
                  >
                    ↑ Low
                  </button>
                  <button
                    type="button"
                    className={
                      "cbc__sort-btn" +
                      (catalogSort === "desc" ? " cbc__sort-btn--active" : "")
                    }
                    onClick={() => setCatalogSort("desc")}
                  >
                    ↓ High
                  </button>
                </div>
              </div>
            </div>

            <div className="cbc__catalog-grid">
              {filteredCatalog.map((c) => {
                const count = caseCountInSelection(c.id);
                const atMaxType = count >= MAX_COPIES_PER_CASE_TYPE;
                const atMaxBattle = selectedCaseIds.length >= MAX_CASES_PER_BATTLE;
                const isMaxed = atMaxType || atMaxBattle;
                const cardStyle = { "--cbc-accent": c.accent } as CSSProperties;
                return (
                  <article
                    key={c.id}
                    className={
                      "cbc__catalog-card" +
                      (count > 0 ? " cbc__catalog-card--selected" : "")
                    }
                    style={cardStyle}
                  >
                    {count > 0 && (
                      <span className="cbc__catalog-check" aria-hidden>
                        ✓
                      </span>
                    )}
                    <div
                      className="cbc__catalog-art"
                      style={{
                        background: `radial-gradient(circle at 50% 30%, ${c.accent}33, transparent 72%)`,
                      }}
                    >
                      <span className="cbc__catalog-mono" style={{ color: c.accent }}>
                        {c.name.charAt(0)}
                      </span>
                      {count > 0 && (
                        <span className="cbc__catalog-count" aria-label={`${count} added`}>
                          {count}
                        </span>
                      )}
                    </div>
                    <div className="cbc__catalog-meta">
                      <p className="cbc__catalog-name" title={c.name}>
                        {c.name}
                      </p>
                      <p className="cbc__catalog-price">{formatCoins(c.price, "balance")}</p>
                    </div>
                    <div className="cbc__catalog-qty">
                      {count > 0 ? (
                        <>
                          <button
                            type="button"
                            className="cbc__qty-btn"
                            aria-label={`Remove one ${c.name}`}
                            onClick={() => adjustCaseQty(c.id, -1)}
                          >
                            −
                          </button>
                          <span className="cbc__qty-val">{count}</span>
                          <button
                            type="button"
                            className="cbc__qty-btn"
                            aria-label={`Add one ${c.name}`}
                            disabled={isMaxed}
                            onClick={() => addCase(c.id)}
                          >
                            +
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="cbc__catalog-add"
                          disabled={atMaxBattle}
                          onClick={() => addCase(c.id)}
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              {filteredCatalog.length === 0 && (
                <p className="cbc__catalog-empty">
                  No cases match “{catalogSearch}”.
                </p>
              )}
            </div>
          </section>
        </main>

        {/* ─────────────────────────────────────────────────────────────
            RIGHT — Configuration + Selected cases + Summary + Create
            ───────────────────────────────────────────────────────────── */}
        <aside className="cbc__summary" aria-label="Battle configuration">
          {/* Gamemode cards */}
          <section className="cbc__config-block">
            <h3 className="cbc__block-title">Gamemode</h3>
            <div className="cbc__mode-grid">
              {GAMEMODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!m.live}
                  className={
                    "cbc__mode-card" +
                    (gamemode === m.id ? " cbc__mode-card--active" : "") +
                    (!m.live ? " cbc__mode-card--soon" : "")
                  }
                  onClick={() => m.live && selectGamemode(m.id)}
                >
                  <span className="cbc__mode-icon" aria-hidden>
                    {gamemodeIcon(m.id)}
                  </span>
                  <span className="cbc__mode-text">
                    <span className="cbc__mode-name">{m.name}</span>
                    <span className="cbc__mode-desc">{m.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Players */}
          <section className="cbc__config-block">
            <h3 className="cbc__block-title">
              {isGroup ? "Players (group)" : "Players"}
            </h3>
            {isGroup && (
              <p className="cbc__block-hint">Pot split equally among all players.</p>
            )}
            <div className="cbc__player-panel">
              {isGroup ? (
                <div className="cbc__player-row">
                  {GROUP_PLAYER_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={
                        "cbc__player-btn" +
                        (playerMode === m.id ? " cbc__player-btn--active" : "")
                      }
                      onClick={() => setPlayerMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <p className="cbc__player-sub">Solo</p>
                  <div className="cbc__player-row">
                    {SOLO_PLAYER_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={
                          "cbc__player-btn" +
                          (playerMode === m.id ? " cbc__player-btn--active" : "")
                        }
                        onClick={() => setPlayerMode(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="cbc__player-sub">Team</p>
                  <div className="cbc__player-row">
                    {TEAM_PLAYER_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={
                          "cbc__player-btn" +
                          (playerMode === m.id ? " cbc__player-btn--active" : "")
                        }
                        onClick={() => setPlayerMode(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Options */}
          <section className="cbc__config-block">
            <h3 className="cbc__block-title">Options</h3>
            <div className="cbc__toggles">
              <button
                type="button"
                className={"cbc__toggle" + (isGroup ? " cbc__toggle--disabled" : "")}
                aria-pressed={crazy}
                disabled={isGroup}
                title={
                  isGroup
                    ? "Not available in Group mode"
                    : "Lowest unboxed wins (or flipped jackpot odds)"
                }
                onClick={() => !isGroup && setCrazy((v) => !v)}
              >
                <span
                  className={"cbc__toggle-track" + (crazy ? " cbc__toggle-track--on" : "")}
                  aria-hidden
                >
                  <span className="cbc__toggle-thumb" />
                </span>
                <span className="cbc__toggle-label">
                  <span className="cbc__toggle-name">Crazy mode</span>
                  <span className="cbc__toggle-hint">
                    {isGroup ? "Disabled in group" : "Lowest unboxed wins"}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="cbc__toggle"
                aria-pressed={fastSpin}
                onClick={() => setFastSpin((v) => !v)}
              >
                <span
                  className={"cbc__toggle-track" + (fastSpin ? " cbc__toggle-track--on" : "")}
                  aria-hidden
                >
                  <span className="cbc__toggle-thumb" />
                </span>
                <span className="cbc__toggle-label">
                  <span className="cbc__toggle-name">Fast spin</span>
                  <span className="cbc__toggle-hint">2s rounds instead of 5s</span>
                </span>
              </button>

              <button
                type="button"
                className="cbc__toggle"
                aria-pressed={borrow}
                onClick={() => setBorrow((v) => !v)}
              >
                <span
                  className={"cbc__toggle-track" + (borrow ? " cbc__toggle-track--on" : "")}
                  aria-hidden
                >
                  <span className="cbc__toggle-thumb" />
                </span>
                <span className="cbc__toggle-label">
                  <span className="cbc__toggle-name">Borrow</span>
                  <span className="cbc__toggle-hint">Pay less now, keep less if you win</span>
                </span>
              </button>

              {borrow && (
                <label className="cbc__borrow-slider">
                  <span className="cbc__borrow-label">{borrowPercent}%</span>
                  <input
                    type="range"
                    min={1}
                    max={MAX_BORROW_PERCENT}
                    value={borrowPercent}
                    onChange={(e) => setBorrowPercent(Number(e.target.value))}
                    aria-label="Borrow percentage"
                  />
                  <span className="cbc__borrow-keep">
                    Keep {Math.round(payoutKeepMultiplier(borrowPercent) * 100)}%
                  </span>
                </label>
              )}
            </div>
          </section>

          {/* Selected cases list */}
          <section className="cbc__config-block">
            <div className="cbc__block-head">
              <h3 className="cbc__block-title">Selected cases</h3>
              {selectedCaseIds.length > 0 && (
                <div className="cbc__selected-tools">
                  <button
                    type="button"
                    className="cbc__tool-btn"
                    onClick={sortCasesAsc}
                    title="Sort by price ascending"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="cbc__tool-btn"
                    onClick={sortCasesDesc}
                    title="Sort by price descending"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="cbc__tool-btn"
                    onClick={randomizeCases}
                    title="Shuffle order"
                  >
                    ⇄
                  </button>
                  <button
                    type="button"
                    className="cbc__tool-btn cbc__tool-btn--danger"
                    onClick={() => setSelectedCaseIds([])}
                    title="Clear all"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {selectedCaseIds.length === 0 ? (
              <p className="cbc__selected-empty">
                No cases selected yet. Add cases from the catalog on the left.
              </p>
            ) : (
              <>
                <p className="cbc__selected-stats">
                  <strong>{selectedCaseIds.length}</strong> / {MAX_CASES_PER_BATTLE} rounds ·{" "}
                  <strong>{formatCoins(createTotal, "balance")}</strong> per seat
                </p>

                <CaseBattleRoundsStrip caseIds={selectedCaseIds} variant="create" />

                <div className="cbc__selected-list">
                  {groupedCases.map(({ caseId, count }) => {
                    const c = getCaseById(caseId);
                    const atMaxType = count >= MAX_COPIES_PER_CASE_TYPE;
                    const atMaxBattle = selectedCaseIds.length >= MAX_CASES_PER_BATTLE;
                    return (
                      <div key={caseId} className="cbc__selected-item">
                        <span
                          className="cbc__selected-emoji"
                          style={{
                            borderColor: c?.accent,
                            background: c
                              ? `linear-gradient(145deg, ${c.accent}33, transparent)`
                              : undefined,
                          }}
                          aria-hidden
                        >
                          {c?.name.charAt(0) ?? <Package size={14} aria-hidden />}
                        </span>
                        <div className="cbc__selected-info">
                          <span className="cbc__selected-name">{c?.name ?? caseId}</span>
                          <span className="cbc__selected-price">
                            {formatCoins(c?.price ?? 0, "balance")} each
                          </span>
                        </div>
                        <div className="cbc__selected-qty">
                          <button
                            type="button"
                            className="cbc__qty-btn"
                            aria-label="Decrease quantity"
                            disabled={count <= 1}
                            onClick={() => adjustCaseQty(caseId, -1)}
                          >
                            −
                          </button>
                          <span className="cbc__qty-val">{count}</span>
                          <button
                            type="button"
                            className="cbc__qty-btn"
                            aria-label="Increase quantity"
                            disabled={atMaxType || atMaxBattle}
                            onClick={() => adjustCaseQty(caseId, 1)}
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          className="cbc__selected-remove"
                          aria-label={`Remove ${c?.name ?? caseId}`}
                          onClick={() => removeCaseGroup(caseId)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* Summary + Create */}
          <section className="cbc__summary-bar" aria-label="Battle cost summary">
            <div className="cbc__summary-total">
              <span className="cbc__summary-total-label">
                {effectiveBorrow > 0 ? "Pay now" : "Entry cost"}
              </span>
              <strong className="cbc__summary-total-value">
                {formatCoins(upfrontCost, "balance")}
              </strong>
            </div>
            <div className="cbc__summary-meta">
              <div className="cbc__summary-meta-row">
                <span>Per seat</span>
                <strong>{formatCoins(createTotal, "balance")}</strong>
              </div>
              <div className="cbc__summary-meta-row">
                <span>
                  Max pot <span className="cbc__summary-meta-hint">({maxPlayers} players)</span>
                </span>
                <strong>
                  {selectedCaseIds.length ? formatCoins(maxPot, "balance") : "—"}
                </strong>
              </div>
              <div className="cbc__summary-meta-row">
                <span>Mode</span>
                <strong>
                  {gamemodeIcon(gamemode)} {gamemodeLabel(gamemode)} · {playerMode}
                </strong>
              </div>
              {effectiveBorrow > 0 && (
                <div className="cbc__summary-meta-row">
                  <span>Win keep</span>
                  <strong>{Math.round(payoutKeepMultiplier(effectiveBorrow) * 100)}%</strong>
                </div>
              )}
            </div>
            <button
              type="button"
              className="cbc__summary-create"
              disabled={!canCreate}
              onClick={() => void handleCreate()}
            >
              {busy ? "Creating…" : `Create battle · ${formatCoins(upfrontCost, "balance")}`}
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
