import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Cherry, Dices, Grid3X3, Bomb, TrendingUp, CircleDot, Spade, Swords, Zap } from "lucide-react";
import { ORIGINAL_GAMES } from "../../content/originals";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { TiltCard } from "../../components/ui/TiltCard";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Originals.css";

const GAME_ICONS: Record<string, typeof Dices> = {
  keno: Grid3X3,
  mines: Bomb,
  limbo: TrendingUp,
  roulette: CircleDot,
  blackjack: Spade,
  "case-battles": Swords,
  crash: Zap,
  slots: Cherry,
};

export function Originals() {
  return (
    <div className="originals lc-page">
      <motion.header
        className="lc-page__header originals__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.p className="lc-page__eyebrow originals__eyebrow" variants={fadeUpVariants}>
          House originals
        </motion.p>
        <motion.h1 className="lc-page__title originals__title" variants={fadeUpVariants}>
          LottaCash Originals
        </motion.h1>
        <motion.p className="lc-page__subtitle originals__lead" variants={fadeUpVariants}>
          Fast, provably fair games built for the site — one wallet, wager-based levels, and no
          extra accounts. Pick a game below to play.
        </motion.p>
      </motion.header>

      <div className="originals__grid">
        {ORIGINAL_GAMES.map((game, i) => {
          const Icon = GAME_ICONS[game.id] ?? Dices;
          return (
            <ScrollReveal key={game.id} delay={i * 0.3}>
              <TiltCard className="originals__card">
                <div className="originals__card-top">
                  <span className="originals__card-icon" aria-hidden="true">
                    <Icon size={22} strokeWidth={1.75} />
                  </span>
                  {game.live && game.tag ? (
                    <span className="originals__badge">{game.tag}</span>
                  ) : (
                    <span className="originals__badge originals__badge--soon">Soon</span>
                  )}
                </div>
                <h2 className="originals__card-title">{game.name}</h2>
                <p className="originals__card-desc">{game.description}</p>
                {game.live ? (
                  <Link to={game.href} className="originals__card-btn originals__card-btn--play">
                    Play now
                  </Link>
                ) : (
                  <span className="originals__card-btn originals__card-btn--disabled">
                    Coming soon
                  </span>
                )}
              </TiltCard>
            </ScrollReveal>
          );
        })}
      </div>
    </div>
  );
}
