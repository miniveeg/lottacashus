import { useMemo, useState } from "react";
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
  ShieldCheck,
  ArrowRight,
  Filter,
} from "lucide-react";
import { ORIGINAL_GAMES, type OriginalGame } from "../../content/originals";
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

type FilterTag = "all" | "Live" | "New" | "Beta";

const FILTERS: { id: FilterTag; label: string }[] = [
  { id: "all", label: "All games" },
  { id: "Live", label: "Live" },
  { id: "New", label: "New" },
  { id: "Beta", label: "Beta" },
];

function matchesFilter(game: OriginalGame, tag: FilterTag): boolean {
  if (tag === "all") return true;
  return game.tag === tag;
}

export function Originals() {
  const [filter, setFilter] = useState<FilterTag>("all");

  const games = useMemo(
    () => ORIGINAL_GAMES.filter((g) => matchesFilter(g, filter)),
    [filter],
  );

  return (
    <div className="originals-page lc-page lc-page--wide">
      {/* ── Header ── */}
      <motion.header
        className="originals-page__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="originals-page__eyebrow" variants={fadeUpVariants}>
          <Dices size={12} strokeWidth={2.4} />
          House Originals
        </motion.span>
        <motion.h1 className="originals-page__title" variants={fadeUpVariants}>
          Originals
        </motion.h1>
        <motion.p className="originals-page__subtitle" variants={fadeUpVariants}>
          Provably fair games built in-house. Industry-leading RTPs, verifiable seeds, one
          wallet across every title.
        </motion.p>
      </motion.header>

      {/* ── Filter bar ── */}
      <ScrollReveal className="originals-filters" as="div">
        <span className="originals-filters__label">
          <Filter size={12} strokeWidth={2.4} />
          Filter
        </span>
        <div className="originals-filters__tabs" role="tablist" aria-label="Game filters">
          {FILTERS.map((f) => {
            const count =
              f.id === "all"
                ? ORIGINAL_GAMES.length
                : ORIGINAL_GAMES.filter((g) => g.tag === f.id).length;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`originals-filter${active ? " originals-filter--active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="originals-filter__count">{count}</span>
              </button>
            );
          })}
        </div>
      </ScrollReveal>

      {/* ── Game grid ── */}
      {games.length === 0 ? (
        <div className="originals-empty">
          <p>No games in this category yet.</p>
        </div>
      ) : (
        <div className="originals-grid">
          {games.map((game, i) => {
            const Icon = GAME_ICONS[game.id] ?? Dices;
            return (
              <ScrollReveal key={game.id} delay={i} as="article" className="originals-card">
                <div className="originals-card__art" aria-hidden="true">
                  <div className="originals-card__art-glow" />
                  <Icon size={40} strokeWidth={1.6} />
                </div>

                <div className="originals-card__body">
                  <div className="originals-card__top">
                    <h2 className="originals-card__name">{game.name}</h2>
                    <span
                      className={`originals-card__badge${
                        game.live && game.tag ? "" : " originals-card__badge--soon"
                      }`}
                    >
                      {game.live ? (game.tag ?? "Live") : "Soon"}
                    </span>
                  </div>

                  <p className="originals-card__desc">{game.description}</p>

                  <div className="originals-card__meta">
                    {game.rtp ? (
                      <span className="originals-card__rtp">
                        <span className="originals-card__rtp-dot" aria-hidden="true" />
                        {game.rtp}
                      </span>
                    ) : null}
                    <span className="originals-card__fair">
                      <ShieldCheck size={11} strokeWidth={2.4} />
                      Provably Fair
                    </span>
                  </div>

                  <div className="originals-card__cta">
                    {game.live ? (
                      <MotionLink
                        to={game.href}
                        variant="primary"
                        className="originals-card__play originals-btn--gold"
                      >
                        Play now
                        <ArrowRight size={14} strokeWidth={2.2} />
                      </MotionLink>
                    ) : (
                      <span className="originals-card__play originals-card__play--disabled">
                        Coming soon
                      </span>
                    )}
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
