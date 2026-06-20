import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { loginUrl } from "../../lib/authRedirect";
import { formatCoinsWithUsd, formatUsd } from "../../lib/format";
import { fetchPublicProfile, fetchReferralInfo, claimAffiliateBalance, type ProfileStats, type ReferralInfo } from "../../lib/profile";
import "./Profile.css";

type Badge = { id: string; name: string; description: string; icon: string; check: (p: ProfileStats) => boolean };

const BADGES: Badge[] = [
  { id: "first-bet", name: "First Bet", icon: "★", description: "Placed your first game", check: () => true },
  { id: "high-roller", name: "High Roller", icon: "◆", description: "$1,000+ total wagered", check: (p) => p.totalWagered >= 1000 },
  { id: "roller", name: "Roller", icon: "◆", description: "$10,000+ total wagered", check: (p) => p.totalWagered >= 10000 },
  { id: "whale", name: "Whale", icon: "◆", description: "$100,000+ total wagered", check: (p) => p.totalWagered >= 100000 },
  { id: "veteran", name: "Veteran", icon: "⏱", description: "Account age 30+ days", check: (p) => { if (!p.memberSince) return false; return (Date.now() - new Date(p.memberSince).getTime()) / 86400000 >= 30; } },
];

function calcLevel(totalWagered: number): { level: number; xp: number; xpMax: number } {
  const xpPerLevel = 100;
  const level = Math.floor(totalWagered / xpPerLevel) + 1;
  const xp = totalWagered % xpPerLevel;
  return { level, xp, xpMax: xpPerLevel };
}

