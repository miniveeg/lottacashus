import { Link } from "react-router-dom";
import { BrandLogo } from "../BrandLogo/BrandLogo";
import "../BrandLogo/BrandLogo.css";
import "./Footer.css";

/* v3 "Command Center" redesign — minimal footer.
   The dock handles navigation now, so the footer doesn't need nav link
   columns. Just brand + tagline + legal links + copyright + responsible
   gaming notice. */

const LEGAL_LINKS = [
  { label: "Terms of Service", href: "/help" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Sweepstakes Rules", href: "/sweepstakes" },
  { label: "Free Entry", href: "/free-entry" },
  { label: "Help & FAQ", href: "/help" },
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
            Premium crypto entertainment platform — play with Gold Coins or Sweeps Coins.
          </p>
        </div>

        <nav className="site-footer__legal" aria-label="Legal">
          {LEGAL_LINKS.map((link) => (
            <Link key={`${link.label}-${link.href}`} to={link.href} className="site-footer__link">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="site-footer__bottom">
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
