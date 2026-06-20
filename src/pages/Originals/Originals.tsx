import { motion } from "framer-motion";
import { Dices, Grid3X3, Bomb, TrendingUp, CircleDot, Spade, Swords, Zap, Coins } from "lucide-react";
import { ORIGINAL_GAMES } from "../../content/originals";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { MotionLink } from "../../components/ui/MotionLink";
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
  slots: Coins,
};

export function Originals() {
  return (
    <div className="originals lc-page lc-page--wide">
      <motion.header
        className="lc-page__header originals__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="lc-page__eyebrow" variants={fadeUpVariants}>
          House originals
        </motion.span>
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
            <ScrollReveal key={game.id} delay={i} as="article" className="originals__card">
              <div className="originals__card-art" aria-hidden="true">
                <div className="originals__card-art-glow" />
                <Icon size={34} strokeWidth={1.6} />
              </div>

              <div className="originals__card-body">
                <div className="originals__card-top">
                  <h2 className="originals__card-title">{game.name}</h2>
                  {game.live && game.tag ? (
                    <span className="originals__badge">{game.tag}</span>
                  ) : (
                    <span className="originals__badge originals__badge--soon">Soon</span>
                  )}
                </div>

                <p className="originals__card-desc">{game.description}</p>

                <div className="originals__card-meta">
                  {game.rtp ? (
                    <span className="originals__rtp">
                      <span className="originals__rtp-dot" aria-hidden="true" />
                      {game.rtp}
                    </span>
                  ) : null}
                  <span className="originals__fair">Provably fair</span>
                </div>

                <div className="originals__card-cta">
                  {game.live ? (
                    <MotionLink to={game.href} variant="primary" className="originals__card-btn">
                      Play now
                    </MotionLink>
                  ) : (
                    <span className="originals__card-btn originals__card-btn--disabled">
                      Coming soon
                    </span>
                  )}
                </div>
              </div>
            </ScrollReveal>
          );
        })}
      </div>
    </div>
  );
}
