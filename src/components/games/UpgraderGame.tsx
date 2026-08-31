import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { GameShell } from "./GameShell";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, resultFloat } from "../../lib/fair";
import { formatMulti, formatSC } from "../../lib/format";
import { upgraderChance } from "../../lib/games";
import { gsap, useGSAP } from "../../lib/motion";

const MULTI_PRESETS = [1.2, 1.5, 2, 3, 5, 10, 20] as const;

function rarityColor(m: number): string {
  if (m >= 10) return "#e8c36a";
  if (m >= 5) return "#d59bff";
  if (m >= 2.5) return "#7aa2ff";
  if (m >= 1.8) return "#3ee0a0";
  return "#aeb8c8";
}

export function UpgraderGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const reduce = useReducedMotion();
  const [bet, setBet] = useState(20);
  const [multi, setMulti] = useState(2);
  const [busy, setBusy] = useState(false);
  const [pointer, setPointer] = useState(0);
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [hit, setHit] = useState<boolean | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          ".upgrade-needle-tick",
          { rotate: -10 },
          { rotate: 0, duration: 0.55, ease: "power2.out" },
        );
      });
      return () => mm.revert();
    },
    { scope: stage },
  );

  const chance = useMemo(() => upgraderChance(Math.max(1.2, multi)), [multi]);
  const zone = chance * 100;

  async function play() {
    if (busy) return;
    if (balance + 1e-9 < bet) {
      push("Insufficient balance", "error");
      return;
    }
    const m = Math.min(20, Math.max(1.2, multi));
    setBusy(true);
    setHit(null);
    const commit = await commitRound();
    const paid = await debit(bet, { game: "upgrader", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const f = await resultFloat(commit.serverSeed, commit.clientSeed, commit.nonce);
    bumpNonce(1);
    const win = f < chance;
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setNonce(commit.nonce);
    setSeed(undefined);

    const land = win ? f * zone : zone + (f - chance) / Math.max(1e-9, 1 - chance) * (100 - zone);
    setPointer((p) => {
      const nextBase = Math.ceil((p + 0.001) / 100) * 100;
      return nextBase + 300 + land;
    });
    await new Promise((r) => setTimeout(r, 2200));
    setSeed(commit.serverSeed);
    setHit(win);
    const payout = win ? Math.round(bet * m * 100) / 100 : 0;
    setLast(win ? `Hit ${formatMulti(m)} · ${formatSC(payout)}` : "Miss");
    push(win ? `Upgrade hit — ${formatSC(payout)}` : "Upgrade missed", win ? "win" : "lose");
    await credit(payout, {
      roundId: paid.roundId,
      payout,
      serverSeed: commit.serverSeed,
      result: { multi: m, chance, float: f, win },
    });
    setBusy(false);
  }

  const glow = rarityColor(multi);
  const ring = `conic-gradient(from -90deg, ${glow} 0% ${zone}%, #3a1420 ${zone}%, #16161f 72%, #1c1c28 100%)`;

  return (
    <GameShell
      title="Upgrader"
      rules="Stake SC, pick a target multiplier. Chance = 97% / multiplier. Land in the glowing hit zone to cash the upgrade."
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
            <label htmlFor="upgrade-target">Target {formatMulti(multi)}</label>
            <input
              id="upgrade-target"
              type="range"
              min={1.2}
              max={20}
              step={0.1}
              value={multi}
              disabled={busy}
              onChange={(e) => setMulti(Number(e.target.value))}
            />
          </div>
          <div className="chip-row">
            {MULTI_PRESETS.map((n) => (
              <button type="button" key={n} className={`chip ${multi === n ? "on" : ""}`} disabled={busy} aria-label={`Set target to ${n}x`} onClick={() => setMulti(n)}>
                {n}x
              </button>
            ))}
          </div>
          <div className="stat">
            <span>Hit chance</span>
            <b>{(chance * 100).toFixed(2)}%</b>
          </div>
          <button type="button" className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void play()}>
            Spin {formatMulti(multi)}
          </button>
        </>
      }
    >
      <div ref={stage} className="panel game-canvas upgrade-stage gold-edge">
        <div className="upgrade-dial-wrap">
          <div className="upgrade-dial-ticks" aria-hidden="true" />
          <div className="upgrade-dial-ring" style={{ background: ring }} aria-hidden="true" />
          <div className="upgrade-needle-tick" aria-hidden="true">
            <motion.div
              className="upgrade-needle"
              animate={{ rotate: pointer * 3.6 }}
              transition={{ duration: reduce || !busy ? 0.2 : 2.1, ease: [0.12, 0.82, 0.08, 1] }}
            />
          </div>
          <div className="upgrade-dial-core">
            <p className="upgrade-multi" style={{ color: glow }}>
              {formatMulti(multi)}
            </p>
            <p className="upgrade-chance">
              {(chance * 100).toFixed(2)}% to {formatSC(bet * multi)}
            </p>
          </div>
        </div>
        {hit !== null ? (
          <p className={`upgrade-call ${hit ? "win" : "loss"}`}>{hit ? "HIT" : "MISS"}</p>
        ) : (
          <p className="upgrade-call muted">Land the needle in the glow</p>
        )}
      </div>
    </GameShell>
  );
}
