import { useRef } from "react";
import { Link } from "react-router-dom";
import { GameThumb } from "../components/lobby/GameThumbs";
import { gsap, useGSAP } from "../lib/motion";

const GAMES = [
  { to: "/mines", id: "mines", title: "Mines", blurb: "Gems or grief. Cash out climbing.", tag: "Grid" },
  { to: "/tower", id: "tower", title: "Tower", blurb: "Eight floors. One bomb each.", tag: "Climb" },
  { to: "/limbo", id: "limbo", title: "Limbo", blurb: "How far does the crash go?", tag: "Crash" },
  { to: "/roulette", id: "roulette", title: "Roulette", blurb: "European wheel. Gold pointer.", tag: "Wheel" },
  { to: "/blackjack", id: "blackjack", title: "Blackjack", blurb: "Six-deck shoe. 3:2 blackjack.", tag: "Cards" },
  { to: "/upgrader", id: "upgrader", title: "Upgrader", blurb: "Spin the hit zone. CS energy.", tag: "Risk" },
  { to: "/cases", id: "cases", title: "Cases", blurb: "Six crates. Watch the reel kiss.", tag: "Unbox" },
  { to: "/battles", id: "battles", title: "Battles", blurb: "Same case, winner takes the pot.", tag: "PvP" },
] as const;

const TICKER = [
  ["Nova", "Mines", "420.00"],
  ["Kite", "Limbo", "88.50"],
  ["Vex", "Gold Vault", "250.00"],
  ["Nyx", "Roulette", "200.00"],
  ["Rune", "Blackjack", "62.50"],
  ["Hex", "Upgrader", "400.00"],
  ["Ivy", "Tower", "155.00"],
  ["Sol", "Jackpot", "7,500.00"],
] as const;

const TICKER_LOOP = [...TICKER, ...TICKER];

export function Lobby() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          ".game-card",
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ease: "power2.out", clearProps: "all" },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <section className="hero">
        <div className="hero-copy">
          <h1>Neon on obsidian. Cash that hits.</h1>
          <p>
            LottaCash is a dense, glossy crypto casino — one SC balance, eight live tables, provably fair rolls. Demo starts
            you at 1,000 SC. No purple dashboard. Just the floor.
          </p>
          <div className="hero-cta">
            <Link to="/mines" className="btn btn-gold">
              Open Mines
            </Link>
            <Link to="/wallet" className="btn">
              Open wallet
            </Link>
          </div>
        </div>
        <div className="hero-floor" aria-hidden="true">
          <span className="hero-neon">LIVE</span>
          <span className="hero-chip hc1" />
          <span className="hero-chip hc2" />
          <span className="hero-chip hc3" />
          <span className="hero-card ha" />
          <span className="hero-card hb" />
        </div>
      </section>
      <div className="ticker">
        <div className="ticker-track">
          {TICKER_LOOP.map((t, i) => (
            <span key={i}>
              {t[0]} hit <b>{t[2]} SC</b> on {t[1]}
            </span>
          ))}
        </div>
      </div>
      <div className="game-grid">
        {GAMES.map((g) => (
          <Link key={g.to} to={g.to}>
            <article className="game-card">
              <div className="game-card-head">
                <span className="tag">{g.tag}</span>
              </div>
              <GameThumb id={g.id} />
              <h3>{g.title}</h3>
              <p>{g.blurb}</p>
            </article>
          </Link>
        ))}
      </div>
    </div>
  );
}
