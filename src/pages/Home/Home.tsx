import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Wallet,
  Zap,
  TrendingUp,
  Dices,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Coins,
} from "lucide-react";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { useAuth } from "../../contexts/AuthContext";
import { ORIGINAL_GAMES, ORIGINALS_PATH } from "../../content/originals";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Home.css";

// Lazy-load the 3D scene so Three.js is split into its own chunk and only
// fetched on the home page. This must match the lazy import used by
// AtmosphericLayer to avoid duplicate copies of the module.
const ObsidianScene = lazy(() =>
  import("../../components/atmosphere/ObsidianScene").then((m) => ({ default: m.ObsidianScene }))
);

type Pillar = {
  title: string;
  desc: string;
  icon: typeof Wallet;
};

const pillars: Pillar[] = [
  {
    title: "One wallet",
    desc: "A single USD balance powers every game on LottaCash. No juggling purses, no waiting on transfers between titles — what you deposit is what you play with.",
    icon: Wallet,
  },
  {
    title: "Crypto in & out",
    desc: "Deposit and withdraw with SOL, LTC, and ETH. Your own addresses, on-chain transparency, and credits the moment confirmations land.",
    icon: Zap,
  },
  {
    title: "Level up",
    desc: "Wager-based ranks from 0 to 100. Every bet nudges your progress, and your level is permanent and visible on your profile.",
    icon: TrendingUp,
  },
  {
    title: "Provably fair",
    desc: "Server seeds, client seeds, and EOS block hashes power every outcome. Verify any round yourself — fairness is built into the rails.",
    icon: ShieldCheck,
  },
];

