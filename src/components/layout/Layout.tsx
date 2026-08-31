import { NavLink, Outlet } from "react-router-dom";
import {
  IconBomb,
  IconVault,
  IconChart,
  IconWheel,
  IconCards,
  IconGem,
  IconCrate,
  IconSwords,
  IconWallet,
  IconLogin,
} from "../icons/PitIcons";
import { formatSC } from "../../lib/format";
import { useWallet } from "../../context/WalletContext";
import { useAuth } from "../../context/AuthContext";

const GAMES = [
  { to: "/mines", label: "Mines", Icon: IconBomb },
  { to: "/tower", label: "Tower", Icon: IconVault },
  { to: "/limbo", label: "Limbo", Icon: IconChart },
  { to: "/roulette", label: "Roulette", Icon: IconWheel },
  { to: "/blackjack", label: "Blackjack", Icon: IconCards },
  { to: "/upgrader", label: "Upgrader", Icon: IconGem },
  { to: "/cases", label: "Cases", Icon: IconCrate },
  { to: "/battles", label: "Battles", Icon: IconSwords },
];

export function Layout() {
  const { balance } = useWallet();
  const { user, configured } = useAuth();

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to games
      </a>
      <header className="topbar">
        <NavLink to="/" className="wordmark">
          <img src="/art/chip.webp" alt="" className="wordmark-chip" />
          LottaCash
        </NavLink>
        <div className="topbar-right">
          <div className="balance-chip">{formatSC(balance)}</div>
          <NavLink to="/wallet" className="btn">
            <IconWallet width={16} height={16} /> Wallet
          </NavLink>
          {configured && user ? (
            <NavLink to="/login" className="btn btn-ghost">
              {user.email ?? "Account"}
            </NavLink>
          ) : configured ? (
            <NavLink to="/login" className="btn btn-gold">
              <IconLogin width={16} height={16} /> Login
            </NavLink>
          ) : (
            <span className="demo-badge">Demo</span>
          )}
        </div>
      </header>

      <nav className="sidenav">
        <h3>Games</h3>
        {GAMES.map((g) => (
          <NavLink key={g.to} to={g.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
            <g.Icon width={18} height={18} />
            {g.label}
          </NavLink>
        ))}
        <h3 style={{ marginTop: 18 }}>Account</h3>
        <NavLink to="/wallet" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          <IconWallet width={18} height={18} />
          Wallet
        </NavLink>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        <div className="mobile-nav">
          {GAMES.map((g) => (
            <NavLink key={g.to} to={g.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {g.label}
            </NavLink>
          ))}
        </div>
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} LottaCash · 18+</span>
        <span>
          <NavLink to="/responsible">Responsible</NavLink>
          {" · "}
          <NavLink to="/privacy">Privacy</NavLink>
          {" · "}
          <NavLink to="/terms">Terms</NavLink>
        </span>
      </footer>
    </div>
  );
}
