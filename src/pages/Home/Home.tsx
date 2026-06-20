import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Zap,
  Coins,
  Dices,
  Grid3X3,
  Bomb,
  TrendingUp,
  CircleDot,
  Spade,
  Swords,
  Sparkles,
  ArrowRight,
  Headset,
  Gem,
} from "lucide-react";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { useAuth } from "../../contexts/AuthContext";
import { ORIGINAL_GAMES, ORIGINALS_PATH } from "../../content/originals";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Home.css";

// Lazy-load the 3D obsidian scene so Three.js stays in its own chunk.
const ObsidianScene = lazy(() =>
  import("../../components/atmosphere/ObsidianScene").then((m) => ({ default: m.ObsidianScene })),
);

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

type Feature = {
  title: string;
  desc: string;
  icon: typeof ShieldCheck;
};

const features: Feature[] = [
  {
    title: "Provably Fair",
    desc: "Every bet settles on the server with verifiable seeds — server hash, client seed, and nonce. Verify any round yourself.",
    icon: ShieldCheck,
  },
  {
    title: "Dual Currency",
    desc: "Gold Coins (GC) for fun play, Sweeps Coins (SC) redeemable for real cash at 1 SC = $0.10. Toggle instantly from your balance.",
    icon: Coins,
  },
  {
    title: "Instant Crypto",
    desc: "Deposit and withdraw with SOL, LTC, and ETH. Your own addresses, on-chain transparency, credits the moment confirmations land.",
    icon: Zap,
  },
  {
    title: "No Hidden Fees",
    desc: "Transparent RTPs on every game, published rates, no surprise deductions. What you see is exactly what you get.",
    icon: Gem,
  },
];

const trustBadges = [
  { label: "Provably Fair", icon: ShieldCheck },
  { label: "Instant Withdrawals", icon: Zap },
  { label: "24/7 Support", icon: Headset },
];

export function Home() {
  const { user, loading } = useAuth();
  const showcase = ORIGINAL_GAMES.filter((g) => g.live).slice(0, 8);

  return (
    <div className="home-page">
      {/* ─────────────────────────────────────────────────────
          HERO — full viewport, centered, gold radial glow
         ───────────────────────────────────────────────────── */}
      <section className="home-hero">
        <div className="home-hero__scene" aria-hidden="true">
          <Suspense fallback={null}>
            <ObsidianScene className="home-hero__canvas" />
          </Suspense>
        </div>
        <div className="home-hero__glow" aria-hidden="true" />
        <div className="home-hero__vignette" aria-hidden="true" />

        <motion.div
          className="home-hero__inner"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <motion.span className="home-hero__eyebrow" variants={fadeUpVariants}>
            <Sparkles size={12} strokeWidth={2.4} />
            Welcome to LottaCash
          </motion.span>

          <motion.h1 className="home-hero__headline" variants={fadeUpVariants}>
            Play. Win. Cash Out.
          </motion.h1>

          <motion.p className="home-hero__sub" variants={fadeUpVariants}>
            Premium crypto casino with provably fair games, instant deposits, and real cash
            redemptions.
          </motion.p>

          <motion.div className="home-hero__ctas" variants={fadeUpVariants}>
            {!loading && user ? (
              <>
                <MotionLink to="/deposit" variant="primary" glow className="home-btn--gold">
                  Deposit &amp; Play
                </MotionLink>
                <MotionLink to={ORIGINALS_PATH} variant="secondary" className="home-btn--outline">
                  Browse games
                </MotionLink>
              </>
            ) : (
              <>
                <MotionLink to="/signup" variant="primary" glow className="home-btn--gold">
                  Create account
                </MotionLink>
                <MotionLink to="/login" variant="secondary" className="home-btn--outline">
                  Log in
                </MotionLink>
              </>
            )}
          </motion.div>

          <motion.ul className="home-hero__trust" variants={fadeUpVariants}>
            {trustBadges.map((b) => (
              <li key={b.label}>
                <b.icon size={14} strokeWidth={2.2} aria-hidden="true" />
                <span>{b.label}</span>
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </section>

      {/* ─────────────────────────────────────────────────────
          GAMES SHOWCASE — "House Originals"
         ───────────────────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="games-title">
        <ScrollReveal className="home-section__head" as="div">
          <h2 id="games-title" className="home-section__title">
            House Originals
          </h2>
          <p className="home-section__subtitle">
            Provably fair games with industry-leading RTPs
          </p>
        </ScrollReveal>

        <div className="home-games">
          {showcase.map((game, i) => {
            const Icon = GAME_ICONS[game.id] ?? Dices;
            return (
              <ScrollReveal key={game.id} delay={i} as="article" className="home-game">
                <div className="home-game__icon" aria-hidden="true">
                  <Icon size={28} strokeWidth={1.75} />
                </div>
                <h3 className="home-game__name">{game.name}</h3>
                <p className="home-game__desc">{game.description}</p>
                <div className="home-game__meta">
                  {game.rtp ? <span className="home-game__rtp">{game.rtp}</span> : null}
                  <span className="home-game__fair">Provably Fair</span>
                </div>
                <Link to={game.href} className="home-game__play">
                  Play
                  <ArrowRight size={14} strokeWidth={2.2} />
                </Link>
              </ScrollReveal>
            );
          })}
        </div>

        <ScrollReveal className="home-section__more" as="div">
          <Link to={ORIGINALS_PATH} className="home-section__more-link">
            See all games
            <ArrowRight size={16} strokeWidth={2.2} />
          </Link>
        </ScrollReveal>
      </section>

      {/* ─────────────────────────────────────────────────────
          WHY CHOOSE US — "The LottaCash difference"
         ───────────────────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="difference-title">
        <ScrollReveal className="home-section__head" as="div">
          <h2 id="difference-title" className="home-section__title">
            The LottaCash difference
          </h2>
          <p className="home-section__subtitle">
            Four pillars that make us the premium choice in crypto gaming
          </p>
        </ScrollReveal>

        <div className="home-features">
          {features.map((f, i) => (
            <ScrollReveal key={f.title} delay={i} as="article" className="home-feature">
              <div className="home-feature__icon" aria-hidden="true">
                <f.icon size={22} strokeWidth={1.75} />
              </div>
              <h3 className="home-feature__title">{f.title}</h3>
              <p className="home-feature__desc">{f.desc}</p>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────
          FINAL CTA
         ───────────────────────────────────────────────────── */}
      <section className="home-final" aria-labelledby="final-title">
        <ScrollReveal className="home-final__inner" as="div">
          <div className="home-final__glow" aria-hidden="true" />
          <h2 id="final-title" className="home-final__title">
            Ready to play?
          </h2>
          <p className="home-final__text">
            Create your free account in 30 seconds
          </p>
          <div className="home-final__cta">
            {!loading && user ? (
              <MotionLink to={ORIGINALS_PATH} variant="primary" glow className="home-btn--gold">
                Browse games
                <ArrowRight size={16} strokeWidth={2.2} />
              </MotionLink>
            ) : (
              <MotionLink to="/signup" variant="primary" glow className="home-btn--gold">
                Create account
              </MotionLink>
            )}
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
