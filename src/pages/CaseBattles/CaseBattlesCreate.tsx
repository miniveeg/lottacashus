import { useCallback, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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
import { CasePickerModal } from "./CasePickerModal";
import { CaseBattleRoundsStrip } from "./CaseBattleRoundsStrip";
import { CaseBattlesTopbar } from "./CaseBattlesTopbar";
import { gamemodeIcon, gamemodeLabel } from "./caseBattlesUi";
import "./CaseBattlesCreate.css";

type GroupedCase = { caseId: string; count: number };

function groupCaseIds(ids: string[]): GroupedCase[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (!counts.has(id)) order.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return order.map((caseId) => ({ caseId, count: counts.get(caseId)! }));
}

export function CaseBattlesCreate() {
  const { user, loading: authLoading } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const navigate = useNavigate();

  const [gamemode, setGamemode] = useState<BattleGamemode>("normal");
  const [playerMode, setPlayerMode] = useState<PlayerModeId>("1v1");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [borrow, setBorrow] = useState(false);
  const [borrowPercent, setBorrowPercent] = useState(50);
  const [fastSpin, setFastSpin] = useState(false);
  const [crazy, setCrazy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const addCaseFromModal = useCallback((caseId: string) => {
    setSelectedCaseIds((prev) => {
      if (!canAddCaseToSelection(prev, caseId)) return prev;
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
    setBusy(false);
    if (createErr || !data) {
      setError(createErr ?? "Could not create battle.");
      return;
    }
    await refreshProfile();
    navigate(`/case-battles/${data.battleId}`);
  };

  const summaryCard = (
    <>
      <div className="cbc__summary-card cbc__summary-card--details">
        <p className="cbc__summary-title">Battle summary</p>
        <dl className="cbc__summary-rows">
          <div className="cbc__summary-row">
            <dt>Mode</dt>
            <dd>
              {gamemodeIcon(gamemode)} {gamemodeLabel(gamemode)}
            </dd>
          </div>
          <div className="cbc__summary-row">
            <dt>Players</dt>
            <dd>
              {playerMode} ({maxPlayers} slots)
            </dd>
          </div>
          <div className="cbc__summary-row">
            <dt>Rounds</dt>
            <dd>{selectedCaseIds.length || "—"}</dd>
          </div>
          
          <div className="cbc__summary-row">
            <dt>Case value</dt>
            <dd>{formatCoins(createTotal, "balance")}</dd>
          </div>
          <div className="cbc__summary-row">
            <dt>Options</dt>
            <dd>
              {[crazy && !isGroup ? "Crazy" : null, fastSpin ? "Fast spin" : null, effectiveBorrow > 0 ? `${effectiveBorrow}% borrow` : null]
                .filter(Boolean)
                .join(" · ") || "Standard"}
            </dd>
          </div>
          <div className="cbc__summary-row cbc__summary-row--total">
            <dt>Pay now</dt>
            <dd>{formatCoins(upfrontCost, "balance")}</dd>
          </div>
          {effectiveBorrow > 0 && (
            <div className="cbc__summary-row">
              <dt>Win keep</dt>
              <dd>{Math.round(payoutKeepMultiplier(effectiveBorrow) * 100)}%</dd>
            </div>
          )}
          <div className="cbc__summary-row cbc__summary-row--pot">
            <dt>Max pot</dt>
            <dd>{selectedCaseIds.length ? formatCoins(maxPot, "balance") : "—"}</dd>
          </div>
        </dl>
      </div>
      <button
        type="button"
        className="cbc__summary-create"
        disabled={!canCreate}
        onClick={() => void handleCreate()}
      >
        {busy ? "Creating…" : `Create · ${formatCoins(upfrontCost, "balance")}`}
      </button>
    </>
  );

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
        title="Create"
        actions={
          <button
            type="button"
            className="cb-page__btn-primary"
            disabled={!canCreate}
            onClick={() => void handleCreate()}
          >
            {busy ? "…" : `Create ${formatCoins(upfrontCost, "balance")}`}
          </button>
        }
      />

      {error && (
        <p className="cb-page__error" role="alert">
          {error}
        </p>
      )}

      <div className="cbc__layout">
        <div className="cbc__main">
          <div className="cbc__config-row">
            <section className="cbc__block">
              <h2 className="cbc__section-label">Gamemode</h2>
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
                    <span className="cbc__mode-name">{m.name}</span>
                    <span className="cbc__mode-desc">{m.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="cbc__block">
              <h2 className="cbc__section-label">
                {isGroup ? "Players (group)" : "Players"}
              </h2>
              {isGroup ? (
                <p className="cbc__block-hint">Pot split equally among all players.</p>
              ) : null}
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
              <div className="cbc__toggles">
                <div className="cbc__toggles-borrow">
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
                    Borrow
                  </button>
                  <label
                    className={
                      "cbc__borrow-slider" + (borrow ? "" : " cbc__borrow-slider--disabled")
                    }
                  >
                    <span className="cbc__borrow-label">{borrowPercent}%</span>
                    <input
                      type="range"
                      min={1}
                      max={MAX_BORROW_PERCENT}
                      value={borrowPercent}
                      disabled={!borrow}
                      onChange={(e) => setBorrowPercent(Number(e.target.value))}
                    />
                  </label>
                </div>
                <div className="cbc__toggles-bottom">
                  <button
                    type="button"
                    className="cbc__toggle"
                    aria-pressed={fastSpin}
                    onClick={() => setFastSpin((v) => !v)}
                  >
                    <span
                      className={
                        "cbc__toggle-track" + (fastSpin ? " cbc__toggle-track--on" : "")
                      }
                      aria-hidden
                    >
                      <span className="cbc__toggle-thumb" />
                    </span>
                    Fast spin
                  </button>
                  <button
                    type="button"
                    className={
                      "cbc__toggle" + (isGroup ? " cbc__toggle--disabled" : "")
                    }
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
                    Crazy
                  </button>
                </div>
              </div>
            </section>
          </div>

          <section className="cbc__cases-panel">
            <div className="cbc__cases-head">
              <h2 className="cbc__section-label">Cases</h2>
              {selectedCaseIds.length > 0 && (
                <div className="cbc__cases-tools">
                  <button type="button" className="cbc__tool-btn" onClick={sortCasesAsc}>
                    ↑ Price
                  </button>
                  <button type="button" className="cbc__tool-btn" onClick={sortCasesDesc}>
                    ↓ Price
                  </button>
                  <button type="button" className="cbc__tool-btn" onClick={randomizeCases}>
                    Shuffle
                  </button>
                  <button
                    type="button"
                    className="cbc__tool-btn cbc__tool-btn--danger"
                    onClick={() => setSelectedCaseIds([])}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <p className="cbc__cases-stats">
              <strong>{selectedCaseIds.length}</strong> / {MAX_CASES_PER_BATTLE} rounds ·{" "}
              <strong>{formatCoins(createTotal, "balance")}</strong> total case value
            </p>

            {selectedCaseIds.length > 0 && (
              <CaseBattleRoundsStrip caseIds={selectedCaseIds} variant="create" />
            )}

            {selectedCaseIds.length === 0 ? (
              <div className="cbc__cases-empty">
                <p>No cases selected yet. Add up to {MAX_CASES_PER_BATTLE} rounds.</p>
                <button
                  type="button"
                  className="cb-page__btn-primary"
                  onClick={() => setCaseModalOpen(true)}
                >
                  + Add cases
                </button>
              </div>
            ) : (
              <div className="cbc__cases-grid">
                {groupedCases.map(({ caseId, count }) => {
                  const c = getCaseById(caseId);
                  const atMaxType = count >= MAX_COPIES_PER_CASE_TYPE;
                  const atMaxBattle = selectedCaseIds.length >= MAX_CASES_PER_BATTLE;
                  return (
                    <article
                      key={caseId}
                      className="cbc__case-slot"
                      style={{ borderColor: c?.accent }}
                    >
                      <button
                        type="button"
                        className="cbc__case-remove"
                        aria-label={`Remove ${c?.name ?? caseId}`}
                        onClick={() => removeCaseGroup(caseId)}
                      >
                        ×
                      </button>
                      <div
                        className="cbc__case-art"
                        style={{
                          background: c
                            ? `linear-gradient(145deg, ${c.accent}33, transparent)`
                            : undefined,
                        }}
                      >
                        📦
                      </div>
                      <div className="cbc__case-body">
                        <p className="cbc__case-name">{c?.name ?? caseId}</p>
                        <p className="cbc__case-price">{formatCoins(c?.price ?? 0, "balance")}</p>
                        <div className="cbc__qty">
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
                      </div>
                    </article>
                  );
                })}
                {selectedCaseIds.length < MAX_CASES_PER_BATTLE && (
                  <button
                    type="button"
                    className="cbc__case-slot cbc__case-slot--add"
                    onClick={() => setCaseModalOpen(true)}
                  >
                    <span className="cbc__case-slot-plus">+</span>
                    ADD CASE
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="cbc__summary">{summaryCard}</aside>
      </div>

      <CasePickerModal
        open={caseModalOpen}
        onClose={() => setCaseModalOpen(false)}
        catalog={CASE_CATALOG}
        selectedCaseIds={selectedCaseIds}
        onAddCase={addCaseFromModal}
        classPrefix="cbc-modal"
      />
    </div>
  );
}
