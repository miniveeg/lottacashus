import { Link } from "react-router-dom";
import { BrandLogo } from "../BrandLogo/BrandLogo";
import "../BrandLogo/BrandLogo.css";
import "./Footer.css";

const GAME_LINKS = [
  { label: "Keno", href: "/keno" },
  { label: "Mines", href: "/mines" },
  { label: "Limbo", href: "/limbo" },
  { label: "Roulette", href: "/roulette" },
  { label: "Blackjack", href: "/blackjack" },
  { label: "Case Battles", href: "/case-battles" },
  { label: "Crash", href: "/crash" },
  { label: "Slots", href: "/slots" },
];

const PAGE_LINKS = [
  { label: "Home", href: "/" },
  { label: "Originals", href: "/originals" },
  { label: "Promotions", href: "/promotions" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Help & FAQ", href: "/help" },
];

const LEGAL_LINKS = [
  { label: "Terms", href: "/help" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Sweepstakes Rules", href: "/sweepstakes" },
  { label: "Free Entry", href: "/free-entry" },
  { label: "Responsible Gaming", href: "/responsible-gaming" },
  { label: "Redeem", href: "/redeem" },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link to="/" className="site-footer__logo-link">
            <BrandLogo className="site-footer__logo" size={32} alt="" />
            <span className="site-footer__name">LottaCash</span>
          </Link>
          <p className="site-footer__tagline">
            Eight games. One wallet. Your level, forever.
          </p>
        </div>

        <div className="site-footer__nav">
          <div className="site-footer__col">
            <p className="site-footer__heading">Games</p>
            <ul className="site-footer__list">
              {GAME_LINKS.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className="site-footer__link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="site-footer__col">
            <p className="site-footer__heading">Pages</p>
            <ul className="site-footer__list">
              {PAGE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className="site-footer__link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="site-footer__col">
            <p className="site-footer__heading">Legal</p>
            <ul className="site-footer__list">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className="site-footer__link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="site-footer__bottom">
        <p className="site-footer__entity">
          Operated by LottaCash Entertainment LLC. Sweepstakes rules apply. Void where prohibited.
        </p>
        <p className="site-footer__responsible">
          <span>Must be 18+ to play. Play responsibly.</span>
          <a
            href="https://www.ncpgambling.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="site-footer__ncpg-link"
          >
            National Council on Problem Gambling
          </a>
        </p>
        <p className="site-footer__copyright">
          &copy; {new Date().getFullYear()} LottaCash. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
