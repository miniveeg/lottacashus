import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { formatUsd } from "../../lib/format";
import { fetchBiggestWins, fetchMostWagered, type LeaderboardTab, type LeaderboardEntry } from "../../lib/leaderboard";
import { useProfile } from "../../contexts/ProfileContext";
import "./Leaderboard.css";

export function Leaderboard() {
  const [tab, setTab] = useState<LeaderboardTab>("wins");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useProfile();
  const currentUsername = profile?.username ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let data: LeaderboardEntry[];
      if (tab === "wins") {
        data = await fetchBiggestWins(50);
      } else {
        data = await fetchMostWagered(50);
      }
      if (cancelled) return;
      setEntries(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="lc-page leaderboard-page">
      <header className="lc-page__header">
        <h1 className="lc-page__title">Leaderboard</h1>
        <p className="lc-page__subtitle">Top players on LottaCash</p>
      </header>

      <div className="lc-tabs" role="tablist" aria-label="Leaderboard categories">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "wins"}
          className={`lc-tab${tab === "wins" ? " lc-tab--active" : ""}`}
          onClick={() => setTab("wins")}
        >
          Biggest Wins
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "wagered"}
          className={`lc-tab${tab === "wagered" ? " lc-tab--active" : ""}`}
          onClick={() => setTab("wagered")}
        >
          Most Wagered
        </button>
      </div>

      {loading ? (
        <div className="lc-loading" style={{ padding: "2rem" }}>
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="leaderboard-empty">
          <Trophy size={32} aria-hidden="true" />
          <p className="leaderboard-empty__title">No leaderboard data yet</p>
          <p className="leaderboard-empty__hint">Be the first to play and claim the top spot!</p>
        </div>
      ) : (
        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th className="leaderboard-table__rank">#</th>
                <th>Player</th>
                {tab === "wins" ? (
                  <th className="leaderboard-table__amount">Win Amount</th>
                ) : (
                  <>
                    <th className="leaderboard-table__amount">Total Wagered</th>
                    <th className="leaderboard-table__secondary">Win Rate</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isCurrentUser =
                  currentUsername != null &&
                  entry.username.toLowerCase() === currentUsername.toLowerCase();
                const rowClass = [
                  entry.rank <= 3 ? `leaderboard-table__row--top${entry.rank}` : "",
                  isCurrentUser ? "leaderboard-table__row--me" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={entry.rank} className={rowClass}>
                    <td className="leaderboard-table__rank">
                      {entry.rank <= 3 ? (
                        <span
                          className={`leaderboard-table__medal leaderboard-table__medal--${entry.rank}`}
                          aria-label={`Rank ${entry.rank}`}
                        >
                          {entry.rank === 1 ? (
                            <Trophy
                              size={20}
                              className="leaderboard-table__medal-icon--gold"
                              aria-hidden="true"
                            />
                          ) : entry.rank === 2 ? (
                            <Trophy
                              size={20}
                              className="leaderboard-table__medal-icon--silver"
                              aria-hidden="true"
                            />
                          ) : (
                            <Trophy
                              size={20}
                              className="leaderboard-table__medal-icon--bronze"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      ) : (
                        entry.rank
                      )}
                    </td>
                    <td className="leaderboard-table__user">
                      <span className="leaderboard-table__avatar" aria-hidden="true">
                        {entry.username[0]?.toUpperCase() ?? "?"}
                      </span>
                      {entry.username}
                      {isCurrentUser ? (
                        <span className="leaderboard-table__you" aria-label="(you)">
                          you
                        </span>
                      ) : null}
                    </td>
                    {tab === "wins" ? (
                      <td className="leaderboard-table__amount">{formatUsd(entry.value)}</td>
                    ) : (
                      <>
                        <td className="leaderboard-table__amount">{formatUsd(entry.value)}</td>
                        <td className="leaderboard-table__secondary">
                          {entry.secondary != null ? `${entry.secondary.toFixed(1)}%` : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
