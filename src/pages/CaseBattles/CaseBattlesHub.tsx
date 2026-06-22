import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Package } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { loginUrl } from "../../lib/authRedirect";
import { ORIGINALS_PATH } from "../../content/originals";
import { getCaseById } from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import { filterListedBattles, listOpenCaseBattles, type OpenBattleRow } from "../../lib/caseBattles";
import { LcSelect, type LcSelectOption } from "../../components/LcSelect/LcSelect";
import { CaseBattlesTopbar } from "./CaseBattlesTopbar";
import {
  battleIsJoinable,
  battleStatusLabel,
  formatBattleAge,
  gamemodeIcon,
  gamemodeLabel,
  uniqueCaseIdsFromRow,
} from "./caseBattlesUi";
import { useCaseBattlesLobbyPoll } from "./useCaseBattlesLobbyPoll";
import "./CaseBattlesHub.css";
const CASE_THUMB_LIMIT = 8;
const SKELETON_COUNT = 4;

type SortKey = "newest" | "price-asc" | "price-desc" | "pot-desc";

const SORT_OPTIONS: LcSelectOption<SortKey>[] = [
  { value: "newest", label: "Newest first" },
  { value: "pot-desc", label: "Highest pot" },
  { value: "price-asc", label: "Entry: low to high" },
  { value: "price-desc", label: "Entry: high to low" },
];

function sortBattles(rows: OpenBattleRow[], sort: SortKey): OpenBattleRow[] {
  const list = [...rows];
  switch (sort) {
    case "price-asc":
      return list.sort((a, b) => Number(a.entry_cost) - Number(b.entry_cost));
    case "price-desc":
      return list.sort((a, b) => Number(b.entry_cost) - Number(a.entry_cost));
    case "pot-desc":
      return list.sort((a, b) => Number(b.pot_total) - Number(a.pot_total));
    default:
      return list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }
}

