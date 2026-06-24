import { Inbox } from "lucide-react";
import { formatUsd } from "../../lib/format";
import {
  fetchTransactionsPage,
  TRANSACTIONS_PAGE_SIZE,
} from "../../lib/transactions";
import type { Transaction } from "../../types/transaction";
import { TRANSACTION_LABELS } from "../../types/transaction";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";

/**
 * Transactions section of the Settings page.
 *
 * Extracted from the 841-line `Settings.tsx` god-component (audit finding:
 * Account agent #10). This is the second extraction (Provably Fair was first).
 * Future rounds should similarly extract Account, Discord, and Responsible
 * Gaming.
 *
 * Self-contained: owns its own transactions state, loading, pagination, and
 * formatting helpers. Loads on mount when a user is present.
 */

function formatTxDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function txAmountClass(type: Transaction["type"], amount: number) {
  if (type === "deposit" || type === "win" || type === "affiliate") return "settings__tx-amount--pos";
  if (type === "withdrawal" || type === "loss" || type === "wager") return "settings__tx-amount--neg";
  return amount >= 0 ? "settings__tx-amount--pos" : "settings__tx-amount--neg";
}

function txCoinType(type: Transaction["type"]): "balance" | "sweeps_coins" {
  if (type === "withdrawal" || type === "affiliate") return "sweeps_coins";
  return "balance";
}

export function SettingsTransactionsSection({ userId }: { userId: string | undefined }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txPage, setTxPage] = useState(0);
  const [txTotal, setTxTotal] = useState(0);

  const txPageCount = Math.max(1, Math.ceil(txTotal / TRANSACTIONS_PAGE_SIZE));

  const loadTransactions = useCallback(async () => {
    if (!userId) return;
    setTxLoading(true);
    const { transactions: rows, total, error: txError } = await fetchTransactionsPage(txPage);
    if (!txError) {
      setTransactions(rows);
      setTxTotal(total);
    }
    setTxLoading(false);
  }, [userId, txPage]);

  useEffect(() => {
    if (!userId) return;
    loadTransactions();

    // Realtime: auto-refresh when new transactions are created (e.g. bet
    // resolves, deposit credits). Moved here from the parent Settings.tsx
    // during the extraction (audit R9).
    const channel = supabase
      .channel(`transactions-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${userId}`,
        },
        () => loadTransactions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadTransactions]);

  return (
    <section className="settings__section">
      <h2 className="settings__section-title">Transactions</h2>
      <p className="settings__section-desc">
        Deposits, withdrawals, wagers, and wins. Each bet shows the wager before the result.
      </p>

      {txLoading ? (
        <div className="lc-loading">
          <div className="lc-loading__pulse" />
          <span>Loading transactions…</span>
        </div>
      ) : transactions.length === 0 ? (
        <div className="settings__tx-empty">
          <Inbox size={28} aria-hidden="true" />
          <p>No transactions yet.</p>
          <p className="settings__tx-empty-hint">
            Your activity history will show up here automatically.
          </p>
        </div>
      ) : (
        <div className="settings__tx-table-wrap">
          <table className="settings__tx-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Balance after</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>{formatTxDate(tx.created_at)}</td>
                  <td>
                    <span className={`settings__tx-type settings__tx-type--${tx.type}`}>
                      {TRANSACTION_LABELS[tx.type]}
                    </span>{" "}
                    <span
                      className={`settings__tx-coin-badge ${
                        txCoinType(tx.type) === "sweeps_coins"
                          ? "settings__tx-coin-badge--sc"
                          : "settings__tx-coin-badge--gc"
                      }`}
                      title={
                        txCoinType(tx.type) === "sweeps_coins"
                          ? "Sweeps Coins transaction (redeemable for cash)"
                          : "Gold Coins transaction (play money)"
                      }
                    >
                      {txCoinType(tx.type) === "sweeps_coins" ? "SC" : "GC"}
                    </span>
                  </td>
                  <td className={txAmountClass(tx.type, tx.amount)}>
                    {formatUsd(Math.abs(tx.amount))}
                  </td>
                  <td>{tx.balance_after != null ? formatUsd(tx.balance_after) : "—"}</td>
                  <td>{tx.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!txLoading && txTotal > TRANSACTIONS_PAGE_SIZE && (
        <div className="settings__tx-pagination">
          <button
            type="button"
            className="settings__tx-page-btn"
            disabled={txPage <= 0}
            onClick={() => setTxPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="settings__tx-page-info">
            Page {txPage + 1} of {txPageCount}
          </span>
          <button
            type="button"
            className="settings__tx-page-btn"
            disabled={txPage + 1 >= txPageCount}
            onClick={() => setTxPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
