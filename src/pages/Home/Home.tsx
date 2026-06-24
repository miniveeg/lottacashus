import { motion, useReducedMotion } from "framer-motion";
import { Wallet, Zap, TrendingUp, Dices } from "lucide-react";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { TiltCard } from "../../components/ui/TiltCard";
import { useAuth } from "../../contexts/AuthContext";
import { Seo } from "../../components/Seo/Seo";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Home.css";

// The home page relies on the global `AtmosphericLayer` (mounted in AppShell)
// for its 3D obsidian shards — we do NOT mount a second ObsidianScene here.
// The atmospheric canvas is `position: fixed` behind the app shell, so the
// hero card's `lc-glass` `backdrop-filter: blur(...)` samples the shards
// through the glass for a layered, cinematic effect without the GPU cost
// of a second WebGL context.

const pillars = [
  {
    title: "One wallet",
    desc: "A single USD balance for every game — no juggling purses or converting between games.",
    icon: Wallet,
  },
  {
    title: "Crypto in & out",
    desc: "Deposit and withdraw in SOL, LTC, or ETH, to and from your own addresses.",
    icon: Zap,
  },
  {
    title: "Level up",
    desc: "Wager-based ranks 0 to 100. Progress is permanent and visible on your profile.",
    icon: TrendingUp,
  },
  {
    title: "House originals",
    desc: "Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots, and Case Battles — all provably fair, all on the same balance.",
    icon: Dices,
  },
];

export function Home() {
  const { user, loading } = useAuth();
  // Respect `prefers-reduced-motion`: when set, render the hero copy in its
  // final state immediately (no fade-up / stagger). `initial={false}` tells
  // framer-motion to skip the enter animation and use `animate` as the
  // starting state; children inherit this via variant propagation.
  const reduceMotion = useReducedMotion();

  return (
    <div className="home lc-page">
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
            Eight provably fair house games, <span>paid out to your own wallet.</span>
          </motion.h1>
          <motion.p className="home__lead" variants={fadeUpVariants}>
            Bring SOL, LTC, or ETH, play any of the eight provably fair house games, and withdraw
            back to your own address on the same chain. Every wager pushes your level up — and that
            progress is permanent across all eight.
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
        <h2 className="home__section-title">From deposit to cash-out</h2>
        <p className="home__section-text">
          Sign up, grab a deposit address for SOL, LTC, or ETH, and send funds — they show up as a
          single USD balance you can spend on any game. Cash out the same way, back to your own
          wallet. Bets, level, deposits, and withdrawals all live in Settings, so there's no second
          dashboard to keep up with.
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
    </div>
  );
}
