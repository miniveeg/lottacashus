import { Link, useLocation } from "react-router-dom";
import { ORIGINALS_PATH, ORIGINALS_ROUTES } from "../../content/originals";
import { useProfile } from "../../contexts/ProfileContext";
import { useSidebar } from "../../contexts/SidebarContext";
import { UiIcon, type UiIconName } from "../icons";

/* ════════════════════════════════════════════════════════════════
   DockNav — accessibility-complete site nav
   ───────────────────────────────────────────────────────────────
   In the v3 "Command Center" layout the visible navigation is split
   between the floating Dock (4–5 quick links, desktop) and the bottom
   MobileTabBar (4 quick links, mobile). Neither of those shows ALL
   destinations (Slots, Promotions, Settings, Withdraw, Redeem, Help,
   Sweepstakes Rules, Free Entry, Admin…).

   <DockNav /> is a visually-hidden (but screen-reader-available)
   full nav list that renders ALL destinations, grouped by section,
   so keyboard and assistive-tech users can still reach every page.
   It's rendered once at the AppShell level.
   ════════════════════════════════════════════════════════════════ */

type NavItem = { icon: UiIconName; label: string; href: string };

const mainNav: NavItem[] = [
  { icon: "home", label: "Home", href: "/" },
  { icon: "originals", label: "Originals", href: ORIGINALS_PATH },
  { icon: "slots", label: "Slots", href: "/slots" },
  { icon: "promotions", label: "Promotions", href: "/promotions" },
  { icon: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
];

const accountNav: NavItem[] = [
  { icon: "settings", label: "Settings", href: "/settings" },
  { icon: "profile", label: "Profile", href: "/profile" },
  { icon: "deposit", label: "Deposit", href: "/deposit" },
  { icon: "withdraw", label: "Withdraw", href: "/withdraw" },
  { icon: "redeem", label: "Redeem", href: "/redeem" },
  { icon: "help", label: "Help", href: "/help" },
];

const legalNav: NavItem[] = [
  { icon: "document", label: "Sweepstakes Rules", href: "/sweepstakes" },
  { icon: "gift", label: "Free Entry", href: "/free-entry" },
  { icon: "document", label: "Privacy Policy", href: "/privacy" },
];

function navIsActive(href: string, pathname: string): boolean {
  if (href === ORIGINALS_PATH) return ORIGINALS_ROUTES.has(pathname);
  return pathname === href;
}

export function DockNav() {
  const { pathname } = useLocation();
  const { profile } = useProfile();
  const { closePanel } = useSidebar();

  const accountItems: NavItem[] = profile?.isAdmin
    ? [...accountNav, { icon: "admin", label: "Admin", href: "/admin" }]
    : accountNav;

  const sections: { label: string; items: NavItem[] }[] = [
    { label: "Play", items: mainNav },
    { label: "Account", items: accountItems },
    { label: "Legal", items: legalNav },
  ];

  return (
    <nav className="dock-nav" aria-label="All destinations">
      {sections.map((section) => (
        <ul className="dock-nav__section" key={section.label}>
          {section.items.map((item) => {
            const active = navIsActive(item.href, pathname);
            return (
              <li key={`${section.label}-${item.label}`}>
                <Link
                  to={item.href}
                  className="dock-nav__link"
                  onClick={closePanel}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="dock-nav__icon" aria-hidden="true">
                    <UiIcon name={item.icon} size={16} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );
}
