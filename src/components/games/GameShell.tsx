import { useState, type ReactNode } from "react";
import { formatSC } from "../../lib/format";
import { getClientSeed, setClientSeed as persistSeed } from "../../lib/fair";
import { useWallet } from "../../context/WalletContext";

const CHIP_AMOUNTS = [1, 5, 10, 25, 50, 100] as const;

type Props = {
  title: string;
  rules: string;
  bet: number;
  onBet: (n: number) => void;
  min?: number;
  max?: number;
  extraControls?: ReactNode;
  children: ReactNode;
  lastResult?: string;
  hash?: string;
  revealedSeed?: string;
  nonce?: number;
  busy?: boolean;
};

export function GameShell({
  title,
  rules,
  bet,
  onBet,
  min = 1,
  max = 10000,
  extraControls,
  children,
  lastResult,
  hash,
  revealedSeed,
  nonce,
  busy,
}: Props) {
  const { balance } = useWallet();
  const [seed, setSeed] = useState(() => getClientSeed());

  function applySeed(v: string) {
    setSeed(v);
    persistSeed(v);
  }

  return (
    <div className="game-page">
      <h1>{title}</h1>
      <p className="lede">{rules}</p>
      <div className="game-layout">
        <div>{children}</div>
        <aside className="panel gold-edge">
          <h2>Table</h2>
          <div className="stat">
            <span>Balance</span>
            <b>{formatSC(balance)}</b>
          </div>
          <div className="field">
            <label htmlFor="bet-amount">Bet</label>
            <div className="bet-row">
              <input
                id="bet-amount"
                type="number"
                min={min}
                max={max}
                step="1"
                value={bet}
                disabled={busy}
                onChange={(e) => onBet(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="chip-row">
            {CHIP_AMOUNTS.map((n) => (
              <button
                type="button"
                key={n}
                className={`chip ${bet === n ? "on" : ""}`}
                disabled={busy}
                aria-label={`Set bet to ${n} SC`}
                onClick={() => onBet(n)}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              disabled={busy}
              aria-label="Double bet"
              onClick={() => onBet(Math.min(max, Math.round(bet * 2)))}
            >
              2×
            </button>
            <button
              type="button"
              className="chip"
              disabled={busy}
              aria-label="Halve bet"
              onClick={() => onBet(Math.max(min, Math.round(bet / 2)))}
            >
              ½
            </button>
          </div>
          {extraControls}
          {lastResult ? (
            <div className="stat">
              <span>Last</span>
              <b>{lastResult}</b>
            </div>
          ) : null}
          <h2 style={{ marginTop: 18 }}>Provably fair</h2>
          <div className="field">
            <label htmlFor="client-seed">Client seed</label>
            <input id="client-seed" value={seed} disabled={busy} onChange={(e) => applySeed(e.target.value)} />
          </div>
          <div className="fair-box">
            {typeof nonce === "number" ? (
              <div>
                Nonce <code>{nonce}</code>
              </div>
            ) : null}
            {hash ? (
              <div>
                Server hash <code>{hash}</code>
              </div>
            ) : null}
            {revealedSeed ? (
              <div>
                Server seed <code>{revealedSeed}</code>
              </div>
            ) : null}
            {hash ? null : <div>A hashed server seed is committed before each round, then revealed after.</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}
