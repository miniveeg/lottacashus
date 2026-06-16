import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useSidebar } from "../../contexts/SidebarContext";
import { useProfile } from "../../contexts/ProfileContext";
import { MorphLink } from "../../lib/navigation";
import { NavIcon, type NavIconName, UiIcon } from "../icons";
import { ORIGINALS_PATH } from "../../content/originals";

type RailItem = { icon: NavIconName; label: string; href: string };

const mainRail: RailItem[] = [
  { icon: "home", label: "Home", href: "/" },
  { icon: "originals", label: "Originals", href: ORIGINALS_PATH },
  { icon: "promotions", label: "Promotions", href: "/promotions" },
];

const accountRail: RailItem[] = [
  { icon: "settings", label: "Settings", href: "/settings" },
  { icon: "deposit", label: "Deposit", href: "/deposit" },
  { icon: "withdraw", label: "Withdraw", href: "/withdraw" },
  { icon: "help", label: "Help", href: "/help" },
];

function isActive(href: string, pathname: string): boolean {
  if (href === ORIGINALS_PATH) {
    return pathname === ORIGINALS_PATH || pathname.startsWith(`${ORIGINALS_PATH}/`);
  }
  return pathname === href;
}

export function SidebarRail() {
  const { pathname } = useLocation();
  const { isChatMode, toggleMode, toggleSidebarCollapsed } = useSidebar();
  const { profile } = useProfile();

  const accountItems: RailItem[] = profile?.isAdmin
    ? [...accountRail, { icon: "admin", label: "Admin", href: "/admin" }]
    : accountRail;

  const handleChatToggle = useCallback(() => {
    if (!isChatMode) toggleMode();
    // If already in chat mode, this is a no-op (stay in chat)
  }, [isChatMode, toggleMode]);

  return (
    <div className="sidebar-rail">
      {/* Expand button */}
      <button
        type="button"
        className="sidebar-rail__toggle"
        aria-label="Expand sidebar"
        onClick={toggleSidebarCollapsed}
      >
        <UiIcon name="chevronRight" size={16} />
      </button>

      {/* Main nav icons */}
      <nav className="sidebar-rail__group" aria-label="Main">
        {mainRail.map((item) => (
          <MorphLink
            key={item.label}
            to={item.href}
            className={`sidebar-rail__btn${isActive(item.href, pathname) ? " sidebar-rail__btn--active" : ""}`}
            title={item.label}
            aria-label={item.label}
          >
            <NavIcon name={item.icon} size={18} />
          </MorphLink>
        ))}
      </nav>

      {/* Chat + Account group */}
      <nav className="sidebar-rail__group sidebar-rail__group--bottom" aria-label="Account">
        <button
          type="button"
          className={`sidebar-rail__btn${isChatMode ? " sidebar-rail__btn--active" : ""}`}
          title="Live chat"
          aria-label="Live chat"
          onClick={handleChatToggle}
        >
          <UiIcon name="chatBubble" size={18} />
        </button>

        {accountItems.map((item) => (
          <MorphLink
            key={item.label}
            to={item.href}
            className={`sidebar-rail__btn${pathname === item.href ? " sidebar-rail__btn--active" : ""}`}
            title={item.label}
            aria-label={item.label}
          >
            <NavIcon name={item.icon} size={18} />
          </MorphLink>
        ))}
      </nav>
    </div>
  );
}
