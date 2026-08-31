import { NavLink, Outlet } from "react-router-dom";
import {
  Bomb,
  Building2,
  CircleDot,
  Dices,
  Gem,
  Layers,
  Swords,
  TrendingUp,
  Wallet,
  LogIn,
} from "lucide-react";
import { formatSC } from "../../lib/format";
import { useWallet } from "../../context/WalletContext";
import { useAuth } from "../../context/AuthContext";

const GAMES = [
  { to: "/mines", label: "Mines", icon: Bomb },
  { to: "/tower", label: "Tower", icon: Building2 },
  { to: "/limbo", label: "Limbo", icon: TrendingUp },
  { to: "/roulette", label: "Roulette", icon: CircleDot },
  { to: "/blackjack", label: "Blackjack", icon: Layers },
  { to: "/upgrader", label: "Upgrader", icon: Gem },
  { to: "/cases", label: "Cases", icon: Dices },
  { to: "/battles", label: "Battles", icon: Swords },
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
          <span className="wordmark-badge">LC</span>
          LottaCash
        </NavLink>
        <div className="topbar-right">
          <div className="balance-chip">{formatSC(balance)}</div>
          <NavLink to="/wallet" className="btn">
            <Wallet size={16} aria-hidden="true" /> Wallet
          </NavLink>
          {configured && user ? (
            <NavLink to="/login" className="btn btn-ghost">
              {user.email ?? "Account"}
            </NavLink>
          ) : configured ? (
            <NavLink to="/login" className="btn btn-gold">
              <LogIn size={16} aria-hidden="true" /> Login
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
            <g.icon aria-hidden="true" />
            {g.label}
          </NavLink>
        ))}
        <h3 style={{ marginTop: 18 }}>House</h3>
        <NavLink to="/wallet" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          <Wallet aria-hidden="true" />
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
