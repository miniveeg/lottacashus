import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { formatUsd } from "../../lib/format";
import { fetchBiggestWins, fetchMostWagered, type LeaderboardTab, type LeaderboardEntry } from "../../lib/leaderboard";
import "./Leaderboard.css";

export function Leaderboard() {
  const [tab, setTab] = useState<LeaderboardTab>("wins");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let data: LeaderboardEntry[];
      if (tab === "wins") {
        data = await fetchBiggestWins(50);
      } else {
        data = await fetchMostWagered(50);
      }
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="lc-page leaderboard-page">
      <header className="leaderboard-header">
        <h1 className="leaderboard-header__title">Leaderboard</h1>
        <p className="leaderboard-header__subtitle">Top players on LottaCash</p>
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
        <div className="lc-empty">
          <p className="lc-alert">No leaderboard data yet. Be the first to play!</p>
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
              {entries.map((entry) => (
                <tr key={entry.rank}>
                  <td className="leaderboard-table__rank">
                    {entry.rank <= 3 ? (
                      <span className={`leaderboard-table__medal leaderboard-table__medal--${entry.rank}`}>
                        {entry.rank === 1 ? <Trophy size={20} className="leaderboard-table__medal-icon--gold" /> : entry.rank === 2 ? <Trophy size={20} className="leaderboard-table__medal-icon--silver" /> : <Trophy size={20} className="leaderboard-table__medal-icon--bronze" />}
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