export function Home() {
  const { user, loading } = useAuth();
  const showcase = ORIGINAL_GAMES.filter((g) => g.live).slice(0, 8);

  return (
    <div className="home">
      {/* ── Hero ── */}
      <section className="home__hero">
        <div className="home__hero-3d" aria-hidden="true">
          <Suspense fallback={null}>
            <ObsidianScene className="home__hero-canvas" />
          </Suspense>
        </div>
        <div className="home__hero-fog" aria-hidden="true" />

        <div className="home__hero-inner">
          <motion.div
            className="home__hero-copy"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            <motion.span className="home__eyebrow" variants={fadeUpVariants}>
              <Sparkles size={12} strokeWidth={2.4} />
              Welcome to LottaCash
            </motion.span>

            <motion.h1 className="home__headline" variants={fadeUpVariants}>
              Your seat at the table starts here
            </motion.h1>

            <motion.p className="home__lead" variants={fadeUpVariants}>
              A cinematic crypto casino built on one account, real on-chain rails, and rewards that
              grow with every wager. Eight house originals are live — fund your wallet and play in
              seconds.
            </motion.p>

            <motion.div className="home__cta" variants={fadeUpVariants}>
              {!loading && user ? (
                <>
                  <MotionLink to="/deposit" variant="primary" glow>
                    Deposit &amp; Play
                  </MotionLink>
                  <MotionLink to={ORIGINALS_PATH} variant="secondary">
                    Browse originals
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
            </motion.div>

            <motion.ul className="home__hero-meta" variants={fadeUpVariants}>
              <li>
                <Coins size={14} strokeWidth={2.2} />
                <span>Gold &amp; Sweeps Coins</span>
              </li>
              <li>
                <ShieldCheck size={14} strokeWidth={2.2} />
                <span>Provably fair</span>
              </li>
              <li>
                <Zap size={14} strokeWidth={2.2} />
                <span>Crypto payouts</span>
              </li>
            </motion.ul>
          </motion.div>
        </div>
      </section>

      {/* ── Pillars ── */}
      <section className="home__section home__container" aria-labelledby="pillars-title">
        <ScrollReveal className="home__section-head" as="div">
          <span className="home__kicker">What is LottaCash?</span>
          <h2 id="pillars-title" className="home__section-title">
            Built for clarity, speed, and serious play.
          </h2>
          <p className="home__section-text">
            LottaCash is a dark, crimson-accented entertainment hub focused on the essentials:
            one account, real on-chain rails, and rewards that scale with every wager. Sign up
            with email verification, fund your wallet with crypto, and climb levels as you play.
          </p>
        </ScrollReveal>

        <div className="home__pillar-grid">
          {pillars.map((item, i) => (
            <ScrollReveal key={item.title} delay={i}>
              <article className="home__pillar">
                <div className="home__pillar-icon" aria-hidden="true">
                  <item.icon size={22} strokeWidth={1.75} />
                </div>
                <h3 className="home__pillar-title">{item.title}</h3>
                <p className="home__pillar-desc">{item.desc}</p>
              </article>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── Games showcase ── */}
      <section className="home__section home__container" aria-labelledby="games-title">
        <ScrollReveal className="home__section-head" as="div">
          <span className="home__kicker">House Originals</span>
          <h2 id="games-title" className="home__section-title">
            Eight provably fair games. One wallet.
          </h2>
          <p className="home__section-text">
            From quick-fire picks to multiplayer case battles — every original settles on the
            server with verifiable seeds. Pick one to start playing.
          </p>
        </ScrollReveal>

        <div className="home__games-grid">
          {showcase.map((game, i) => (
            <ScrollReveal key={game.id} delay={i * 0.5} as="article" className="home__game-card">
              <div className="home__game-card-top">
                <span className="home__game-tag">{game.tag ?? "Live"}</span>
              </div>
              <h3 className="home__game-title">{game.name}</h3>
              <p className="home__game-desc">{game.description}</p>
              <Link to={game.href} className="home__game-cta">
                Play
                <ArrowRight size={14} strokeWidth={2.2} />
              </Link>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal className="home__games-footer" as="div">
          <Link to={ORIGINALS_PATH} className="home__games-link">
            See all originals
            <ArrowRight size={16} strokeWidth={2.2} />
          </Link>
        </ScrollReveal>
      </section>

      {/* ── Roadmap ── */}
      <section className="home__section home__container" aria-labelledby="roadmap-title">
        <ScrollReveal className="home__roadmap" as="div">
          <div className="home__roadmap-glow" aria-hidden="true" />
          <div className="home__roadmap-copy">
            <span className="home__kicker">What&rsquo;s next</span>
            <h2 id="roadmap-title" className="home__section-title">
              Shipping fast, in the open.
            </h2>
            <ul className="home__roadmap-list">
              <li>
                <span className="home__roadmap-dot home__roadmap-dot--live" />
                <span>
                  <strong>Live now</strong> — accounts, crypto deposits &amp; withdrawals,
                  leveling, Discord link, Help center.
                </span>
              </li>
              <li>
                <span className="home__roadmap-dot home__roadmap-dot--live" />
                <span>
                  <strong>Live now</strong> — eight Originals: Keno, Mines, Limbo, Roulette,
                  Blackjack, Crash, Slots, Case Battles.
                </span>
              </li>
              <li>
                <span className="home__roadmap-dot home__roadmap-dot--live" />
                <span>
                  <strong>Live now</strong> — <Link to="/promotions">Promotions hub</Link> with
                  affiliate referrals and commission claiming.
                </span>
              </li>
              <li>
                <span className="home__roadmap-dot" />
                <span>Coming — expanded casino lobby and third-party providers.</span>
              </li>
              <li>
                <span className="home__roadmap-dot" />
                <span>Later — VIP tiers and Discord community rewards.</span>
              </li>
            </ul>
          </div>
        </ScrollReveal>
      </section>

      {/* ── Final CTA ── */}
      <section className="home__section home__container" aria-labelledby="final-title">
        <ScrollReveal className="home__final" as="div">
          <div className="home__final-glow" aria-hidden="true" />
          <Dices className="home__final-icon" size={28} strokeWidth={1.6} aria-hidden="true" />
          <h2 id="final-title" className="home__final-title">
            Ready to play?
          </h2>
          <p className="home__final-text">
            Create your account in under a minute, claim your welcome bonus, and take your seat
            at the table.
          </p>
          <div className="home__final-cta">
            {!loading && user ? (
              <MotionLink to={ORIGINALS_PATH} variant="primary" glow>
                Browse originals
                <ArrowRight size={16} strokeWidth={2.2} />
              </MotionLink>
            ) : (
              <>
                <MotionLink to="/signup" variant="primary" glow>
                  Create account
                </MotionLink>
                <MotionLink to="/help" variant="secondary">
                  Read the FAQ
                </MotionLink>
              </>
            )}
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
