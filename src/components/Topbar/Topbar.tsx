import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bell,
  ChevronDown,
  CreditCard,
  LogIn,
  LogOut,
  Search,
  Settings as SettingsIcon,
  User as UserIcon,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import { NotificationsPanel } from "../NotificationsPanel/NotificationsPanel";
import { useAuth } from "../../contexts/AuthContext";
import { useNotifications } from "../../contexts/NotificationsContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { useToast } from "../../contexts/ToastContext";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import { formatUsd, formatCoins, coinsToUsd, type CoinType } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import { searchSite, type SiteSearchItem } from "../../lib/siteSearch";
import { BrandLogo } from "../BrandLogo/BrandLogo";
import { TopbarLevelProgress } from "./TopbarLevelProgress";
import "../BrandLogo/BrandLogo.css";
import "./Topbar.css";
import "./TopbarLevelProgress.css";

function searchCategoryLabel(category: SiteSearchItem["category"]): string {
  return category === "game" ? "Game" : "Page";
}

type UserMenuItem = {
  label: string;
  href: string;
  icon: typeof UserIcon;
};

const USER_MENU_ITEMS: UserMenuItem[] = [
  { label: "Profile", href: "/profile", icon: UserIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
  { label: "Deposit", href: "/deposit", icon: CreditCard },
  { label: "Withdraw", href: "/withdraw", icon: Wallet },
  { label: "Redeem", href: "/redeem", icon: Wallet },
];

export function Topbar() {
  const { user, loading, signOut } = useAuth();
  const { profile, profileLoading } = useProfile();
  const { coinType, setCoinType } = usePlayMode();
  const { pathname } = useLocation();
  const { unreadCount } = useNotifications();
  const toast = useToast();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = searchSite(searchQuery);
  const isSweeps = coinType === "sweeps_coins";

  const displayName =
    profile?.username ??
    user?.user_metadata?.username ??
    user?.email?.split("@")[0] ??
    "Player";

  const activeBalance = !user
    ? 0
    : isSweeps
      ? (profile?.sweepsCoins ?? 0)
      : (profile?.balance ?? 0);

  // "10,000.00 GC" — formatCoins includes the symbol.
  const balanceDisplay = !user
    ? formatCoins(0, coinType as CoinType)
    : profileLoading
      ? "…"
      : formatCoins(activeBalance, coinType as CoinType);

  const balanceUsd = coinsToUsd(activeBalance, coinType as CoinType);

  function avatarLetter(name: string) {
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  async function handleSignOut() {
    setUserMenuOpen(false);
    await signOut();
    analytics.logout();
    analytics.reset();
    toast.info("You've been signed out.");
    navigate("/");
  }

  function goToSearchResult(item: SiteSearchItem) {
    setSearchQuery("");
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setHighlightIndex(0);
    navigate(item.href);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const first = searchResults[0];
    if (first) goToSearchResult(first);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!searchOpen && searchResults.length > 0 && (e.key === "ArrowDown" || e.key === "Enter")) {
      setSearchOpen(true);
    }
    if (!searchResults.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter" && searchResults[highlightIndex]) {
      e.preventDefault();
      goToSearchResult(searchResults[highlightIndex]!);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  useEffect(() => {
    setHighlightIndex(0);
  }, [searchQuery]);

  // Close the mobile search overlay + user menu whenever the route changes.
  useEffect(() => {
    setMobileSearchOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(ev: MouseEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(ev.target as Node)) {
        setSearchOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(ev.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Auto-focus the search input when the mobile search overlay opens.
  useEffect(() => {
    if (mobileSearchOpen) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [mobileSearchOpen]);

  const userMenuItems: UserMenuItem[] = profile?.isAdmin
    ? [...USER_MENU_ITEMS, { label: "Admin", href: "/admin", icon: SettingsIcon }]
    : USER_MENU_ITEMS;

  return (
    <header className={`topbar${mobileSearchOpen ? " topbar--search-open" : ""}`}>
      <div className="topbar__start">
        <Link to="/" className="topbar__brand">
          <BrandLogo className="topbar__logo" size={28} alt="" />
          <span className="topbar__name">LottaCash</span>
        </Link>
      </div>

      <div className="topbar__search-wrap" ref={searchWrapRef}>
        <form className="topbar__search" role="search" onSubmit={handleSearchSubmit}>
          <Search size={16} aria-hidden className="topbar__search-icon" />
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search games and pages…"
            aria-label="Search games and pages"
            aria-expanded={searchOpen && searchResults.length > 0}
            aria-controls="topbar-search-results"
            aria-autocomplete="list"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
          />
        </form>
        {searchOpen && searchQuery.trim() && searchResults.length > 0 && (
          <ul
            id="topbar-search-results"
            className="topbar__search-results"
            role="listbox"
          >
            {searchResults.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === highlightIndex}>
                <button
                  type="button"
                  className={`topbar__search-result${index === highlightIndex ? " topbar__search-result--active" : ""}`}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => goToSearchResult(item)}
                >
                  <span className="topbar__search-result-label">{item.label}</span>
                  <span className="topbar__search-result-meta">
                    {searchCategoryLabel(item.category)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
          <p className="topbar__search-empty" role="status">
            No matches for &ldquo;{searchQuery.trim()}&rdquo;
          </p>
        )}
      </div>

      <div className="topbar__actions">
        <motion.button
          type="button"
          className={`topbar__icon-btn topbar__search-toggle${mobileSearchOpen ? " topbar__icon-btn--active" : ""}`}
          aria-label={mobileSearchOpen ? "Close search" : "Search"}
          aria-expanded={mobileSearchOpen}
          onClick={() => setMobileSearchOpen((open) => !open)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {mobileSearchOpen ? <X size={18} aria-hidden /> : <Search size={18} aria-hidden />}
        </motion.button>

        {/* Balance + coin toggle (only when logged in) */}
        {user && (
          <div className="topbar__balance-group" data-coin={isSweeps ? "sc" : "gc"}>
            <Link
              to="/settings"
              className={`topbar__balance${isSweeps ? " topbar__balance--sc" : " topbar__balance--gc"}`}
              title={profileLoading ? "Loading…" : `${formatCoins(activeBalance, coinType as CoinType)} = ${formatUsd(balanceUsd)}`}
              aria-busy={profileLoading || undefined}
              aria-label={profileLoading ? "Loading balance" : `${formatCoins(activeBalance, coinType as CoinType)}${user ? `, equivalent to ${formatUsd(balanceUsd)}` : ""}`}
            >
              <span className="topbar__balance-value">
                {profileLoading ? (
                  <span className="visually-hidden">Loading balance</span>
                ) : null}
                {balanceDisplay}
              </span>
              {user && !profileLoading && (
                <span className="topbar__balance-usd">{formatUsd(balanceUsd)}</span>
              )}
            </Link>
            <motion.button
              type="button"
              className={`topbar__coin-toggle${isSweeps ? " topbar__coin-toggle--sc" : " topbar__coin-toggle--gc"}`}
              aria-label={`Switch to ${isSweeps ? "Gold Coins" : "Sweeps Coins"} (currently ${isSweeps ? "Sweeps Coins" : "Gold Coins"})`}
              aria-pressed={isSweeps}
              onClick={() => setCoinType(isSweeps ? "balance" : "sweeps_coins")}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={isSweeps ? "Showing Sweeps Coins — click to show Gold Coins" : "Showing Gold Coins — click to show Sweeps Coins"}
            >
              <span className="topbar__coin-toggle-label" aria-hidden="true">
                {isSweeps ? "SC" : "GC"}
              </span>
            </motion.button>
          </div>
        )}

        {loading ? (
          <span className="topbar__loading">…</span>
        ) : user ? (
          <>
            <TopbarLevelProgress
              displayName={displayName}
              profileTitle={user.email ?? undefined}
              totalWagered={profile?.totalWagered ?? 0}
              loading={profileLoading}
            />

            {/* User avatar dropdown — replaces the sidebar account section */}
            <div className="topbar__user-menu" ref={userMenuRef}>
              <motion.button
                type="button"
                className={`topbar__avatar${userMenuOpen ? " topbar__avatar--open" : ""}`}
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={`Account menu for ${displayName}`}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                <span className="topbar__avatar-letter" aria-hidden="true">
                  {avatarLetter(displayName)}
                </span>
                <ChevronDown
                  size={14}
                  className="topbar__avatar-caret"
                  aria-hidden="true"
                />
              </motion.button>

              {userMenuOpen && (
                <div className="topbar__user-dropdown" role="menu">
                  <div className="topbar__user-dropdown-header">
                    <span className="topbar__user-dropdown-name">{displayName}</span>
                    {user.email ? (
                      <span className="topbar__user-dropdown-email">{user.email}</span>
                    ) : null}
                  </div>
                  <ul className="topbar__user-dropdown-list">
                    {userMenuItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <Link
                            to={item.href}
                            className="topbar__user-dropdown-item"
                            role="menuitem"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            <Icon size={16} aria-hidden />
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="topbar__user-dropdown-footer">
                    <button
                      type="button"
                      className="topbar__user-dropdown-item topbar__user-dropdown-item--danger"
                      role="menuitem"
                      onClick={handleSignOut}
                    >
                      <LogOut size={16} aria-hidden />
                      <span>Log out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Link to={loginUrl(pathname)} className="topbar__btn topbar__btn--ghost topbar__btn--login" aria-label="Log in">
              <LogIn size={14} aria-hidden />
              <span className="topbar__btn-label">Log in</span>
            </Link>
            <Link to={signupUrl(pathname)} className="topbar__btn topbar__btn--primary topbar__btn--signup" aria-label="Sign up">
              <UserPlus size={14} aria-hidden />
              <span className="topbar__btn-label">Sign up</span>
            </Link>
          </>
        )}

        <div className="topbar__notif-wrap">
          <motion.button
            type="button"
            className={`topbar__icon-btn${notifOpen ? " topbar__icon-btn--active" : ""}`}
            aria-label="Notifications"
            aria-expanded={notifOpen}
            aria-haspopup="dialog"
            onClick={() => setNotifOpen((open) => !open)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Bell size={18} aria-hidden />
            {user && unreadCount > 0 && (
              <span className="topbar__notif-badge" aria-label={`${unreadCount} unread`}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </motion.button>
          <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>
      </div>
    </header>
  );
}
