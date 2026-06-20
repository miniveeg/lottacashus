export type OriginalGame = {
  id: string;
  name: string;
  description: string;
  href: string;
  live: boolean;
  tag?: string;
  /** Optional RTP label shown as a badge on cards. */
  rtp?: string;
};

export const ORIGINAL_GAMES: OriginalGame[] = [
  {
    id: "keno",
    name: "Keno",
    description:
      "Pick 1–10 numbers on a 40-tile board. Four risk modes, provably fair — chase the big multipliers on a max-tile hit.",
    href: "/keno",
    live: true,
    tag: "Live",
    rtp: "94.5% RTP",
  },
  {
    id: "mines",
    name: "Mines",
    description:
      "5×5 grid, 1–24 mines. Reveal gems, dodge bombs, cash out anytime — every tile is verifiably fair.",
    href: "/mines",
    live: true,
    tag: "Live",
    rtp: "94.5% RTP",
  },
  {
    id: "limbo",
    name: "Limbo",
    description:
      "Pick a target multiplier. Beat the roll to win. Provably fair, instant settles, infinite upside.",
    href: "/limbo",
    live: true,
    tag: "Live",
    rtp: "94.5% RTP",
  },
  {
    id: "roulette",
    name: "Roulette",
    description:
      "European wheel — bet red, black, or green (0). Single-zero layout, provably fair spins.",
    href: "/roulette",
    live: true,
    tag: "New",
    rtp: "94.5% RTP",
  },
  {
    id: "blackjack",
    name: "Blackjack",
    description:
      "Classic 21 vs the dealer. Hit, stand, double. 3:2 blackjack, H17 — same rules you know.",
    href: "/blackjack",
    live: true,
    tag: "Live",
    rtp: "94.5% RTP",
  },
  {
    id: "crash",
    name: "Crash",
    description:
      "Watch the multiplier rise. Cash out before it crashes. Provably fair, round-the-clock action.",
    href: "/crash",
    live: true,
    tag: "New",
    rtp: "94.5% RTP",
  },
  {
    id: "slots",
    name: "Slots",
    description:
      "Classic 3-reel slot machine. Match symbols to win big — Crown 50x, Star 25x, and more.",
    href: "/slots",
    live: true,
    tag: "New",
    rtp: "94.5% RTP",
  },
  {
    id: "case-battles",
    name: "Case Battles",
    description:
      "PvP case opens — pick a gamemode, stack up to 50 cases, borrow up to 80%. EOS-block randomness.",
    href: "/case-battles",
    live: true,
    tag: "Beta",
    rtp: "84.5% case RTP",
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
