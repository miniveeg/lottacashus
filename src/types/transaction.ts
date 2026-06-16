export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "wager"
  | "win"
  | "loss"
  | "affiliate";

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  balance_after: number | null;
  description: string | null;
  created_at: string;
};

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  wager: "Wager",
  win: "Win",
  loss: "Loss",
  affiliate: "Affiliate",
};
