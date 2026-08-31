import { useState } from "react";
import { formatSC } from "../lib/format";
import { useWallet } from "../context/WalletContext";
import { useToast } from "../context/ToastContext";
import { isSupabaseConfigured } from "../lib/supabase";

export function Wallet() {
  const { balance, deposit, live } = useWallet();
  const { push } = useToast();
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const [coin, setCoin] = useState<"SOL" | "LTC" | "ETH">("SOL");

  const addresses: Record<string, string> = {
    SOL: import.meta.env.VITE_SOL_ADDRESS || "Set VITE_SOL_ADDRESS to show a live deposit address.",
    LTC: import.meta.env.VITE_LTC_ADDRESS || "Set VITE_LTC_ADDRESS to show a live deposit address.",
    ETH: import.meta.env.VITE_ETH_ADDRESS || "Set VITE_ETH_ADDRESS to show a live deposit address.",
  };

  async function demoAdd() {
    await deposit(amount);
    push(`Demo deposit ${formatSC(amount)}`, "win");
  }

  return (
    <div className="game-page">
      <h1>Wallet</h1>
      <p className="lede">
        One SC balance across every table. Demo credits yourself. Live mode waits on chain, then a cashier credits you after
        the tx lands.
      </p>
      <div className="game-layout">
        <div className="panel">
          <h2>Balance</h2>
          <p style={{ fontFamily: "Syne, sans-serif", fontSize: 42, color: "var(--gold-2)" }}>{formatSC(balance)}</p>
          <p className="fair-box" style={{ marginTop: 8 }}>
            {live && isSupabaseConfigured
              ? "Supabase is configured. Debits/credits try place_bet / settle_bet RPCs, then fall back to local SC if those RPCs are missing."
              : "Demo mode — SC lives in this browser (lc_demo_balance)."}
          </p>
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="demo-deposit">Demo deposit (SC)</label>
            <input id="demo-deposit" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <button type="button" className="btn btn-emerald" onClick={() => void demoAdd()}>
            Demo deposit {formatSC(amount)}
          </button>
        </div>
        <aside className="panel">
          <h2>Crypto deposit</h2>
          <div className="chip-row">
            {(["SOL", "LTC", "ETH"] as const).map((c) => (
              <button type="button" key={c} className={`chip ${coin === c ? "on" : ""}`} aria-label={`Deposit with ${c}`} onClick={() => setCoin(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="fair-box">
            Send {coin} to:
            <div>
              <code>{addresses[coin]}</code>
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="redeem-note">I&apos;ve sent a tx</label>
            <textarea
              id="redeem-note"
              rows={3}
              placeholder="Paste tx hash and the SC you expect."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              push("Redeem note saved locally. Cashier credits after confirmation.", "info");
              localStorage.setItem("lc_redeem_note", JSON.stringify({ coin, note, at: Date.now() }));
              setNote("");
            }}
          >
            Submit redeem request
          </button>
        </aside>
      </div>
    </div>
  );
}
