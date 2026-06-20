import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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

  useEffect(() => {
    setLoading(true);
    void loadLobby();
  }, [loadLobby]);

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
          <Link to="/case-battles/create" className="cb-page__btn-primary">
            + Create
          </Link>
        }
      />

      <section className="cb-page__hero">
        <div className="cb-page__hero-text">
          <h2 className="cb-page__hero-title">PvP case opens</h2>
          <p className="cb-page__hero-lead">
            Join a lobby, fill every slot with players or bots, then battle through your case
            lineup. Highest total unboxed wins the pot.
          </p>
        </div>
        <div className="cb-page__stats">
          <div className="cb-page__stat">
            <span className="cb-page__stat-value">{openBattles.length}</span>
            <span className="cb-page__stat-label">Open</span>
          </div>
          <div className="cb-page__stat">
            <span className="cb-page__stat-value">{formatCoins(totalPot, "balance")}</span>
            <span className="cb-page__stat-label">In pots</span>
          </div>
        </div>
      </section>

      <div className="cb-page__panel">
        <div className="cb-page__panel-head">
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
          <p className="cb-page__error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="cbh__list">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <div key={i} className="cbh__skeleton" aria-hidden />
            ))}
          </div>
        ) : sortedBattles.length === 0 ? (
          <div className="cbh__empty">
            <div className="cbh__empty-icon" aria-hidden>
              ⚔️
            </div>
            <p className="cbh__empty-title">No open battles</p>
            <p>Start the action — stack cases, pick a mode, and open your lobby.</p>
            <Link to="/case-battles/create" className="cb-page__btn-primary">
              Create battle
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
              const fillPct = max > 0 ? Math.round((filled / max) * 100) : 0;
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
                  <div className="cbh__card-main">
                    <div className="cbh__card-top">
                      <span
                        className={
                          "cbh__badge cbh__badge--status" +
                          (row.status === "completed"
                            ? " cbh__badge--ended"
                            : row.status === "running" || row.status === "pending_eos"
                              ? " cbh__badge--live"
                              : "")
                        }
                      >
                        {battleStatusLabel(row.status)}
                      </span>
                      <span className="cbh__badge">{row.player_mode}</span>
                      <span className="cbh__badge cbh__badge--mode">
                        <span aria-hidden>{gamemodeIcon(row.gamemode)}</span>
                        {gamemodeLabel(row.gamemode)}
                      </span>
                      {row.crazy_mode && (
                        <span className="cbh__badge cbh__badge--crazy">Crazy</span>
                      )}
                      {row.fast_spin && (
                        <span className="cbh__badge cbh__badge--fast">Fast</span>
                      )}
                      {isCreator && <span className="cbh__badge cbh__badge--yours">Your battle</span>}
                      <span className="cbh__badge cbh__badge--age">
                        {formatBattleAge(row.created_at)}
                      </span>
                    </div>

                    <div className="cbh__cases-stack">
                      {thumbs.map((id) => {
                        const c = getCaseById(id);
                        return (
                          <span
                            key={id}
                            className="cb-page__case-chip cb-page__case-chip--md"
                            title={c?.name ?? id}
                            style={{
                              borderColor: c?.accent ?? undefined,
                              background: c
                                ? `linear-gradient(145deg, ${c.accent}44, rgba(0,0,0,0.4))`
                                : undefined,
                              zIndex: 1,
                            }}
                          >
                            📦
                          </span>
                        );
                      })}
                      {extraCases > 0 && (
                        <span className="cbh__cases-more">+{extraCases}</span>
                      )}
                    </div>

                    <div className="cbh__card-metrics">
                      <span className="cbh__metric">
                        <strong>{row.rounds}</strong> rounds
                      </span>
                      <span className="cbh__metric">
                        <strong>{formatCoins(entry, "balance")}</strong> / player
                      </span>
                      <span className="cbh__metric cbh__metric--pot">
                        Pot <strong>{formatCoins(row.pot_total, "balance")}</strong>
                      </span>
                    </div>

                    <div className="cbh__fill">
                      <div className="cbh__fill-label">
                        <span>
                          {filled}/{max} players
                        </span>
                        <span>{spotsLeft > 0 ? `${spotsLeft} open` : "Full"}</span>
                      </div>
                      <div className="cbh__fill-bar" aria-hidden>
                        <span style={{ width: `${fillPct}%` }} />
                      </div>
                      <div className="cbh__slots" aria-hidden>
                        {Array.from({ length: max }, (_, i) => (
                          <span
                            key={i}
                            className={
                              "cbh__slot-dot" + (i < filled ? " cbh__slot-dot--filled" : "")
                            }
                          >
                            {i < filled ? "✓" : ""}
                          </span>
                        ))}
                      </div>
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
                        Join
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