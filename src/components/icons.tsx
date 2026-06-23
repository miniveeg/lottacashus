import {
  Home,
  Dices,
  Gift,
  Settings,
  CreditCard,
  Banknote,
  HelpCircle,
  Shield,
  Trophy,
  User,
  Gem,
  Target,
  Check,
  Diamond,
  Wallet,
  FileText,
  Grid3X3,
  Bomb,
  TrendingUp,
  CircleDot,
  Spade,
  Swords,
  Zap,
  Cherry,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps } from "react";

const ICONS = {
  home: Home,
  originals: Dices,
  promotions: Gift,
  settings: Settings,
  deposit: CreditCard,
  withdraw: Banknote,
  help: HelpCircle,
  admin: Shield,
  leaderboard: Trophy,
  profile: User,
  gem: Gem,
  target: Target,
  check: Check,
  slots: Diamond,
  redeem: Wallet,
  // Game-specific icons — shared between Originals.tsx cards and any future
  // sidebar game links so the icon vocabulary is consistent across the site.
  // These match the GAME_ICONS map in Originals.tsx (audit issue P1 #3).
  keno: Grid3X3,
  mines: Bomb,
  limbo: TrendingUp,
  roulette: CircleDot,
  blackjack: Spade,
  "case-battles": Swords,
  crash: Zap,
  cherry: Cherry,
  // Aliases used by other pages (Profile, SidebarNav, etc.)
  gift: Gift,
  trophy: Trophy,
  document: FileText,
} as const;

export type UiIconName = keyof typeof ICONS;

type UiIconProps = ComponentProps<LucideIcon> & {
  name: UiIconName;
};

export function UiIcon({ name, size = 18, strokeWidth = 2, ...props }: UiIconProps) {
  const Icon = ICONS[name];
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden {...props} />;
}

export { ICONS };
