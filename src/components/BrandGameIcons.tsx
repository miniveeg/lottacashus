/**
 * LottaCash custom brand game icons — hand-crafted inline SVGs that replace
 * the stock lucide-react outline icons the audit (Agent #3) flagged as the
 * #1 "AI-generated look" tell. Each icon uses the brand's visual language:
 * geometric, crimson/amber strokes, no generic "outline icon in a rounded
 * square" pattern. Used on /originals, the sidebar, and anywhere game icons
 * appear.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  className,
  "aria-hidden": true as const,
});

/** Keno — a 3×3 number grid with a highlighted center tile. */
export function KenoIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="15" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />
      <rect x="15" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="15" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Mines — a grid with a diamond gem and a hidden mine (circle with spikes). */
export function MinesIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12l2-3 2 3-2 3z" fill="currentColor" />
      <circle cx="16" cy="12" r="2.5" fill="currentColor" />
      <line x1="16" y1="8" x2="16" y2="6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="16" y1="16" x2="16" y2="17.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="19.5" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Limbo — a rising multiplier curve with an arrow. */
export function LimboIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M3 20C7 20 9 16 12 12S17 4 21 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 4h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="22" textAnchor="middle" fontSize="6" fill="currentColor" fontFamily="monospace" fontWeight="700">×</text>
    </svg>
  );
}

/** Roulette — a wheel with pockets and a ball. */
export function RouletteIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.4" />
      <line x1="12" y1="3" x2="12" y2="7" stroke="currentColor" strokeWidth="1.4" />
      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="1.4" />
      <line x1="3" y1="12" x2="7" y2="12" stroke="currentColor" strokeWidth="1.4" />
      <line x1="17" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Blackjack — two playing cards fanned. */
export function BlackjackIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="4" y="6" width="9" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" transform="rotate(-8 8.5 12.5)" />
      <rect x="11" y="5" width="9" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" transform="rotate(8 15.5 11.5)" />
      <text x="14" y="13" textAnchor="middle" fontSize="7" fill="currentColor" fontFamily="monospace" fontWeight="700" transform="rotate(8 15.5 11.5)">A</text>
      <text x="7" y="14" textAnchor="middle" fontSize="7" fill="currentColor" fontFamily="monospace" fontWeight="700" transform="rotate(-8 8.5 12.5)">K</text>
    </svg>
  );
}

/** Crash — an exponential curve crashing at a peak. */
export function CrashIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M3 20C8 20 10 16 13 11S18 5 20 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 5v3M20 5h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 5l-2 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2" />
      <circle cx="20" cy="5" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Slots — three reels with a crown on the center line. */
export function SlotsIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <line x1="9" y1="5" x2="9" y2="19" stroke="currentColor" strokeWidth="1.4" />
      <line x1="15" y1="5" x2="15" y2="19" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 9l1.5 2h-3z" fill="currentColor" />
      <path d="M10.5 13h3v2h-3z" fill="currentColor" />
      <circle cx="6" cy="12" r="1.2" fill="currentColor" opacity="0.4" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

/** Case Battles — two crossed swords over a case. */
export function CaseBattlesIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="6" y="9" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="6" y1="13" x2="18" y2="13" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 4l5 5M19 4l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 4h2v2M19 4h-2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Map game IDs to their custom icon components. */
export const GAME_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  keno: KenoIcon,
  mines: MinesIcon,
  limbo: LimboIcon,
  roulette: RouletteIcon,
  blackjack: BlackjackIcon,
  crash: CrashIcon,
  slots: SlotsIcon,
  "case-battles": CaseBattlesIcon,
};
