import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { ORIGINAL_GAMES, type OriginalGame } from "../../content/originals";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { Seo } from "../../components/Seo/Seo";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import { GAME_ICONS } from "../../components/BrandGameIcons";
import "./Originals.css";

/** Difficulty meter: 5 segments, filled = active difficulty. */
function DifficultyMeter({ level }: { level: number }) {
  return (
    <span className="originals__diff" aria-label={`Difficulty ${level} of 5`} title={`Difficulty ${level}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`originals__diff-seg${n <= level ? " originals__diff-seg--on" : ""}`} />
      ))}
    </span>
  );
}

/** Featured (large) bento card — used for the first game (Crash). */
function FeaturedCard({ game }: { game: OriginalGame }) {
  const Icon = GAME_ICONS[game.id];
  return (
    <ScrollReveal delay={0} className="originals__featured">
      <Link to={game.href} className="originals__featured-link">
        <div className="originals__featured-glow" aria-hidden="true" />
        <div className="originals__featured-content">
          <div className="originals__featured-eyebrow">
            <span className="originals__featured-icon" aria-hidden="true">
              {Icon && <Icon size={26} />}
            </span>
            {game.tag && <span className="originals__badge originals__badge--featured">{game.tag}</span>}
          </div>
          <h2 className="originals__featured-title">{game.name}</h2>
          <p className="originals__featured-hook">{game.hook ?? game.description}</p>
          <p className="originals__featured-desc">{game.description}</p>
          <div className="originals__featured-meta">
            {game.rtp && <span className="originals__meta-chip">{game.rtp}</span>}
            {game.maxWin && <span className="originals__meta-chip originals__meta-chip--win">Max {game.maxWin}</span>}
            {game.minBet != null && <span className="originals__meta-chip">Min {game.minBet} GC</span>}
            {game.difficulty != null && <DifficultyMeter level={game.difficulty} />}
          </div>
          <span className="originals__featured-cta">
            Play now <ArrowRight size={16} strokeWidth={2.25} />
          </span>
        </div>
      </Link>
    </ScrollReveal>
  );
}

/** Standard bento card. */
function GameCard({ game, index }: { game: OriginalGame; index: number }) {
  const Icon = GAME_ICONS[game.id];
  return (
    <ScrollReveal delay={Math.min(index * 0.12, 0.6)}>
      <Link to={game.href} className="originals__card">
        <div className="originals__card-top">
          <span className="originals__card-icon" aria-hidden="true">
            {Icon && <Icon size={20} />}
          </span>
          {game.live && game.tag ? (
            <span className="originals__badge">{game.tag}</span>
          ) : (
            <span className="originals__badge originals__badge--soon">Soon</span>
          )}
        </div>
        <h3 className="originals__card-title">{game.name}</h3>
        <p className="originals__card-hook">{game.hook}</p>
        <p className="originals__card-desc">{game.description}</p>
        <div className="originals__card-meta">
          {game.rtp && <span className="originals__meta-chip">{game.rtp}</span>}
          {game.maxWin && <span className="originals__meta-chip originals__meta-chip--win">{game.maxWin}</span>}
        </div>
        <div className="originals__card-foot">
          {game.difficulty != null && <DifficultyMeter level={game.difficulty} />}
          <span className="originals__card-play">
            Play <ArrowRight size={13} strokeWidth={2.5} />
          </span>
        </div>
      </Link>
    </ScrollReveal>
  );
}

export function Originals() {
  const [featured, ...rest] = ORIGINAL_GAMES;
  return (
    <div className="originals lc-page">
      <Seo
        title="Originals"
        description="Eight provably fair house games: Crash, Case Battles, Blackjack, Roulette, Mines, Keno, Limbo, and Slots."
        path="/originals"
      />
      <motion.header
        className="lc-page__header originals__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.p className="originals__eyebrow" variants={fadeUpVariants}>
          House games
        </motion.p>
        <motion.h1 className="lc-page__title originals__title" variants={fadeUpVariants}>
          Eight games. One wallet.
        </motion.h1>
        <motion.p className="lc-page__subtitle originals__lead" variants={fadeUpVariants}>
          Provably fair, built in-house, and tied to a single balance. Wager in Gold Coins for fun or
          Sweeps Coins for real crypto redemptions. Your level climbs across every game.
        </motion.p>
      </motion.header>

      <div className="originals__stats">
        <div className="originals__stat">
          <span className="originals__stat-num">8</span>
          <span className="originals__stat-label">House games</span>
        </div>
        <div className="originals__stat">
          <span className="originals__stat-num">96.5%</span>
          <span className="originals__stat-label">RTP (most games)</span>
        </div>
        <div className="originals__stat">
          <span className="originals__stat-num">1M×</span>
          <span className="originals__stat-label">Max win (Crash/Limbo)</span>
        </div>
        <div className="originals__stat">
          <span className="originals__stat-num">3</span>
          <span className="originals__stat-label">Crypto rails (SOL/LTC/ETH)</span>
        </div>
      </div>

      <div className="originals__bento">
        {featured && <FeaturedCard game={featured} />}
        <div className="originals__grid">
          {rest.map((game, i) => (
            <GameCard key={game.id} game={game} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
