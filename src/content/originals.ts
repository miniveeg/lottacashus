export type OriginalGame = {
  id: string;
  name: string;
  description: string;
  href: string;
  live: boolean;
  tag?: string;
};

export const ORIGINAL_GAMES: OriginalGame[] = [
  {
    id: "keno",
    name: "Keno",
    description:
      "Pick 1–10 numbers on a 40-tile board. Four risk modes, provably fair — 94.5% RTP.",
    href: "/keno",
    live: true,
    tag: "Live",
  },
  {
    id: "mines",
    name: "Mines",
    description:
      "5×5 grid, 1–24 mines. Reveal gems, dodge bombs, cash out anytime. 94.5% RTP.",
    href: "/mines",
    live: true,
    tag: "Live",
  },
  {
    id: "limbo",
    name: "Limbo",
    description:
      "Pick a target multiplier. Beat the roll to win. Provably fair, 94.5% RTP.",
    href: "/limbo",
    live: true,
    tag: "Live",
  },
  {
    id: "roulette",
    name: "Roulette",
    description:
      "European wheel — bet red, black, or green (0). Provably fair — 94.5% RTP.",
    href: "/roulette",
    live: true,
    tag: "New",
  },
  {
    id: "blackjack",
    name: "Blackjack",
    description:
      "Classic 21 vs the dealer. Hit, stand, double. 3:2 blackjack, H17 — 94.5% RTP.",
    href: "/blackjack",
    live: true,
    tag: "Live",
  },
  {
    id: "case-battles",
    name: "Case Battles",
    description:
      "PvP case opens — pick gamemode, stack up to 50 cases, borrow up to 80%. Case RTP 84.5%.",
    href: "/case-battles",
    live: true,
    tag: "Beta",
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
