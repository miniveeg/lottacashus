import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Bell, Info, LogIn, LogOut, Menu, UserPlus } from "lucide-react";
import { NotificationsPanel } from "../NotificationsPanel/NotificationsPanel";
import { useAuth } from "../../contexts/AuthContext";
import { useNotifications } from "../../contexts/NotificationsContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { useSidebar } from "../../contexts/SidebarContext";
import { useToast } from "../../contexts/ToastContext";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import { formatUsd, formatCoins, coinsToUsd } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import { BrandLogo } from "../BrandLogo/BrandLogo";
import { PRIMARY_SIDEBAR_ID } from "../AppShell/AppShell";
import { TopbarLevelProgress } from "./TopbarLevelProgress";
import "../BrandLogo/BrandLogo.css";
import "./Topbar.css";
import "./TopbarLevelProgress.css";

export function Topbar() {
  const { user, loading, signOut } = useAuth();
  const { profile, profileLoading } = useProfile();
  const { coinType, setCoinType, label: coinLabel } = usePlayMode();
  const { pathname } = useLocation();
  const { unreadCount } = useNotifications();
  const { toggleMobile, mobileOpen } = useSidebar();
  const toast = useToast();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [coinInfoOpen, setCoinInfoOpen] = useState(false);

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
    ? formatCoins(0, coinType)
    : profileLoading
      ? "…"
      : formatCoins(activeBalance, coinType);

  const balanceUsd = coinsToUsd(activeBalance, coinType);

  async function handleSignOut() {
    await signOut();
    analytics.logout();
    analytics.reset();
    toast.info("You've been signed out.");
    navigate("/");
  }

  return (
    <header className="topbar">
      <div className="topbar__start">
        <motion.button
          type="button"
          className="topbar__menu-btn"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls={PRIMARY_SIDEBAR_ID}
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

      <div className="topbar__actions">
        <div className="topbar__balance-group">
          <Link
            to={user ? "/settings" : loginUrl(pathname)}
            className="topbar__balance"
            title={profileLoading ? "Loading…" : `${formatCoins(activeBalance, coinType)} = ${formatUsd(balanceUsd)}`}
            aria-busy={profileLoading || undefined}
          >
            <span className="topbar__balance-label">{coinLabel}</span>
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
            className="topbar__coin-toggle"
            aria-label={`Switch to ${coinType === "balance" ? "Sweeps Coins" : "Gold Coins"} (currently ${coinType === "balance" ? "Gold Coins" : "Sweeps Coins"}). Press for more info.`}
            aria-pressed={coinType === "sweeps_coins"}
            aria-expanded={coinInfoOpen}
            aria-haspopup="dialog"
            onClick={() => setCoinType(coinType === "balance" ? "sweeps_coins" : "balance")}
            onContextMenu={(e) => {
              // Long-press / right-click opens the info popover on desktop.
              e.preventDefault();
              setCoinInfoOpen((open) => !open);
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={coinType === "balance" ? "Showing Gold Coins — click to show Sweeps Coins. Right-click for info." : "Showing Sweeps Coins — click to show Gold Coins. Right-click for info."}
          >
            <span className="topbar__coin-toggle-label" aria-hidden="true">
              {coinType === "balance" ? "GC" : "SC"}
            </span>
          </motion.button>
          <button
            type="button"
            className="topbar__coin-info"
            aria-label="What are Gold Coins and Sweeps Coins?"
            aria-expanded={coinInfoOpen}
            aria-haspopup="dialog"
            onClick={() => setCoinInfoOpen((open) => !open)}
          >
            <Info size={14} aria-hidden />
          </button>
          {coinInfoOpen && (
            <div className="topbar__coin-popover" role="dialog" aria-label="Coin types explained">
              <button
                type="button"
                className="topbar__coin-popover-close"
                aria-label="Close"
                onClick={() => setCoinInfoOpen(false)}
              >
                ×
              </button>
              <p className="topbar__coin-popover-title">Gold Coins (GC)</p>
              <p className="topbar__coin-popover-text">
                Play money. No cash value, no redemption. Use GC to try games without risking real funds.
              </p>
              <p className="topbar__coin-popover-title">Sweeps Coins (SC)</p>
              <p className="topbar__coin-popover-text">
                Redeemable for real crypto (SOL, LTC, or ETH) at 100 SC = $1 USD. Minimum redemption is 100 SC.
              </p>
              <p className="topbar__coin-popover-hint">
                Click the GC/SC button to switch which balance you play with.
              </p>
            </div>
          )}
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
