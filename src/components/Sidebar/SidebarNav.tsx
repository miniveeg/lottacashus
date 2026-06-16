import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
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
      <motion.div whileHover={{ x: 4 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}>
        <Link
          to={item.href}
          className={`sidebar__link${active ? " sidebar__link--active" : ""}`}
          onClick={closeMobile}
          title={collapsed ? item.label : undefined}
        >
          <span className="sidebar__icon" aria-hidden="true">
            <UiIcon name={item.icon} size={18} />
          </span>
          <span className="sidebar__link-label">{item.label}</span>
          {active ? <span className="sidebar__link-glow" aria-hidden="true" /> : null}
        </Link>
      </motion.div>
    </li>
  );
}

export function SidebarNav() {
  const { profile } = useProfile();
  const { collapsed } = useSidebar();

  const accountItems: NavItem[] = profile?.isAdmin
    ? [...accountNav, { icon: "admin", label: "Admin", href: "/admin" }]
    : accountNav;

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
          {accountItems.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </ul>
      </nav>
    </>
  );
}
