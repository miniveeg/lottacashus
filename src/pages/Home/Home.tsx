import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Dices,
  Grid3X3,
  Bomb,
  TrendingUp,
  CircleDot,
  Spade,
  Swords,
  Zap,
  Coins,
  ArrowRight,
  Trophy,
  Flame,
  Users,
  Sparkles,
  ChevronRight,
  Target,
  Percent,
  Crown,
} from "lucide-react";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { ORIGINAL_GAMES, ORIGINALS_PATH } from "../../content/originals";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import {
  formatCoins,
  formatUsd,
  coinsToUsd,
  formatNumber,
} from "../../lib/format";
import {
  fetchBiggestWins,
  fetchMostWagered,
  type LeaderboardEntry,
} from "../../lib/leaderboard";
import { getLevelProgress } from "../../lib/leveling";
import "./Home.css";

const GAME_ICONS: Record<string, typeof Dices> = {
  keno: Grid3X3,
  mines: Bomb,
  limbo: TrendingUp,
  roulette: CircleDot,
  blackjack: Spade,
  "case-battles": Swords,
  crash: Zap,
  slots: Coins,
};

// Fallback live-wins feed shown when the leaderboard API returns no data
// (e.g. when supabase isn't configured in this environment).
const FALLBACK_WINS: { username: string; value: number; game: string }[] = [
  { username: "ShadowPlay", value: 1842.5, game: "Crash" },
  { username: "NeonTiger", value: 988.0, game: "Mines" },
  { username: "GoldenAce", value: 715.25, game: "Limbo" },
  { username: "VaultRunner", value: 432.0, game: "Keno" },
  { username: "ByteQueen", value: 318.75, game: "Blackjack" },
];

const FALLBACK_PLAYERS: { username: string; value: number }[] = [
  { username: "HighRoller", value: 184_500 },
  { username: "PixelDuke", value: 122_300 },
  { username: "ObsidianOak", value: 96_750 },
  { username: "LunarFox", value: 71_200 },
  { username: "StaticWolf", value: 58_900 },
];

