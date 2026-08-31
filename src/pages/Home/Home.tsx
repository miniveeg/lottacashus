import { motion, useReducedMotion } from "framer-motion";
import { Wallet, Zap, TrendingUp, Dices } from "lucide-react";
import { Link } from "react-router-dom";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { TiltCard } from "../../components/ui/TiltCard";
import { PageLayout } from "../../components/PageLayout/PageLayout";
import { useAuth } from "../../contexts/AuthContext";
import { Seo } from "../../components/Seo/Seo";
import { ORIGINAL_GAMES } from "../../content/originals";
import { GAME_ICONS } from "../../components/BrandGameIcons";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Home.css";

const pillars = [
  {
    title: "One balance",
    desc: "A single SC wallet across every game. Deposit, play, and redeem from one place.",
    icon: Wallet,
  },
  {
    title: "Crypto in & out",
    desc: "Deposit SOL, LTC, or ETH. Redeem SC back to your own wallet.",
    icon: Zap,
  },
  {
    title: "Level up",
    desc: "Wager-based ranks 0 to 100. Progress is permanent.",
    icon: TrendingUp,
  },
  {
    title: "House originals",
    desc: "Eight provably fair games on one balance.",
    icon: Dices,
  },
];

export function Home() {
  const { user, loading, isGuest } = useAuth();
  const reduceMotion = useReducedMotion();
  const signedIn = Boolean(user) && !isGuest;

  return (
    <PageLayout variant="default" className="home" hideHeader>
      <Seo title="LottaCash" path="/" />
      <section className="home__hero lc-glass lc-glass--crimson">
        <div className="home__hero-fog" aria-hidden="true" />

        <motion.div
          className="home__hero-copy"
          initial={reduceMotion ? false : "hidden"}
          animate="visible"
          variants={staggerContainer}
        >
          <motion.p className="home__eyebrow" variants={fadeUpVariants}>
            SOL · LTC · ETH accepted
          </motion.p>
          <motion.h1 className="home__headline" variants={fadeUpVariants}>
            Eight provably fair house games. <span>One SC balance.</span>
          </motion.h1>
          <motion.p className="home__lead" variants={fadeUpVariants}>
            Deposit SOL, LTC, or ETH and play any of the eight provably fair house games. Redeem SC
            back to your own wallet. Every wager raises your level — permanently.
          </motion.p>
          <motion.div className="home__cta" variants={fadeUpVariants}>
            {!loading && signedIn ? (
              <>
                <MotionLink to="/deposit" variant="primary" glow>
                  Buy chips
                </MotionLink>
                <MotionLink to="/originals" variant="secondary">
                  Sit a table
                </MotionLink>
                <MotionLink to="/profile" variant="ghost">
                  Your profile
                </MotionLink>
              </>
            ) : (
              <>
                <MotionLink to="/signup" variant="primary" glow>
                  Create account
                </MotionLink>
                <MotionLink to="/login" variant="secondary">
                  Log in
                </MotionLink>
                <MotionLink to="/originals" variant="ghost">
                  Browse tables
                </MotionLink>
              </>
            )}
            <MotionLink to="/help" variant="ghost">
              FAQ & Terms
            </MotionLink>
          </motion.div>
        </motion.div>
      </section>

      <ScrollReveal className="home__floor">
        <p className="home__floor-eyebrow">The floor</p>
        <h2 className="home__section-title">Eight tables. One stack.</h2>
        <p className="home__section-text">
          Same chips on every original. Sit down, place a bet, cash out — or walk.
        </p>
        <div className="home__tables">
          {ORIGINAL_GAMES.map((game) => {
            const Icon = GAME_ICONS[game.id];
            return (
              <Link key={game.id} to={game.href} className="home__table">
                <span className="home__table-icon" aria-hidden="true">
                  {Icon ? <Icon size={22} /> : null}
                </span>
                <span className="home__table-copy">
                  <span className="home__table-name">{game.name}</span>
                  <span className="home__table-hook">{game.hook}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </ScrollReveal>

      <ScrollReveal className="home__intro">
        <h2 className="home__section-title">From chips in to cash out</h2>
        <p className="home__section-text">
          Deposit crypto, get SC credited at 100 SC per $1, and play any table. Redeem SC for crypto
          back to your wallet. Bets, level, deposits, and withdrawals all live in Settings.
        </p>
      </ScrollReveal>

      <ScrollReveal className="home__pillars" delay={1}>
        <h2 className="home__section-title">Four things to know</h2>
        <div className="home__pillar-grid">
          {pillars.map((item, i) => (
            <ScrollReveal key={item.title} delay={i * 0.5}>
              <TiltCard className="home__pillar">
                <div className="home__pillar-icon" aria-hidden="true">
                  <item.icon size={22} strokeWidth={1.75} />
                </div>
                <h3 className="home__pillar-title">{item.title}</h3>
                <p className="home__pillar-desc">{item.desc}</p>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </ScrollReveal>

      <ScrollReveal className="home__footer-cta" delay={2}>
        <p className="home__footer-cta-text">
          New here? The FAQ and Terms walk through how deposits, levels, and withdrawals actually
          work.
        </p>
        <MotionLink to="/help" variant="secondary">
          Open Help page
        </MotionLink>
      </ScrollReveal>
    </PageLayout>
  );
}
