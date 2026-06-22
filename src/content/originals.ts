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
};

export const ORIGINAL_GAMES: OriginalGame[] = [
  {
    id: "keno",
    name: "Keno",
    description: "Pick your numbers, pick your risk. Four modes from safe to extreme — 40 tiles, your call.",
    rtp: "94.5% RTP",
    href: "/keno",
    live: true,
    tag: "Live",
  },
  {
    id: "mines",
    name: "Mines",
    description: "One wrong tile ends it. Cash out before you go too far — or dig until there's nothing left.",
    rtp: "94.5% RTP",
    href: "/mines",
    live: true,
    tag: "Live",
  },
  {
    id: "limbo",
    name: "Limbo",
    description: "Name your multiplier. If the roll beats it, you win. The higher you go, the longer the odds.",
    rtp: "94.5% RTP",
    href: "/limbo",
    live: true,
    tag: "Live",
  },
  {
    id: "roulette",
    name: "Roulette",
    description: "European wheel. Red, black, or green. Place your bet and watch it land.",
    rtp: "94.5% RTP",
    href: "/roulette",
    live: true,
    tag: "New",
  },
  {
    id: "blackjack",
    name: "Blackjack",
    description: "You vs the dealer. Hit, stand, or double. Hit 21 and collect 3:2.",
    rtp: "94.5% RTP",
    href: "/blackjack",
    live: true,
    tag: "Live",
  },
  {
    id: "case-battles",
    name: "Case Battles",
    description: "PvP case opens. Pick your mode, stack up to 50 cases, borrow up to 80% of your balance.",
    rtp: "Case RTP 84.5%",
    href: "/case-battles",
    live: true,
    tag: "Beta",
  },
  {
    id: "crash",
    name: "Crash",
    description: "The multiplier climbs. Cash out before it crashes. Wait too long and you lose everything.",
    href: "/crash",
    live: true,
    tag: "New",
  },
  {
    id: "slots",
    name: "Slots",
    description: "Three reels. Match symbols to win. Crown pays 50×, Star pays 25×.",
    href: "/slots",
    live: true,
    tag: "New",
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
