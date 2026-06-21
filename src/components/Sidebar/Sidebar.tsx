import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageSquare, X } from "lucide-react";
import { ORIGINALS_PATH, ORIGINALS_ROUTES } from "../../content/originals";
import { useSidebar } from "../../contexts/SidebarContext";
import { UiIcon, type UiIconName } from "../icons";
import "./Sidebar.css";

/* ════════════════════════════════════════════════════════════════
   v3 "Command Center" redesign
   ───────────────────────────────────────────────────────────────
   The sidebar is GONE. This file now exports the two NAV components
   that REPLACE it:

     • <Dock />          — floating vertical pill, left-center on
                            desktop only. Expands on hover to reveal
                            labels (tooltip-style).
     • <MobileTabBar />  — fixed bottom tab bar (Instagram / cash-app
                            style), mobile only (≤768px).

   The actual nav item list lives in <DockNav /> (./SidebarNav) so it
   can be reused and unit-tested in isolation.
   ════════════════════════════════════════════════════════════════ */

type DockItem = {
  icon: UiIconName;
  label: string;
  href: string;
};

const DOCK_ITEMS: DockItem[] = [
  { icon: "home", label: "Home", href: "/" },
  { icon: "originals", label: "Originals", href: ORIGINALS_PATH },
  { icon: "deposit", label: "Wallet", href: "/deposit" },
  { icon: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
];

type MobileTabItem = {
  icon: UiIconName;
  label: string;
  href: string;
};

const MOBILE_TAB_ITEMS: MobileTabItem[] = [
  { icon: "home", label: "Home", href: "/" },
  { icon: "originals", label: "Games", href: ORIGINALS_PATH },
  { icon: "deposit", label: "Wallet", href: "/deposit" },
  { icon: "profile", label: "Profile", href: "/settings" },
];

function navIsActive(href: string, pathname: string): boolean {
  if (href === ORIGINALS_PATH) return ORIGINALS_ROUTES.has(pathname);
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ── Dock (desktop floating pill) ────────────────────────────── */

export function Dock() {
  const { pathname } = useLocation();
  const { chatOpen, toggleChat } = useSidebar();

  return (
    <nav className="dock" aria-label="Quick navigation">
      <ul className="dock__list">
        {DOCK_ITEMS.map((item) => {
          const active = navIsActive(item.href, pathname);
          return (
            <li key={item.href} className="dock__item-wrap">
              <Link
                to={item.href}
                className={`dock__item${active ? " dock__item--active" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
              >
                <span className="dock__icon" aria-hidden="true">
                  <UiIcon name={item.icon} size={20} />
                </span>
                <span className="dock__label">{item.label}</span>
              </Link>
            </li>
          );
        })}

        {/* Chat toggle — opens the slide-in chat panel */}
        <li className="dock__item-wrap">
          <motion.button
            type="button"
            className={`dock__item dock__item--toggle${chatOpen ? " dock__item--active" : ""}`}
            onClick={toggleChat}
            aria-label={chatOpen ? "Close live chat" : "Open live chat"}
            aria-expanded={chatOpen}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            <span className="dock__icon" aria-hidden="true">
              {chatOpen ? <X size={20} /> : <MessageSquare size={20} />}
            </span>
            <span className="dock__label">{chatOpen ? "Close" : "Chat"}</span>
          </motion.button>
        </li>
      </ul>

      {/* Tiny brand caps at the top and bottom of the dock — visual anchor */}
      <span className="dock__cap dock__cap--top" aria-hidden="true" />
      <span className="dock__cap dock__cap--bottom" aria-hidden="true" />
    </nav>
  );
}

/* ── Mobile bottom tab bar ───────────────────────────────────── */

export function MobileTabBar() {
  const { pathname } = useLocation();
  const { toggleChat, chatOpen } = useSidebar();

  return (
    <nav className="mobile-tabs" aria-label="Primary navigation">
      {MOBILE_TAB_ITEMS.map((item) => {
        const active = navIsActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            to={item.href}
            className={`mobile-tabs__item${active ? " mobile-tabs__item--active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="mobile-tabs__icon" aria-hidden="true">
              <UiIcon name={item.icon} size={22} />
            </span>
            <span className="mobile-tabs__label">{item.label}</span>
          </Link>
        );
      })}

      {/* Chat tab — opens slide-in panel */}
      <button
        type="button"
        className={`mobile-tabs__item mobile-tabs__item--btn${chatOpen ? " mobile-tabs__item--active" : ""}`}
        onClick={toggleChat}
        aria-label={chatOpen ? "Close live chat" : "Open live chat"}
        aria-expanded={chatOpen}
      >
        <span className="mobile-tabs__icon" aria-hidden="true">
          {chatOpen ? <X size={22} /> : <MessageSquare size={22} />}
        </span>
        <span className="mobile-tabs__label">{chatOpen ? "Close" : "Chat"}</span>
      </button>
    </nav>
  );
}