export function CaseBattlesHub() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const balance = profile?.balance ?? 0;
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [openBattles, setOpenBattles] = useState<OpenBattleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("newest");

  const loadLobby = useCallback(async () => {
    const res = await listOpenCaseBattles(50);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    setOpenBattles(filterListedBattles(res.battles));
  }, []);

  // The lobby poll hook (useCaseBattlesLobbyPoll) fires `loadLobby()` once on
  // mount and then every POLL_MS. We do NOT additionally call loadLobby here —
  // doing so caused a duplicate fetch on every mount (one from a manual
  // useEffect, one from the poll hook's initial tick).
  // `loading` is initialized to `true` in useState, so the skeleton shows on
  // first render before the poll hook's initial tick resolves.
  useCaseBattlesLobbyPoll(true, loadLobby);

  useEffect(() => {
    const id = window.setInterval(() => {
      setOpenBattles((rows) => {
        const next = filterListedBattles(rows);
        return next.length === rows.length ? rows : next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const sortedBattles = useMemo(() => sortBattles(openBattles, sort), [openBattles, sort]);

  const totalPot = useMemo(
    () => openBattles.reduce((sum, b) => sum + Number(b.pot_total), 0),
    [openBattles]
  );

  const openBattle = (battleId: string) => {
    navigate(`/case-battles/${battleId}`);
  };

  const handleJoin = (e: MouseEvent, row: OpenBattleRow) => {
    e.stopPropagation();
    openBattle(row.battle_id);
  };

  return (
    <div className="cb-page cbh">
      <CaseBattlesTopbar
        backTo={ORIGINALS_PATH}
        backLabel="Originals"
        title="Battles"
        actions={
          <Link to="/case-battles/create" className="cb-page__btn-primary cbh__create-btn">
            <span className="cbh__create-icon" aria-hidden>
              +
            </span>
            Create battle
          </Link>
        }
      />

      <section className="cb-page__hero cbh__hero">
        <div className="cb-page__hero-text">
          <p className="cbh__hero-eyebrow">PvP case opens</p>
          <h2 className="cb-page__hero-title cbh__hero-title">
            Stack cases, fill slots, <span className="cbh__hero-accent">battle for the pot</span>
          </h2>
          <p className="cb-page__hero-lead">
            Join an open lobby or create your own. Highest total unboxed value walks away with
            everything.
          </p>
        </div>
        <div className="cb-page__stats cbh__stats">
          <div className="cb-page__stat">
            <span className="cb-page__stat-value">{openBattles.length}</span>
            <span className="cb-page__stat-label">Open battles</span>
          </div>
          <div className="cb-page__stat">
            <span className="cb-page__stat-value">{formatCoins(totalPot, "balance")}</span>
            <span className="cb-page__stat-label">In pots</span>
          </div>
        </div>
      </section>

      <div className="cb-page__panel cbh__panel">
        <div className="cb-page__panel-head cbh__panel-head">
          <p className="cb-page__section-label">
            <span className="cbh__live-dot" aria-hidden />
            Active battles
          </p>
          <LcSelect
            className="cbh__sort-select"
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
            aria-label="Sort battles"
          />
        </div>

        {error && (
          <p className="cb-page__error cbh__error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="cbh__list">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <div key={i} className="cbh__skeleton" aria-hidden />
            ))}
          </div>
        ) : error ? (
          // Suppress the empty-state when there's an error — showing both
          // "Supabase is not configured" AND "No open battles" was confusing.
          <></>
        ) : sortedBattles.length === 0 ? (
          <div className="cbh__empty">
            <div className="cbh__empty-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
                <line x1="13" y1="19" x2="19" y2="13" />
                <line x1="16" y1="16" x2="20" y2="20" />
                <line x1="19" y1="21" x2="21" y2="19" />
              </svg>
            </div>
            <p className="cbh__empty-title">No open battles</p>
            <p className="cbh__empty-text">
              Be the first to start the action — stack cases, pick a mode, and open your lobby.
            </p>
            <Link to="/case-battles/create" className="cb-page__btn-primary cbh__empty-cta">
              <span className="cbh__create-icon" aria-hidden>
                +
              </span>
              Create the first battle
            </Link>
          </div>
        ) : (
          <div className="cbh__list">
            {sortedBattles.map((row) => {
              const caseIds = uniqueCaseIdsFromRow(row.case_ids, row.case_id);
              const thumbs = caseIds.slice(0, CASE_THUMB_LIMIT);
              const extraCases = caseIds.length - thumbs.length;
              const filled = Number(row.player_count);
              const max = row.max_players;
              const spotsLeft = max - filled;
              const isCreator = row.creator_id === user?.id;
              const entry = Number(row.entry_cost);
              const joinable = battleIsJoinable(row);
              const canJoin =
                !!user &&
                joinable &&
                !isCreator &&
                spotsLeft > 0 &&
                balance >= entry;

              return (
                <article
                  key={row.battle_id}
                  className={`cbh__card${isCreator ? " cbh__card--yours" : ""}`}
                  onClick={() => openBattle(row.battle_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openBattle(row.battle_id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Battle ${row.player_mode} ${gamemodeLabel(row.gamemode)}`}
                >
                  <header className="cbh__card-head">
                    <div className="cbh__card-badges">
                      <span className="cbh__badge cbh__badge--mode">
                        <span aria-hidden>{gamemodeIcon(row.gamemode)}</span>
                        {gamemodeLabel(row.gamemode)}
                      </span>
                      <span className="cbh__badge">{row.player_mode}</span>
                      {row.crazy_mode && (
                        <span className="cbh__badge cbh__badge--crazy">Crazy</span>
                      )}
                      {row.fast_spin && (
                        <span className="cbh__badge cbh__badge--fast">Fast</span>
                      )}
                      {isCreator && (
                        <span className="cbh__badge cbh__badge--yours">Yours</span>
                      )}
                    </div>
                    <span
                      className={
                        "cbh__status" +
                        (row.status === "completed"
                          ? " cbh__status--ended"
                          : row.status === "running" || row.status === "pending_eos"
                            ? " cbh__status--live"
                            : "")
                      }
                    >
                      {battleStatusLabel(row.status)}
                    </span>
                  </header>

                  <div className="cbh__card-pot">
                    <span className="cbh__card-pot-label">Pot total</span>
                    <span className="cbh__card-pot-value">
                      {formatCoins(row.pot_total, "balance")}
                    </span>
                  </div>

                  {thumbs.length > 0 && (
                    <div className="cbh__card-cases">
                      {thumbs.map((id) => {
                        const c = getCaseById(id);
                        return (
                          <span
                            key={id}
                            className="cbh__case-chip"
                            title={c?.name ?? id}
                            style={{
                              borderColor: c?.accent ?? undefined,
                              background: c
                                ? `linear-gradient(145deg, ${c.accent}33, rgba(0,0,0,0.5))`
                                : undefined,
                            }}
                          >
                            <span aria-hidden>
                              <Package size={14} />
                            </span>
                          </span>
                        );
                      })}
                      {extraCases > 0 && (
                        <span className="cbh__cases-more">+{extraCases}</span>
                      )}
                    </div>
                  )}

                  <div className="cbh__card-meta">
                    <div className="cbh__meta">
                      <span className="cbh__meta-label">Rounds</span>
                      <span className="cbh__meta-value">{row.rounds}</span>
                    </div>
                    <div className="cbh__meta">
                      <span className="cbh__meta-label">Entry</span>
                      <span className="cbh__meta-value">
                        {formatCoins(entry, "balance")}
                      </span>
                    </div>
                    <div className="cbh__meta">
                      <span className="cbh__meta-label">Age</span>
                      <span className="cbh__meta-value">
                        {formatBattleAge(row.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className="cbh__card-slots">
                    <div className="cbh__slots-head">
                      <span className="cbh__slots-label">
                        {filled}/{max} players
                      </span>
                      <span
                        className={
                          "cbh__slots-status" +
                          (spotsLeft > 0 ? " cbh__slots-status--open" : " cbh__slots-status--full")
                        }
                      >
                        {spotsLeft > 0 ? `${spotsLeft} open` : "Full"}
                      </span>
                    </div>
                    <div className="cbh__slots" aria-hidden>
                      {Array.from({ length: max }, (_, i) => (
                        <span
                          key={i}
                          className={"cbh__slot" + (i < filled ? " cbh__slot--filled" : "")}
                        >
                          {i < filled && (
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                            </svg>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="cbh__card-actions">
                    {isCreator ? (
                      <button
                        type="button"
                        className="cbh__join-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBattle(row.battle_id);
                        }}
                      >
                        Open lobby
                      </button>
                    ) : !user ? (
                      <Link
                        to={loginUrl(pathname)}
                        className="cbh__join-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Log in to join
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="cbh__join-btn"
                        disabled={!canJoin}
                        title={
                          !joinable
                            ? "This battle has ended"
                            : spotsLeft <= 0
                              ? "Battle is full"
                              : balance < entry
                                ? "Insufficient balance"
                                : undefined
                        }
                        onClick={(e) => void handleJoin(e, row)}
                      >
                        Join battle
                      </button>
                    )}
                    <button
                      type="button"
                      className="cbh__view-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBattle(row.battle_id);
                      }}
                    >
                      View
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <p className="cbh__footer">
        Need funds? <Link to="/deposit">Deposit</Link> to join battles.
      </p>
    </div>
  );
}