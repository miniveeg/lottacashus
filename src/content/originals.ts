export type OriginalGame = {
  id: string;
  name: string;
  description: string;
  /** Short label shown on the card. RTP moved out of the description so each
   *  game's voice can lead with what makes it distinctive, not a checklist. */
  rtp?: string;
  href: string;
  live: boolean;
  tag?: string;
  /** One-line hook used on the bento card — punchier than the description. */
  hook?: string;
  /** Difficulty 1–5 (shown as a meter). */
  difficulty?: 1 | 2 | 3 | 4 | 5;
  /** Min bet in GC. */
  minBet?: number;
  /** Max payout multiplier (e.g. "1,000,000×"). */
  maxWin?: string;
};

export const ORIGINAL_GAMES: OriginalGame[] = [
  {
    id: "crash",
    name: "Crash",
    description: "The multiplier climbs from 1.00×. Cash out before it busts. Wait too long and you lose everything.",
    href: "/crash",
    live: true,
    tag: "New",
    hook: "Beat the bust.",
    difficulty: 2,
    minBet: 1,
    maxWin: "1,000,000×",
  },
  {
    id: "case-battles",
    name: "Case Battles",
    description: "PvP case opens. Pick your mode, stack up to 50 cases, borrow up to 80% of your balance.",
    rtp: "Case RTP 94.5%",
    href: "/case-battles",
    live: true,
    tag: "Beta",
    hook: "Open cases. Take theirs.",
    difficulty: 3,
    minBet: 5,
    maxWin: "Jackpot",
  },
  {
    id: "blackjack",
    name: "Blackjack",
    description: "Classic 21 vs the dealer. Hit, stand, double, or split. Blackjack pays 3:2.",
    rtp: "96.5% RTP",
    href: "/blackjack",
    live: true,
    tag: "Live",
    hook: "Beat the dealer to 21.",
    difficulty: 4,
    minBet: 1,
    maxWin: "3:2",
  },
  {
    id: "roulette",
    name: "Roulette",
    description: "European single-zero wheel. Bet red, black, or green and watch it land.",
    rtp: "96.5% RTP",
    href: "/roulette",
    live: true,
    tag: "New",
    hook: "Red, black, or zero.",
    difficulty: 1,
    minBet: 1,
    maxWin: "36×",
  },
  {
    id: "mines",
    name: "Mines",
    description: "A 5×5 grid hides 1–24 mines. Reveal gems to raise your multiplier — cash out anytime.",
    rtp: "96.5% RTP",
    href: "/mines",
    live: true,
    tag: "Live",
    hook: "Don't hit a mine.",
    difficulty: 3,
    minBet: 1,
    maxWin: "~24,000×",
  },
  {
    id: "keno",
    name: "Keno",
    description: "Pick 1–10 numbers on a 40-tile board. Four risk modes from safe to extreme.",
    rtp: "96.5% RTP",
    href: "/keno",
    live: true,
    tag: "Live",
    hook: "Pick your numbers. Pick your risk.",
    difficulty: 2,
    minBet: 1,
    maxWin: "~10,000×",
  },
  {
    id: "limbo",
    name: "Limbo",
    description: "Name your target multiplier. If the roll beats it, you win. Higher targets, longer odds.",
    rtp: "96.5% RTP",
    href: "/limbo",
    live: true,
    tag: "Live",
    hook: "Name your multiplier.",
    difficulty: 2,
    minBet: 1,
    maxWin: "1,000,000×",
  },
  {
    id: "slots",
    name: "Slots",
    description: "Three reels, seven symbols. Crown pays 100×, Star pays 35×. Match three to win.",
    href: "/slots",
    live: true,
    tag: "New",
    hook: "Match three. Crown is king.",
    difficulty: 1,
    minBet: 1,
    maxWin: "100×",
  },
];

export const ORIGINALS_PATH = "/originals";

/** Routes that belong under the Originals section (hub + individual games). */
export const ORIGINALS_ROUTES = new Set<string>([
  ORIGINALS_PATH,
  ...ORIGINAL_GAMES.map((g) => g.href),
]);

/** Game pages guests may browse (play still requires login). */
export function isGuestBrowsableGamePath(pathname: string): boolean {
  if (ORIGINALS_ROUTES.has(pathname)) return true;
  if (pathname === "/case-battles/create") return true;
  if (pathname.startsWith("/case-battles/")) return true;
  return false;
}
