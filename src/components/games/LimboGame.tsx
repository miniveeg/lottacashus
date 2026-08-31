import { useState } from "react";
import { motion } from "framer-motion";
import { GameShell } from "./GameShell";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, resultFloat } from "../../lib/fair";
import { formatMulti, formatSC } from "../../lib/format";
import { limboResult } from "../../lib/games";

const TARGET_PRESETS = [1.5, 2, 5, 10, 50] as const;
const GRAPH_W = 640;
const GRAPH_H = 280;
const GRAPH_STEPS = 40;

type Flash = "win" | "lose" | null;

function yOf(m: number, maxM: number): number {
  const logMax = Math.log10(Math.max(maxM, 1.01));
  const t = Math.log10(Math.max(1, m)) / logMax;
  return GRAPH_H - t * (GRAPH_H - 24);
}

function LimboCanvas({ display, target, flash }: { display: number; target: number; flash: Flash }) {
  const maxM = Math.max(target, display, 2);
  const pts: string[] = [];
  for (let i = 0; i <= GRAPH_STEPS; i++) {
    const t = i / GRAPH_STEPS;
    const m = 1 + (display - 1) * Math.pow(t, 0.65);
    pts.push(`${(t * GRAPH_W).toFixed(1)},${yOf(m, maxM).toFixed(1)}`);
  }
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${GRAPH_W},${GRAPH_H} L 0,${GRAPH_H} Z`;
  const ty = yOf(target, maxM);
  const color = flash === "win" ? "#3cbf8a" : flash === "lose" ? "#8a2430" : "#c9a24a";

  return (
    <div className="limbo-stage game-canvas">
      <svg className="limbo-graph" viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="limboFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.38" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#limboFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
        <line x1="0" y1={ty} x2={GRAPH_W} y2={ty} stroke="#c9a24a" strokeDasharray="6 8" strokeOpacity="0.55" />
      </svg>
      <div className="limbo-readout" style={{ color }}>
        {formatMulti(display)}
      </div>
      <div className="stat">
        <span>Target line</span>
        <b>{formatMulti(target)}</b>
      </div>
    </div>
  );
}

export function LimboGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const [bet, setBet] = useState(10);
  const [target, setTarget] = useState(2);
  const [busy, setBusy] = useState(false);
  const [display, setDisplay] = useState(1);
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [flash, setFlash] = useState<Flash>(null);

  async function play() {
    if (busy) return;
    if (balance + 1e-9 < bet) {
      push("Insufficient balance", "error");
      return;
    }
    const t = Math.min(1000, Math.max(1.01, target));
    setBusy(true);
    setFlash(null);
    const commit = await commitRound();
    const paid = await debit(bet, { game: "limbo", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const f = await resultFloat(commit.serverSeed, commit.clientSeed, commit.nonce);
    bumpNonce(1);
    const raw = limboResult(f);
    const result = Math.min(1e6, raw);
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setNonce(commit.nonce);

    const frames = 28;
    for (let i = 1; i <= frames; i++) {
      const ease = 1 - Math.pow(1 - i / frames, 3);
      const tick = 1 + (result - 1) * ease + Math.sin(i * 1.7) * (1 - ease) * result * 0.08;
      setDisplay(tick);
      await new Promise((r) => setTimeout(r, 28));
    }
    setDisplay(result);
    setSeed(commit.serverSeed);
    const win = result + 1e-12 >= t;
    const payout = win ? Math.round(bet * t * 100) / 100 : 0;
    setFlash(win ? "win" : "lose");
    setLast(`${formatMulti(result)} vs ${formatMulti(t)} · ${win ? formatSC(payout) : "bust"}`);
    push(win ? `Limbo ${formatMulti(result)} — paid ${formatSC(payout)}` : `Crashed at ${formatMulti(result)}`, win ? "win" : "lose");
    await credit(payout, {
      roundId: paid.roundId,
      payout,
      serverSeed: commit.serverSeed,
      result: { result, target: t },
    });
    setBusy(false);
  }

  const chance = Math.min(99, (0.99 / Math.max(1.01, target)) * 100);

  return (
    <GameShell
      title="Limbo"
      rules="Pick a target. The crash point rolls from a fair float: 0.99 / roll. If it clears your line, you get bet × target."
      bet={bet}
      onBet={setBet}
      busy={busy}
      lastResult={last}
      hash={hash}
      revealedSeed={seed}
      nonce={nonce}
      extraControls={
        <>
          <div className="field">
            <label htmlFor="limbo-target">Target multiplier</label>
            <input
              id="limbo-target"
              type="number"
              min={1.01}
              max={1000}
              step={0.01}
              value={target}
              disabled={busy}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </div>
          <div className="chip-row">
            {TARGET_PRESETS.map((n) => (
              <button type="button" key={n} className={`chip ${target === n ? "on" : ""}`} disabled={busy} aria-label={`Set target to ${n}x`} onClick={() => setTarget(n)}>
                {n}x
              </button>
            ))}
          </div>
          <div className="stat">
            <span>Win chance</span>
            <b>{chance.toFixed(2)}%</b>
          </div>
          <button type="button" className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void play()}>
            Roll {formatMulti(target)}
          </button>
        </>
      }
    >
      <motion.div
        className="panel gold-edge"
        animate={{ boxShadow: flash === "win" ? "0 0 80px rgba(62,224,160,.35)" : flash === "lose" ? "0 0 80px rgba(255,77,106,.35)" : "0 24px 70px rgba(0,0,0,.55)" }}
      >
        <LimboCanvas display={display} target={target} flash={flash} />
      </motion.div>
    </GameShell>
  );
}
