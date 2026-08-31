import { useRef } from "react";
import { Link } from "react-router-dom";
import { GameThumb } from "../components/lobby/GameThumbs";
import { gsap, useGSAP } from "../lib/motion";

const GAMES = [
  { to: "/mines", id: "mines", title: "Mines", blurb: "Pick gems. Cash out before a mine." },
  { to: "/tower", id: "tower", title: "Tower", blurb: "Eight floors. One bomb each." },
  { to: "/limbo", id: "limbo", title: "Limbo", blurb: "Set a target. Beat the crash." },
  { to: "/roulette", id: "roulette", title: "Roulette", blurb: "European wheel, 0–36." },
  { to: "/blackjack", id: "blackjack", title: "Blackjack", blurb: "Six-deck shoe. 3:2 blackjack." },
  { to: "/upgrader", id: "upgrader", title: "Upgrader", blurb: "Spin the hit zone." },
  { to: "/cases", id: "cases", title: "Cases", blurb: "Six crates, weighted reel." },
  { to: "/battles", id: "battles", title: "Battles", blurb: "Same case. Winner takes the pot." },
] as const;

export function Lobby() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          ".game-card",
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: "power2.out", clearProps: "all" },
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
          <h1>Eight tables. One stack.</h1>
          <p>
            Mines through Battles on a single SC balance. Demo starts at 1,000. Provably fair. No dashboard chrome — just
            the pit.
          </p>
          <div className="hero-cta">
            <Link to="/mines" className="btn btn-gold">
              Play Mines
            </Link>
            <Link to="/wallet" className="btn">
              Wallet
            </Link>
          </div>
        </div>
        <img src="/art/hero.webp" alt="" className="hero-art" aria-hidden="true" />
      </section>
      <div className="game-grid">
        {GAMES.map((g) => (
          <Link key={g.to} to={g.to}>
            <article className="game-card">
              <GameThumb id={g.id} />
              <div className="game-card-body">
                <h3>{g.title}</h3>
                <p>{g.blurb}</p>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </div>
  );
}
