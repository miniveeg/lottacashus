/** Stake card order: index 0–51 is ♦2 through ♣A */
export const STAKE_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const STAKE_SUITS = ["♦", "♥", "♠", "♣"] as const;

export type CardIndex = number;

export function cardRank(card: CardIndex): string {
  return STAKE_RANKS[Math.floor(card / 4)] ?? "?";
}

export function cardSuit(card: CardIndex): string {
  return STAKE_SUITS[card % 4] ?? "?";
}

export function cardLabel(card: CardIndex): string {
  const suit = cardSuit(card);
  const rank = cardRank(card);
  return `${suit}${rank}`;
}

export function isRedCard(card: CardIndex): boolean {
  const s = card % 4;
  return s === 0 || s === 1;
}

export function rankValue(card: CardIndex): number {
  const r = Math.floor(card / 4);
  if (r >= 9) return 10;
  return r + 2;
}

export type HandValue = { total: number; soft: boolean };

export function handValue(cards: CardIndex[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = Math.floor(c / 4);
    if (r === 12) aces++;
    else if (r >= 9) total += 10;
    else total += r + 2;
  }
  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) total += 11;
    else total += 1;
  }
  const soft = aces > 0 && total <= 21 && total >= 12;
  return { total, soft };
}

export function isBlackjack(cards: CardIndex[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBusted(cards: CardIndex[]): boolean {
  return handValue(cards).total > 21;
}
