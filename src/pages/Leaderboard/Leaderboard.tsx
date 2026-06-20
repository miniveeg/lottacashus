import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy, Crown, Medal } from "lucide-react";
import { motion } from "framer-motion";
import { formatUsd } from "../../lib/format";
import {
  fetchBiggestWins,
  fetchMostWagered,
  type LeaderboardTab,
  type LeaderboardEntry,
} from "../../lib/leaderboard";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Leaderboard.css";

const TABS: {
  id: LeaderboardTab;
  label: string;
  valueLabel: string;
  secondaryLabel?: string;
}[] = [
  { id: "wins", label: "Biggest Wins", valueLabel: "Win amount" },
  { id: "wagered", label: "Most Wagered", valueLabel: "Total wagered", secondaryLabel: "Win rate" },
];

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

  useEffect(() => {
    load();
  }, [load]);

  const currentTab = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="leaderboard-page lc-page lc-page--medium">
      {/* ── Header ── */}
      <motion.header
        className="leaderboard-page__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="leaderboard-page__eyebrow" variants={fadeUpVariants}>
          <Trophy size={12} strokeWidth={2.4} />
          Leaderboard
        </motion.span>
        <motion.h1 className="leaderboard-page__title" variants={fadeUpVariants}>
          Top players on LottaCash
        </motion.h1>
        <motion.p className="leaderboard-page__subtitle" variants={fadeUpVariants}>
          The biggest single wins and lifetime wagers across the platform. Updated in real time as
          bets settle.
        </motion.p>
      </motion.header>

      {/* ── Tabs ── */}
      <div className="leaderboard-tabs" role="tablist" aria-label="Leaderboard categories">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`leaderboard-tab${tab === t.id ? " leaderboard-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="leaderboard-loading">
          <div className="leaderboard-loading__pulse" aria-hidden />
          <p>Loading leaderboard…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="leaderboard-empty">
          <Trophy size={32} aria-hidden="true" />
          <p className="leaderboard-empty__title">No leaderboard data yet</p>
          <p className="leaderboard-empty__hint">Be the first to play and claim the top spot.</p>
        </div>
      ) : (
        <>
          {/* ── Podium (top 3) ── */}
          {podium.length > 0 && (
            <ScrollReveal className="leaderboard-podium" as="div">
              {podium.map((entry, idx) => (
                <PodiumCard
                  key={entry.rank}
                  entry={entry}
                  index={idx}
                  valueLabel={currentTab.valueLabel}
                  showSecondary={tab === "wagered"}
                />
              ))}
            </ScrollReveal>
          )}

          {/* ── Table (rank 4+) — desktop ── */}
          {rest.length > 0 && (
            <ScrollReveal className="leaderboard-table-wrap" as="div">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th className="leaderboard-table__rank">Rank</th>
                    <th>Player</th>
                    <th className="leaderboard-table__amount">{currentTab.valueLabel}</th>
                    {currentTab.secondaryLabel ? (
                      <th className="leaderboard-table__secondary">{currentTab.secondaryLabel}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rest.map((entry) => (
                    <tr key={entry.rank}>
                      <td className="leaderboard-table__rank">{entry.rank}</td>
                      <td className="leaderboard-table__user">
                        <span className="leaderboard-table__avatar" aria-hidden="true">
                          {entry.username[0]?.toUpperCase() ?? "?"}
                        </span>
                        <span className="leaderboard-table__username">{entry.username}</span>
                      </td>
                      <td className="leaderboard-table__amount">{formatUsd(entry.value)}</td>
                      {currentTab.secondaryLabel ? (
                        <td className="leaderboard-table__secondary">
                          {entry.secondary != null ? `${entry.secondary.toFixed(1)}%` : "—"}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollReveal>
          )}

          {/* ── Mobile card list ── */}
          {rest.length > 0 && (
            <ScrollReveal className="leaderboard-cards" as="div">
              {rest.map((entry) => (
                <div key={entry.rank} className="leaderboard-card">
                  <div className="leaderboard-card__rank">#{entry.rank}</div>
                  <div className="leaderboard-card__user">
                    <span className="leaderboard-table__avatar" aria-hidden="true">
                      {entry.username[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="leaderboard-table__username">{entry.username}</span>
                  </div>
                  <div className="leaderboard-card__values">
                    <span className="leaderboard-card__amount">{formatUsd(entry.value)}</span>
                    {currentTab.secondaryLabel && entry.secondary != null ? (
                      <span className="leaderboard-card__secondary">
                        {entry.secondary.toFixed(1)}% win rate
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </ScrollReveal>
          )}
        </>
      )}
    </div>
  );
}

type PodiumCardProps = {
  entry: LeaderboardEntry;
  index: number;
  valueLabel: string;
  showSecondary: boolean;
};

function PodiumCard({ entry, index, valueLabel, showSecondary }: PodiumCardProps) {
  const rank = entry.rank;
  const config = PODIUM_CONFIG[index] ?? PODIUM_CONFIG[0];
  const Icon = rank === 1 ? Crown : Medal;

  return (
    <article className={`leaderboard-podium__card leaderboard-podium__card--${rank}`}>
      <div className="leaderboard-podium__accent" aria-hidden="true" style={{ background: config.accent }} />
      <div className="leaderboard-podium__medal" aria-hidden="true">
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="leaderboard-podium__rank-label">#{rank}</div>
      <div className="leaderboard-podium__avatar" aria-hidden="true">
        {entry.username[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="leaderboard-podium__name">{entry.username}</div>
      <div className="leaderboard-podium__value">{formatUsd(entry.value)}</div>
      <div className="leaderboard-podium__value-label">{valueLabel.toLowerCase()}</div>
      {showSecondary && entry.secondary != null ? (
        <div className="leaderboard-podium__secondary">
          {entry.secondary.toFixed(1)}% win rate
        </div>
      ) : null}
    </article>
  );
}

const PODIUM_CONFIG = [
  { accent: "linear-gradient(180deg, rgba(245, 185, 66, 0.22) 0%, transparent 70%)" },
  { accent: "linear-gradient(180deg, rgba(192, 192, 192, 0.18) 0%, transparent 70%)" },
  { accent: "linear-gradient(180deg, rgba(205, 127, 50, 0.18) 0%, transparent 70%)" },
];
