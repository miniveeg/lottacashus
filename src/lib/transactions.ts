import { isSupabaseConfigured, supabase } from "./supabase";
import type { Transaction, TransactionType } from "../types/transaction";

/** When timestamps match, show wager before win/loss in the list (newest-first). */
const TYPE_DISPLAY_ORDER: Record<TransactionType, number> = {
  wager: 0,
  loss: 1,
  win: 2,
  affiliate: 3,
  deposit: 4,
  withdrawal: 5,
};

export const TRANSACTIONS_PAGE_SIZE = 10;

const NOT_CONFIGURED_ERROR = "Supabase is not configured. Add your keys to .env.";

export function sortTransactionsForDisplay(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => {
    const tb = new Date(b.created_at).getTime();
    const ta = new Date(a.created_at).getTime();
    if (tb !== ta) return tb - ta;
    return TYPE_DISPLAY_ORDER[a.type] - TYPE_DISPLAY_ORDER[b.type];
  });
}

export async function fetchTransactionsPage(page: number, pageSize = TRANSACTIONS_PAGE_SIZE): Promise<{
  transactions: Transaction[];
  total: number;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { transactions: [], total: 0, error: NOT_CONFIGURED_ERROR };
  }

  const { data, error } = await supabase.rpc("get_user_transactions", {
    p_page: page,
    p_page_size: pageSize,
  });

  if (!error && data) {
    const rows = data as Record<string, unknown>[];
    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
    return {
      transactions: rows.map((row) =>
        mapTransactionRow({
          id: row.id as string,
          type: row.type as string,
          amount: row.amount as number | string,
          balance_after: row.balance_after as number | string | null,
          description: row.description as string | null,
          created_at: row.created_at as string,
        })
      ),
      total,
      error: null,
    };
  }

  // Fallback path: query the table directly if the RPC is unavailable.
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data: fallbackRows, error: fallbackError, count } = await supabase
    .from("transactions")
    .select("id, type, amount, balance_after, description, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (fallbackError) {
    return { transactions: [], total: 0, error: fallbackError.message };
  }

  const transactions = sortTransactionsForDisplay(
    (fallbackRows ?? []).map((row) => mapTransactionRow(row as {
      id: string;
      type: string;
      amount: number | string;
      balance_after: number | string | null;
      description: string | null;
      created_at: string;
    }))
  );

  return {
    transactions,
    total: count ?? transactions.length,
    error: null,
  };
}

export function mapTransactionRow(row: {
  id: string;
  type: string;
  amount: number | string;
  balance_after: number | string | null;
  description: string | null;
  created_at: string;
}): Transaction {
  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: Number(row.amount),
    balance_after: row.balance_after != null ? Number(row.balance_after) : null,
    description: row.description,
    created_at: row.created_at,
  };
}
