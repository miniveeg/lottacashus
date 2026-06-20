import { useMemo, useState } from "react";
import { battleEntryCostFromCaseIds } from "../../lib/games/case-battles";
import {
  canAddCaseToSelection,
  countCaseInSelection,
  MAX_CASES_PER_BATTLE,
  MAX_COPIES_PER_CASE_TYPE,
} from "../../lib/games/case-battles/config";
import type { LootCase } from "../../lib/games/case-battles/cases";
import { formatCoins } from "../../lib/format";

type SortOrder = "asc" | "desc";

type CasePickerModalProps = {
  open: boolean;
  onClose: () => void;
  catalog: LootCase[];
  selectedCaseIds: string[];
  onAddCase: (caseId: string) => void;
  /** CSS class prefix — `cb-modal` (legacy) or `cbc-modal` (create page). */
  classPrefix?: "cb-modal" | "cbc-modal";
};

export function CasePickerModal({
  open,
  onClose,
  catalog,
  selectedCaseIds,
  onAddCase,
  classPrefix = "cb-modal",
}: CasePickerModalProps) {
  const p = classPrefix;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("asc");

  const totalCost = useMemo(() => battleEntryCostFromCaseIds(selectedCaseIds), [selectedCaseIds]);
  const rounds = selectedCaseIds.length;

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = catalog.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
    list = [...list].sort((a, b) => (sort === "asc" ? a.price - b.price : b.price - a.price));
    return list;
  }, [catalog, search, sort]);

  if (!open) return null;

  return (
    <div className={p} role="dialog" aria-modal="true">
      <button type="button" className={`${p}__backdrop`} aria-label="Close" onClick={onClose} />
      <div className={`${p}__panel`}>
        <header className={`${p}__header`}>
          <div>
            {p === "cbc-modal" && <h2 className={`${p}__title`}>Add cases</h2>}
            <div className={`${p}__stats`}>
              <span>
                Rounds <strong>{rounds}</strong> / {MAX_CASES_PER_BATTLE}
              </span>
              <span>
                Total <strong>{formatCoins(totalCost, "balance")}</strong>
              </span>
            </div>
          </div>
          <button type="button" className={`${p}__close`} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className={`${p}__toolbar`}>
          <label className={`${p}__search`}>
            <span className={`${p}__search-icon`} aria-hidden>
              ⌕
            </span>
            <input
              type="search"
              placeholder="Search for cases"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div
            className={`${p}__sort-group`}
            role="group"
            aria-label="Sort by price"
          >
            <button
              type="button"
              className={`${p}__sort-opt${sort === "asc" ? ` ${p}__sort-opt--active` : ""}`}
              aria-pressed={sort === "asc"}
              onClick={() => setSort("asc")}
            >
              Low → High
            </button>
            <button
              type="button"
              className={`${p}__sort-opt${sort === "desc" ? ` ${p}__sort-opt--active` : ""}`}
              aria-pressed={sort === "desc"}
              onClick={() => setSort("desc")}
            >
              High → Low
            </button>
          </div>
        </div>

        <p className={`${p}__hint`}>
          Up to {MAX_CASES_PER_BATTLE} cases total · max {MAX_COPIES_PER_CASE_TYPE} of each type
        </p>

        <div className={`${p}__grid`}>
          {filteredCases.map((c) => {
            const inBattle = countCaseInSelection(selectedCaseIds, c.id);
            const canAdd = canAddCaseToSelection(selectedCaseIds, c.id);
            return (
              <article
                key={c.id}
                className={`${p}__case`}
                style={{ borderColor: c.accent }}
              >
                <div
                  className={`${p}__case-visual`}
                  style={{ background: `linear-gradient(145deg, ${c.accent}22, transparent)` }}
                >
                  <span aria-hidden>📦</span>
                </div>
                <h3 className={`${p}__case-name`}>{c.name}</h3>
                <p className={`${p}__case-price`}>{formatCoins(c.price, "balance")}</p>
                {inBattle > 0 && (
                  <span className={`${p}__case-count`}>×{inBattle} in battle</span>
                )}
                <button
                  type="button"
                  className={`${p}__add-btn`}
                  disabled={!canAdd}
                  onClick={() => onAddCase(c.id)}
                >
                  {canAdd ? "Add Case" : inBattle >= MAX_COPIES_PER_CASE_TYPE ? "Max reached" : "Battle full"}
                </button>
              </article>
            );
          })}
        </div>

        {filteredCases.length === 0 && (
          <p className={`${p}__empty`}>No cases match your search.</p>
        )}
      </div>
    </div>
  );
}
