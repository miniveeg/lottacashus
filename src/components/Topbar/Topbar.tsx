import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Bell, LogIn, LogOut, Menu, Search, UserPlus, X } from "lucide-react";
import { NotificationsPanel } from "../NotificationsPanel/NotificationsPanel";
import { useAuth } from "../../contexts/AuthContext";
import { useNotifications } from "../../contexts/NotificationsContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { useSidebar } from "../../contexts/SidebarContext";
import { useToast } from "../../contexts/ToastContext";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import { formatUsd } from "../../lib/format";
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

export function Topbar() {
  const { user, loading, signOut } = useAuth();
  const { profile, profileLoading } = useProfile();
  const { coinType, setCoinType, label: coinLabel } = usePlayMode();
  const { pathname } = useLocation();
  const { unreadCount } = useNotifications();
  const { toggleMobile } = useSidebar();
  const toast = useToast();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = searchSite(searchQuery);

  const displayName =
    profile?.username ??
    user?.user_metadata?.username ??
    user?.email?.split("@")[0] ??
    "Player";

  const activeBalance = !user
    ? 0
    : coinType === "sweeps_coins"
      ? (profile?.sweepsCoins ?? 0)
      : (profile?.balance ?? 0);

  const balanceDisplay = !user
    ? formatUsd(0)
    : profileLoading
      ? "…"
      : formatUsd(activeBalance);

  async function handleSignOut() {
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

  // Close the mobile search overlay whenever the route changes.
  useEffect(() => {
    setMobileSearchOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(ev: MouseEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(ev.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Auto-focus the search input when the mobile search overlay opens so the
  // keyboard appears immediately and the user can start typing.
  useEffect(() => {
    if (mobileSearchOpen) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [mobileSearchOpen]);

  return (
    <header className={`topbar${mobileSearchOpen ? " topbar--search-open" : ""}`}>
      <div className="topbar__start">
        <motion.button
          type="button"
          className="topbar__menu-btn"
          aria-label="Open menu"
          onClick={toggleMobile}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Menu size={20} aria-hidden />
        </motion.button>
        <Link to="/" className="topbar__brand">
          <BrandLogo className="topbar__logo" size={40} alt="" />
          <span className="topbar__name">LottaCash</span>
        </Link>
      </div>

      <div className="topbar__search-wrap" ref={searchWrapRef}>
        <form
          className="topbar__search"
          role="search"
          onSubmit={handleSearchSubmit}
        >
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

        <div className="topbar__balance-group">
          <Link
            to={user ? "/settings" : loginUrl(pathname)}
            className="topbar__balance"
            title="Account settings"
            aria-busy={profileLoading || undefined}
          >
            <span className="topbar__balance-label">{coinLabel}</span>
            <span className="topbar__balance-value">
              {profileLoading ? (
                <span className="visually-hidden">Loading balance</span>
              ) : null}
              {balanceDisplay}
            </span>
          </Link>
          <motion.button
            type="button"
            className="topbar__coin-toggle"
            aria-label={`Switch to ${coinType === "balance" ? "Sweeps Coins" : "Gold Coins"} (currently ${coinType === "balance" ? "Gold Coins" : "Sweeps Coins"})`}
            aria-pressed={coinType === "sweeps_coins"}
            onClick={() => setCoinType(coinType === "balance" ? "sweeps_coins" : "balance")}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={coinType === "balance" ? "Showing Gold Coins — click to show Sweeps Coins" : "Showing Sweeps Coins — click to show Gold Coins"}
          >
            <span className="topbar__coin-toggle-label" aria-hidden="true">
              {coinType === "balance" ? "GC" : "SC"}
            </span>
          </motion.button>
        </div>

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
            <motion.button
              type="button"
              className="topbar__btn topbar__btn--ghost topbar__btn--logout"
              onClick={handleSignOut}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <LogOut size={14} aria-hidden />
              Log out
            </motion.button>
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
