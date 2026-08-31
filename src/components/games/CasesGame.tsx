import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { GameShell } from "./GameShell";
import { CrateArt } from "./CrateArt";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, resultFloat } from "../../lib/fair";
import { formatSC } from "../../lib/format";
import { CASES, caseEv, rollPrize, type CaseDef, type CasePrize, type Rarity } from "../../lib/cases";
import { gsap, useGSAP } from "../../lib/motion";

const ITEM_W = 130;

function rarityClass(r: Rarity): string {
  return `reel-item r-${r}`;
}

function Reel({ items, x }: { items: CasePrize[]; x: number }) {
  return (
    <div className="reel-window">
      <div className="reel-center" />
      <motion.div
        className="reel-strip"
        animate={{ x }}
        transition={{ duration: 4.2, ease: [0.12, 0.82, 0.02, 1] }}
      >
        {items.map((p, i) => (
          <div key={`${p.id}-${i}`} className={rarityClass(p.rarity)}>
            <div>{p.label}</div>
            <div>{formatSC(p.amount)}</div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

export function CasesGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const [open, setOpen] = useState<CaseDef | null>(null);
  const [busy, setBusy] = useState(false);
  const [strip, setStrip] = useState<CasePrize[]>([]);
  const [x, setX] = useState(0);
  const [landed, setLanded] = useState<CasePrize | null>(null);
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [bet, setBet] = useState(10);
  const grid = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".case-card", {
          opacity: 0,
          y: 16,
          duration: 0.45,
          stagger: 0.07,
          ease: "power2.out",
          clearProps: "transform",
        });
      });
      return () => mm.revert();
    },
    { scope: grid },
  );

  const evPct = useMemo(() => (open ? (caseEv(open) / open.price) * 100 : 0), [open]);

  async function unbox(def: CaseDef) {
    if (busy) return;
    if (balance + 1e-9 < def.price) {
      push("Insufficient balance", "error");
      return;
    }
    setBusy(true);
    setLanded(null);
    const commit = await commitRound();
    const paid = await debit(def.price, { game: "cases", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const f = await resultFloat(commit.serverSeed, commit.clientSeed, commit.nonce);
    bumpNonce(1);
    const prize = rollPrize(def, f);
    const base: CasePrize[] = [];
    for (let r = 0; r < 28; r++) {
      for (const p of def.prizes) base.push(p);
    }
    const winIndex = 22 * def.prizes.length + def.prizes.findIndex((p) => p.id === prize.id);
    setStrip(base);
    setX(0);
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setNonce(commit.nonce);
    setSeed(undefined);
    requestAnimationFrame(() => {
      const windowW = Math.min(860, window.innerWidth - 80);
      const offset = windowW / 2 - ITEM_W / 2 - winIndex * ITEM_W;
      setX(offset);
    });
    await new Promise((r) => setTimeout(r, 4400));
    setLanded(prize);
    setSeed(commit.serverSeed);
    setLast(`${def.name} → ${prize.label} ${formatSC(prize.amount)}`);
    push(`Unboxed ${formatSC(prize.amount)}`, prize.amount >= def.price ? "win" : "lose");
    await credit(prize.amount, {
      roundId: paid.roundId,
      payout: prize.amount,
      serverSeed: commit.serverSeed,
      result: { caseId: def.id, prize: prize.label, amount: prize.amount },
    });
    setBusy(false);
  }

  return (
    <GameShell
      title="Cases"
      rules="Six crates, six price points. Pay the tag, spin the reel, keep the prize. Expected return sits just under 97%."
      bet={open?.price ?? bet}
      onBet={setBet}
      busy={busy}
      lastResult={last}
      hash={hash}
      revealedSeed={seed}
      nonce={nonce}
      extraControls={
        open ? (
          <button type="button" className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void unbox(open)}>
            Open crate · {formatSC(open.price)}
          </button>
        ) : (
          <p className="fair-box">Pick a crate on the floor, then open it.</p>
        )
      }
    >
      <div ref={grid} className="case-grid">
        {CASES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="case-card gold-edge"
            aria-label={`Select ${c.name} crate`}
            onClick={() => {
              setOpen(c);
              setBet(c.price);
              setLanded(null);
              setStrip([]);
            }}
            style={{ borderColor: c.accent + "55" }}
          >
            <CrateArt id={c.id} />
            <div style={{ color: c.accent, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {formatSC(c.price)}
            </div>
            <h3>{c.name}</h3>
            <p>{c.tagline}</p>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal gold-edge" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div>
                  <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 28, textTransform: "none", letterSpacing: "-0.03em", color: "#f4efe4" }}>
                    {open.name}
                  </h2>
                  <p className="lede" style={{ marginBottom: 8 }}>
                    {open.tagline} · RTP {evPct.toFixed(1)}%
                  </p>
                </div>
                <button className="btn btn-ghost" type="button" aria-label="Close crate" onClick={() => !busy && setOpen(null)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              {strip.length > 0 ? (
                <Reel items={strip} x={x} />
              ) : (
                <div className="crate-preview">
                  <CrateArt id={open.id} large />
                </div>
              )}
              {landed ? (
                <p style={{ textAlign: "center", margin: "14px 0", color: "var(--gold-2)", fontFamily: "Syne, sans-serif", fontSize: 24 }}>
                  {landed.label} · {formatSC(landed.amount)}
                </p>
              ) : null}
              <div className="case-grid" style={{ marginTop: 16 }}>
                {open.prizes.map((p) => (
                  <div key={p.id} className={rarityClass(p.rarity)} style={{ height: 88, width: "auto" }}>
                    <div>{p.label}</div>
                    <div>{formatSC(p.amount)}</div>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-gold"
                style={{ width: "100%", marginTop: 16 }}
                disabled={busy}
                type="button"
                onClick={() => void unbox(open)}
              >
                Open crate · {formatSC(open.price)}
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </GameShell>
  );
}