export function ProfilePage() {
  const { username: routeUsername } = useParams<{ username?: string }>();
  const { user, loading: authLoading } = useAuth();
  const { profile: authProfile } = useProfile();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwnProfile = !routeUsername;
  const displayProfile = isOwnProfile ? authProfile : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        let s: ProfileStats | null = null;
        if (isOwnProfile && authProfile) {
          s = {
            username: authProfile.username,
            balance: authProfile.balance,
            totalWagered: authProfile.totalWagered,
            totalDeposited: authProfile.totalDeposited,
            totalWithdrawn: authProfile.totalWithdrawn,
            totalWins: authProfile.totalWins,
            totalLosses: authProfile.totalLosses,
            memberSince: null,
            referralCode: null,
          };
        } else if (routeUsername) {
          s = await fetchPublicProfile(routeUsername);
        }
        if (!cancelled && s) setStats(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isOwnProfile, routeUsername, authProfile]);

  useEffect(() => {
    if (!isOwnProfile) return;
    let cancelled = false;
    async function loadRef() {
      const r = await fetchReferralInfo();
      if (!cancelled && r) setReferralInfo(r);
    }
    loadRef();
    return () => { cancelled = true; };
  }, [isOwnProfile]);

  const handleClaim = useCallback(async () => {
    setClaiming(true);
    setClaimMsg(null);
    const { error } = await claimAffiliateBalance();
    if (error) setClaimMsg(error);
    else setClaimMsg("Balance claimed successfully!");
    setClaiming(false);
    // Refresh referral info
    const r = await fetchReferralInfo();
    if (r) setReferralInfo(r);
  }, []);

  const handleCopy = useCallback(() => {
    if (!referralInfo?.referralCode) return;
    navigator.clipboard.writeText(referralInfo.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [referralInfo]);

  if (!routeUsername && !authLoading && !user) {
    return <Navigate to={loginUrl("/profile")} replace />;
  }

  if (loading || (isOwnProfile && authLoading)) {
    return (
      <div className="lc-page lc-page--medium profile-page">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading profile…</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="lc-page lc-page--medium profile-page">
        <div className="lc-empty">
          <p className="lc-alert lc-alert--error">Profile not found.</p>
        </div>
      </div>
    );
  }

  const p = displayProfile || stats;
  const { level, xp, xpMax } = calcLevel(p.totalWagered);
  const wins = p.totalWins;
  const losses = p.totalLosses;
  const totalGames = wins + losses;
  const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : "—";
  const netPL = wins - losses;
  const memberSince = stats.memberSince ? new Date(stats.memberSince).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : null;
  const sweepsBalance = (p as { sweepsCoins?: number }).sweepsCoins ?? 0;

  return (
    <div className="lc-page lc-page--medium profile-page">
      {/* Hero */}
      <section className="profile-hero">
        <div className="profile-hero__avatar" aria-hidden="true">
          {p.username ? p.username[0].toUpperCase() : "?"}
        </div>
        <div className="profile-hero__info">
          <h1 className="profile-hero__name">{p.username ?? "Player"}</h1>
          {memberSince && <p className="profile-hero__since">Member since {memberSince}</p>}
          <div className="profile-hero__level">
            <div className="profile-hero__level-bar" role="progressbar" aria-valuenow={xp} aria-valuemin={0} aria-valuemax={xpMax} aria-label="XP progress">
              <div className="profile-hero__level-fill" style={{ width: `${(xp / xpMax) * 100}%` }} />
            </div>
            <span className="profile-hero__level-text">Level {level} · {xp}/{xpMax} XP</span>
          </div>
        </div>
      </section>

      {/* Stats grid */}
      <section className="profile-stats">
        <div className="profile-stat profile-stat--gc">
          <span className="profile-stat__label">Gold Coins</span>
          <span className="profile-stat__value profile-stat__value--gold">
            {formatCoinsWithUsd(p.balance, "balance")}
          </span>
          <span className="profile-stat__sublabel">Play money</span>
        </div>
        <div className="profile-stat profile-stat--sc">
          <span className="profile-stat__label">Sweeps Coins</span>
          <span className="profile-stat__value profile-stat__value--emerald">
            {formatCoinsWithUsd(sweepsBalance, "sweeps_coins")}
          </span>
          <span className="profile-stat__sublabel">Redeemable for cash</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat__label">Total Wagered</span>
          <span className="profile-stat__value">{formatUsd(p.totalWagered)}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat__label">Deposited</span>
          <span className="profile-stat__value">{formatUsd(p.totalDeposited)}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat__label">Withdrawn</span>
          <span className="profile-stat__value">{formatUsd(p.totalWithdrawn)}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat__label">Net P/L</span>
          <span className={`profile-stat__value ${netPL >= 0 ? "profile-stat__value--emerald" : "profile-stat__value--danger"}`}>
            {netPL >= 0 ? "+" : ""}{formatUsd(netPL)}
          </span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat__label">Win Rate</span>
          <span className="profile-stat__value">{winRate}%</span>
        </div>
      </section>

      {/* Badges */}
      <section className="profile-section">
        <h2 className="profile-section__title">Badges</h2>
        <div className="profile-badges">
          {BADGES.map((badge) => {
            const earned = badge.check(stats);
            return (
              <div
                key={badge.id}
                className={`profile-badge${earned ? " profile-badge--earned" : " profile-badge--locked"}`}
                title={`${badge.name}: ${badge.description}${earned ? "" : " (locked)"}`}
              >
                <span className="profile-badge__icon" aria-hidden="true">{badge.icon}</span>
                <span className="profile-badge__name">{badge.name}</span>
                {!earned && (
                  <Lock
                    size={12}
                    className="profile-badge__lock"
                    aria-label="Locked"
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Referral section (own profile only) */}
      {isOwnProfile && referralInfo && (
        <section className="profile-section">
          <h2 className="profile-section__title">Affiliate & Referrals</h2>
          <div className="profile-referral">
            <div className="profile-referral__code-row">
              <div className="profile-referral__code">
                <span className="profile-referral__label">Your code</span>
                <code className="profile-referral__value">{referralInfo.referralCode}</code>
                <button
                  type="button"
                  className="profile-referral__copy"
                  onClick={handleCopy}
                  aria-label="Copy referral code to clipboard"
                  aria-live="polite"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div className="profile-referral__stats">
              <div className="profile-referral__stat">
                <span className="profile-referral__stat-label">Referred users</span>
                <span className="profile-referral__stat-value">{referralInfo.referredCount}</span>
              </div>
              <div className="profile-referral__stat">
                <span className="profile-referral__stat-label">Claimable balance</span>
                <span className="profile-referral__stat-value">{formatUsd(referralInfo.claimableBalance)}</span>
              </div>
            </div>
            {referralInfo.claimableBalance > 0 && (
              <button
                type="button"
                className="profile-referral__claim"
                onClick={handleClaim}
                disabled={claiming}
              >
                {claiming ? "Claiming…" : "Claim to balance"}
              </button>
            )}
            {claimMsg && (
              <p className={`profile-referral__msg${claimMsg.includes("error") || claimMsg.includes("Error") ? " profile-referral__msg--error" : ""}`}>
                {claimMsg}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
