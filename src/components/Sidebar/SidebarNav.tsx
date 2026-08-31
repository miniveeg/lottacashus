import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ORIGINALS_PATH, ORIGINALS_ROUTES } from "../../content/originals";
import { useSidebar } from "../../contexts/SidebarContext";
import { useProfile } from "../../contexts/ProfileContext";
import { UiIcon, type UiIconName } from "../icons";

type NavItem = { icon: UiIconName; label: string; href: string };

const mainNav: NavItem[] = [
  { icon: "home", label: "Home", href: "/" },
  { icon: "originals", label: "Originals", href: ORIGINALS_PATH },
  { icon: "promotions", label: "Promotions", href: "/promotions" },
  { icon: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
];

const accountNav: NavItem[] = [
  { icon: "settings", label: "Settings", href: "/settings" },
  { icon: "deposit", label: "Deposit", href: "/deposit" },
  { icon: "withdraw", label: "Withdraw", href: "/withdraw" },
  { icon: "help", label: "Help", href: "/help" },
];

const legalNav: NavItem[] = [
  { icon: "document", label: "Sweepstakes Rules", href: "/sweepstakes" },
];

/**
 * Hover-prefetch map. When the user hovers (or focuses via keyboard) a
 * sidebar link, kick off the dynamic import for that page's chunk so the
 * navigation feels instant on click. Statically-unreachable links fall
 * through silently.
 *
 * The IIFE is built lazily once because some prefetchers reference page
 * modules whose own providers import the SidebarProvider (loop). By
 * deferring the `import()` expression to the call site (not the map
 * declaration), we sidestep the circular-init problem.
 */
const prefetchRoute = (() => {
  const map: Record<string, () => Promise<unknown>> = {
    "/": () => import("../../pages/Home/Home"),
    [ORIGINALS_PATH]: () => import("../../pages/Originals/Originals"),
    "/promotions": () => import("../../pages/Promotions/Promotions"),
    "/leaderboard": () => import("../../pages/Leaderboard/Leaderboard"),
    "/settings": () => import("../../pages/Settings/Settings"),
    "/deposit": () => import("../../pages/Deposit/Deposit"),
    "/withdraw": () => import("../../pages/Withdraw/Withdraw"),
    "/help": () => import("../../pages/Help/Help"),
    "/sweepstakes": () => import("../../pages/SweepstakesRules/SweepstakesRules"),
    "/admin": () => import("../../pages/Admin/Admin"),
    "/profile": () => import("../../pages/Profile/Profile"),
  };
  return (href: string) => {
    const f = map[href];
    if (f) void f();
  };
})();

function navIsActive(href: string, pathname: string): boolean {
  if (href === ORIGINALS_PATH) return ORIGINALS_ROUTES.has(pathname);
  return pathname === href;
}

function NavLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const { closeMobile, collapsed } = useSidebar();
  const active = navIsActive(item.href, pathname);

  return (
    <li>
      <Link
        to={item.href}
        className={`sidebar__link${active ? " sidebar__link--active" : ""}`}
        onClick={closeMobile}
        onMouseEnter={() => prefetchRoute(item.href)}
        onFocus={() => prefetchRoute(item.href)}
        title={collapsed ? item.label : undefined}
        aria-current={active ? "page" : undefined}
      >
        <span className="sidebar__icon" aria-hidden="true">
          <UiIcon name={item.icon} size={18} />
        </span>
        <span className="sidebar__link-label">{item.label}</span>
        {active ? <span className="sidebar__link-glow" aria-hidden="true" /> : null}
      </Link>
    </li>
  );
}

export function SidebarNav() {
  const { profile } = useProfile();
  const { collapsed } = useSidebar();
  const [legalOpen, setLegalOpen] = useState(false);

  const legalItems: NavItem[] = profile?.isAdmin
    ? [...legalNav, { icon: "admin", label: "Admin", href: "/admin" }]
    : legalNav;

  return (
    <>
      <nav className="sidebar__section" aria-label="Main navigation">
        {!collapsed ? <p className="sidebar__label">Play</p> : null}
        <ul className="sidebar__nav">
          {mainNav.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </ul>
      </nav>

      <nav className="sidebar__section" aria-label="Account">
        {!collapsed ? <p className="sidebar__label">Account</p> : null}
        <ul className="sidebar__nav">
          {accountNav.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </ul>
      </nav>

      <nav className="sidebar__section sidebar__section--legal" aria-label="Legal">
        {!collapsed ? (
          <button
            type="button"
            className="sidebar__label sidebar__label--toggle"
            aria-expanded={legalOpen}
            onClick={() => setLegalOpen((open) => !open)}
          >
            Legal
          </button>
        ) : null}
        <ul className="sidebar__nav">
          {(collapsed || legalOpen) &&
            legalItems.map((item) => <NavLink key={item.label} item={item} />)}
        </ul>
      </nav>
    </>
  );
}
