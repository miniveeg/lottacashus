import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Wallet, Zap, TrendingUp, Dices } from "lucide-react";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { TiltCard } from "../../components/ui/TiltCard";
import { useAuth } from "../../contexts/AuthContext";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Home.css";

// Lazy-load the 3D scene so Three.js is split into its own chunk and only
// fetched on the home page. This must match the lazy import used by
// AtmosphericLayer to avoid duplicate copies of the module.
const ObsidianScene = lazy(() =>
  import("../../components/atmosphere/ObsidianScene").then((m) => ({ default: m.ObsidianScene }))
);

const pillars = [
  {
    title: "One wallet",
    desc: "A single USD balance for everything on LottaCash — no juggling separate purses.",
    icon: Wallet,
  },
  {
    title: "Crypto in & out",
    desc: "Deposit and withdraw with SOL, LTC, and ETH. Your own addresses, on-chain transparency.",
    icon: Zap,
  },
  {
    title: "Level up",
    desc: "Wager-based ranks from 0 to 100. Progress is permanent and visible on your profile.",
    icon: TrendingUp,
  },
  {
    title: "House originals",
    desc: "Keno, Mines, Limbo, Blackjack, and Case Battles — provably fair, one wallet, wager-based levels.",
    icon: Dices,
  },
];

export function Home() {
  const { user, loading } = useAuth();

  return (
    <div className="home lc-page">
      <section className="home__hero lc-glass lc-glass--crimson">
        <div className="home__hero-3d" aria-hidden="true">
          <Suspense fallback={null}>
            <ObsidianScene className="home__hero-canvas" />
          </Suspense>
        </div>
        <div className="home__hero-fog" aria-hidden="true" />

        <motion.div
          className="home__hero-copy"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <motion.p className="home__eyebrow" variants={fadeUpVariants}>
            Welcome to LottaCash
          </motion.p>
          <motion.h1 className="home__headline" variants={fadeUpVariants}>
            Your seat at the table <span>starts here</span>
          </motion.h1>
          <motion.p className="home__lead" variants={fadeUpVariants}>
            A cinematic crypto casino built on one account, real on-chain rails, and rewards that
            grow with every wager. Six house originals are live — fund your wallet and play in
            seconds.
          </motion.p>
          <motion.div className="home__cta" variants={fadeUpVariants}>
            {!loading && user ? (
              <>
                <MotionLink to="/deposit" variant="primary" glow>
                  Deposit &amp; Play
                </MotionLink>
                <MotionLink to="/originals" variant="secondary">
                  Originals
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
              </>
            )}
            <MotionLink to="/help" variant="ghost">
              FAQ &amp; Terms
            </MotionLink>
          </motion.div>
        </motion.div>
      </section>

      <ScrollReveal className="home__intro">
        <h2 className="home__section-title">What is LottaCash?</h2>
        <p className="home__section-text">
          LottaCash is a dark, crimson-accented entertainment hub focused on clarity and speed:
          sign up with email verification, fund your wallet with cryptocurrency, track deposits
          and withdrawals in Settings, and climb levels as you wager. Notifications keep you
          informed when balances change or Discord is linked.
        </p>
      </ScrollReveal>

      <ScrollReveal className="home__pillars" delay={1}>
        <h2 className="home__section-title">How it works</h2>
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

      <ScrollReveal className="home__roadmap" delay={2}>
        <div className="home__roadmap-glow" aria-hidden="true" />
        <div className="home__roadmap-copy">
          <h2 className="home__section-title">What&rsquo;s next</h2>
          <ul className="home__roadmap-list">
            <li>
              <span className="home__roadmap-dot home__roadmap-dot--live" />
              Live now — accounts, crypto deposits &amp; withdrawals, leveling, Discord link, Help
            </li>
            <li>
              <span className="home__roadmap-dot home__roadmap-dot--live" />
              Live now — <Link to="/originals">Originals</Link>: Keno, Mines, Limbo, Roulette,
              Blackjack, Crash, Case Battles
            </li>
            <li>
              <span className="home__roadmap-dot home__roadmap-dot--live" />
              Live now — <Link to="/promotions">Promotions hub</Link> (rewards launching soon)
            </li>
            <li>
              <span className="home__roadmap-dot" />
              Coming — expanded casino lobby and third-party providers
            </li>
            <li>
              <span className="home__roadmap-dot" />
              Later — VIP tiers and Discord community rewards
            </li>
          </ul>
        </div>
      </ScrollReveal>

      <ScrollReveal className="home__footer-cta" delay={3}>
        <p className="home__footer-cta-text">
          Questions before you play? Read the FAQ or Terms anytime.
        </p>
        <MotionLink to="/help" variant="secondary">
          Open Help page
        </MotionLink>
      </ScrollReveal>
    </div>
  );
}
