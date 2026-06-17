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
