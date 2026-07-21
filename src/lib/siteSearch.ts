import { ORIGINAL_GAMES } from "../content/originals";

export type SiteSearchItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  category: "game" | "page";
  keywords: string[];
};

const PAGE_ITEMS: SiteSearchItem[] = [
  {
    id: "home",
    label: "Home",
    description: "LottaCash landing page",
    href: "/",
    category: "page",
    keywords: ["home", "start", "landing"],
  },
  {
    id: "originals",
    label: "Originals",
    description: "Browse all house games",
    href: "/originals",
    category: "page",
    keywords: ["originals", "games", "hub"],
  },
  {
    id: "deposit",
    label: "Deposit",
    description: "Fund your wallet with crypto",
    href: "/deposit",
    category: "page",
    keywords: ["deposit", "crypto", "sol", "ltc", "eth", "wallet"],
  },
  {
    id: "withdraw",
    label: "Withdraw",
    description: "Cash out to your crypto wallet",
    href: "/withdraw",
    category: "page",
    keywords: ["withdraw", "cashout", "payout"],
  },
  {
    id: "settings",
    label: "Settings",
    description: "Account, stats, and Discord",
    href: "/settings",
    category: "page",
    keywords: ["settings", "account", "profile", "discord"],
  },
  {
    id: "help",
    label: "Help & FAQ",
    description: "FAQ and terms of service",
    href: "/help",
    category: "page",
    keywords: ["help", "faq", "terms", "support"],
  },
  {
    id: "privacy",
    label: "Privacy Policy",
    description: "How we handle your data",
    href: "/privacy",
    category: "page",
    keywords: ["privacy", "policy", "data", "gdpr"],
  },
  {
    id: "sweepstakes",
    label: "Sweepstakes Rules",
    description: "Official sweepstakes rules",
    href: "/sweepstakes",
    category: "page",
    keywords: ["sweepstakes", "rules", "sc", "sweeps", "legal"],
  },
  {
    id: "redeem",
    label: "Redeem",
    description: "Cash out Sweeps Coins for real money",
    href: "/redeem",
    category: "page",
    keywords: ["redeem", "cash out", "sc", "sweeps", "crypto", "sol", "ltc", "eth", "real money"],
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    description: "Top players and rankings",
    href: "/leaderboard",
    category: "page",
    keywords: ["leaderboard", "rankings", "top", "players"],
  },
  {
    id: "profile",
    label: "Profile",
    description: "View and edit your profile",
    href: "/profile",
    category: "page",
    keywords: ["profile", "stats", "avatar", "username"],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Administration panel",
    href: "/admin",
    category: "page",
    keywords: ["admin", "administration", "moderate"],
  },
  {
    id: "promotions",
    label: "Promotions",
    description: "Rewards and offers",
    href: "/promotions",
    category: "page",
    keywords: ["promotions", "promo", "bonus", "rewards"],
  },
];

// NOTE: `slots` and `case-battles` are intentionally NOT in PAGE_ITEMS — they
// are live games and are auto-generated in GAME_ITEMS below from ORIGINAL_GAMES.
// Duplicating them here would cause double entries in search results.

const GAME_ITEMS: SiteSearchItem[] = ORIGINAL_GAMES.filter((g) => g.live).map((g) => ({
  id: g.id,
  label: g.name,
  description: g.description,
  href: g.href,
  category: "game" as const,
  keywords: [g.id, g.name, g.href.replace("/", ""), "original", "game"],
}));

export const SITE_SEARCH_INDEX: SiteSearchItem[] = [...GAME_ITEMS, ...PAGE_ITEMS];

export function searchSite(query: string, limit = 8): SiteSearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = SITE_SEARCH_INDEX.map((item) => {
    const label = item.label.toLowerCase();
    const desc = item.description.toLowerCase();
    let score = 0;
    if (label === q) score += 100;
    else if (label.startsWith(q)) score += 50;
    else if (label.includes(q)) score += 30;
    if (desc.includes(q)) score += 10;
    for (const kw of item.keywords) {
      if (kw === q) score += 40;
      else if (kw.startsWith(q)) score += 20;
      else if (kw.includes(q)) score += 8;
    }
    return { item, score };
  }).filter((row) => row.score > 0);

  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit).map((row) => row.item);
}