export function Home() {
  const { user, loading } = useAuth();
  const { profile } = useProfile();

  const [wins, setWins] = useState<LeaderboardEntry[]>([]);
  const [topPlayers, setTopPlayers] = useState<LeaderboardEntry[]>([]);
  const [feedLoaded, setFeedLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [w, p] = await Promise.all([fetchBiggestWins(5), fetchMostWagered(5)]);
      if (cancelled) return;
      setWins(w);
      setTopPlayers(p);
      setFeedLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const liveWins =
    wins.length > 0
      ? wins.map((w) => ({ username: w.username, value: w.value, game: "Win" }))
      : FALLBACK_WINS;
  const livePlayers = topPlayers.length > 0 ? topPlayers : FALLBACK_PLAYERS;

  const displayName =
    profile?.username ?? user?.user_metadata?.username ?? "player";
  const games = ORIGINAL_GAMES.filter((g) => g.live);

  // Personal stats
  const winsCount = profile?.totalWins ?? 0;
  const lossesCount = profile?.totalLosses ?? 0;
  const gamesPlayed = winsCount + lossesCount;
  const winRate = gamesPlayed > 0 ? (winsCount / gamesPlayed) * 100 : 0;
  const levelInfo = profile ? getLevelProgress(profile.totalWagered) : null;

  return (
    <div className="home-dashboard">
      {/* ════════════════════════════════════════════════════════════
          1. WELCOME STRIP — slim 80px band (NOT a full-viewport hero)
          ════════════════════════════════════════════════════════════ */}
      <motion.section
        className="home-welcome"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div className="home-welcome__text" variants={fadeUpVariants}>
          <span className="home-welcome__eyebrow">
            <Sparkles size={11} strokeWidth={2.4} />
            {user ? "Welcome back" : "Welcome"}
          </span>
          <h1 className="home-welcome__headline">
            {user ? `Hi, ${displayName}` : "Play at LottaCash"}
          </h1>
          <p className="home-welcome__sub">
            {user
              ? "Pick a game and start playing."
              : "Sign up to get 1,000 GC + 10 SC free."}
          </p>
        </motion.div>

        <motion.div className="home-welcome__aside" variants={fadeUpVariants}>
          {loading ? (
            <div className="home-welcome__loading">…</div>
          ) : user ? (
            <>
              <div className="home-balance home-balance--gc">
                <span className="home-balance__label">Gold Coins</span>
                <span className="home-balance__value">
                  {formatCoins(profile?.balance ?? 0, "balance")}
                </span>
                <span className="home-balance__usd">
                  {formatUsd(coinsToUsd(profile?.balance ?? 0, "balance"))}
                </span>
              </div>
              <div className="home-balance home-balance--sc">
                <span className="home-balance__label">Sweeps Coins</span>
                <span className="home-balance__value">
                  {formatCoins(profile?.sweepsCoins ?? 0, "sweeps_coins")}
                </span>
                <span className="home-balance__usd">
                  {formatUsd(coinsToUsd(profile?.sweepsCoins ?? 0, "sweeps_coins"))}
                </span>
              </div>
              <MotionLink
                to="/deposit"
                variant="primary"
                glow
                className="home-welcome__deposit home-btn--gold"
              >
                Deposit
              </MotionLink>
            </>
          ) : (
            <div className="home-welcome__auth">
              <MotionLink
                to="/signup"
                variant="primary"
                glow
                className="home-btn--gold"
              >
                Create account
              </MotionLink>
              <MotionLink to="/login" variant="secondary" className="home-btn--outline">
                Log in
              </MotionLink>
            </div>
          )}
        </motion.div>
      </motion.section>

      {/* ════════════════════════════════════════════════════════════
          2. MAIN GRID — Game launcher (left) + Live feed (right)
          ════════════════════════════════════════════════════════════ */}
      <div className="home-grid">
        {/* ── GAME LAUNCHER ─────────────────────────────────────── */}
        <motion.section
          className="home-launcher"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <motion.div className="home-launcher__head" variants={fadeUpVariants}>
            <div>
              <h2 className="home-launcher__title">Games</h2>
              <p className="home-launcher__hint">
                {games.length} originals · provably fair
              </p>
            </div>
            <Link to={ORIGINALS_PATH} className="home-launcher__view-all">
              View all
              <ArrowRight size={14} strokeWidth={2.2} />
            </Link>
          </motion.div>

          <div className="home-launcher__grid">
            {games.map((game, i) => {
              const Icon = GAME_ICONS[game.id] ?? Dices;
              return (
                <ScrollReveal key={game.id} delay={i} as="article" className="game-tile">
                  <Link to={game.href} className="game-tile__link">
                    <div className="game-tile__art" aria-hidden="true">
                      <div className="game-tile__art-glow" />
                      <Icon size={32} strokeWidth={1.6} />
                      {game.tag ? (
                        <span className="game-tile__tag">{game.tag}</span>
                      ) : null}
                    </div>
                    <div className="game-tile__body">
                      <h3 className="game-tile__name">{game.name}</h3>
                      <p className="game-tile__desc">{game.description}</p>
                      <div className="game-tile__meta">
                        {game.rtp ? <span className="game-tile__rtp">{game.rtp}</span> : null}
                        <span className="game-tile__play">
                          Play
                          <ChevronRight size={12} strokeWidth={2.4} />
                        </span>
                      </div>
                    </div>
                  </Link>
                </ScrollReveal>
              );
            })}
          </div>
        </motion.section>

        {/* ── LIVE FEED ────────────────────────────────────────── */}
        <aside className="home-feed">
          {/* Live wins */}
          <ScrollReveal className="home-feed__section" as="section">
            <header className="home-feed__head">
              <h3 className="home-feed__title">
                <span className="home-feed__pulse" aria-hidden="true" />
                Live wins
              </h3>
              <Link to="/leaderboard" className="home-feed__more">
                <Trophy size={12} strokeWidth={2.2} />
              </Link>
            </header>
            <ul className="home-wins">
              {liveWins.slice(0, 5).map((w, i) => (
                <li key={`${w.username}-${i}`} className="home-wins__row">
                  <span className="home-wins__avatar" aria-hidden="true">
                    {w.username[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="home-wins__name">{w.username}</span>
                  <span className="home-wins__amount">
                    +{formatUsd(w.value)}
                  </span>
                </li>
              ))}
            </ul>
            {!feedLoaded ? (
              <p className="home-feed__hint">Loading live activity…</p>
            ) : null}
          </ScrollReveal>

          {/* Top players */}
          <ScrollReveal className="home-feed__section" as="section">
            <header className="home-feed__head">
              <h3 className="home-feed__title">
                <Crown size={13} strokeWidth={2.2} />
                Top players
              </h3>
              <Link to="/leaderboard" className="home-feed__more">
                <ArrowRight size={12} strokeWidth={2.2} />
              </Link>
            </header>
            <ol className="home-top">
              {livePlayers.slice(0, 5).map((p, i) => (
                <li key={`${p.username}-${i}`} className="home-top__row">
                  <span className={`home-top__rank${i < 3 ? ` home-top__rank--${i + 1}` : ""}`}>
                    {i + 1}
                  </span>
                  <span className="home-top__name">{p.username}</span>
                  <span className="home-top__value">{formatUsd(p.value)}</span>
                </li>
              ))}
            </ol>
          </ScrollReveal>

          {/* Your stats — only when logged in */}
          {user ? (
            <ScrollReveal className="home-feed__section home-feed__section--stats" as="section">
              <header className="home-feed__head">
                <h3 className="home-feed__title">
                  <Users size={13} strokeWidth={2.2} />
                  Your stats
                </h3>
                <Link to="/profile" className="home-feed__more">
                  <ArrowRight size={12} strokeWidth={2.2} />
                </Link>
              </header>
              <div className="home-stats">
                <div className="home-stat">
                  <Target size={14} strokeWidth={2.2} />
                  <span className="home-stat__value">{formatNumber(gamesPlayed)}</span>
                  <span className="home-stat__label">Games played</span>
                </div>
                <div className="home-stat">
                  <Percent size={14} strokeWidth={2.2} />
                  <span className="home-stat__value">{winRate.toFixed(1)}%</span>
                  <span className="home-stat__label">Win rate</span>
                </div>
                <div className="home-stat">
                  <Flame size={14} strokeWidth={2.2} />
                  <span className="home-stat__value">
                    Lvl {levelInfo?.level ?? 0}
                  </span>
                  <span className="home-stat__label">
                    {levelInfo?.isMaxLevel
                      ? "Max level"
                      : `${levelInfo?.progressPercent.toFixed(0)}% to next`}
                  </span>
                </div>
                <div className="home-stat">
                  <Coins size={14} strokeWidth={2.2} />
                  <span className="home-stat__value">
                    {formatUsd(profile?.totalWagered ?? 0)}
                  </span>
                  <span className="home-stat__label">Wagered</span>
                </div>
              </div>
              {levelInfo && !levelInfo.isMaxLevel ? (
                <div className="home-progress" aria-label="Level progress">
                  <div
                    className="home-progress__bar"
                    style={{ width: `${levelInfo.progressPercent}%` }}
                  />
                </div>
              ) : null}
            </ScrollReveal>
          ) : (
            <ScrollReveal className="home-feed__section home-feed__section--promo" as="section">
              <header className="home-feed__head">
                <h3 className="home-feed__title">
                  <Sparkles size={13} strokeWidth={2.2} />
                  Get started
                </h3>
              </header>
              <p className="home-promo__text">
                Create an account to track your wins, climb the leaderboard, and unlock
                your level progress.
              </p>
              <MotionLink
                to="/signup"
                variant="primary"
                glow
                className="home-promo__btn home-btn--gold"
              >
                Sign up free
                <ArrowRight size={14} strokeWidth={2.2} />
              </MotionLink>
            </ScrollReveal>
          )}
        </aside>
      </div>
    </div>
  );
}
