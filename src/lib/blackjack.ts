export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export type Card = { suit: Suit; rank: Rank; id: string };

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function suitColor(suit: Suit): "red" | "black" {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

export function suitGlyph(suit: Suit): string {
  switch (suit) {
    case "spades":
      return "♠";
    case "hearts":
      return "♥";
    case "diamonds":
      return "♦";
    case "clubs":
      return "♣";
  }
}

function cardValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

export type HandValue = { total: number; soft: boolean; blackjack: boolean; bust: boolean };

export function handValue(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  const blackjack = cards.length === 2 && total === 21;
  return { total, soft: aces > 0 && total <= 21, blackjack, bust: total > 21 };
}

/** 6-deck shoe, shuffled with Fisher-Yates using provided floats. */
export function buildShoe(floats: number[]): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < 6; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, id: `${d}-${suit}-${rank}` });
      }
    }
  }
  let f = 0;
  for (let i = deck.length - 1; i > 0; i--) {
    const r = floats[f % floats.length] ?? 0.5;
    f += 1;
    const j = Math.floor(r * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

export function needsReshuffle(shoe: Card[]): boolean {
  return shoe.length < 60;
}
