import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GameShell } from "./GameShell";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, pickUniqueIndices } from "../../lib/fair";
import { formatMulti, formatSC } from "../../lib/format";
import { minesMultiplier } from "../../lib/games";
import { gsap, useGSAP } from "../../lib/motion";

type Cell = "hidden" | "gem" | "mine" | "idle-mine";

export function MinesGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const [bet, setBet] = useState(10);
  const [mines, setMines] = useState(3);
  const [size, setSize] = useState(5);
  const total = size * size;
  const mineCount = Math.min(mines, total - 1);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cells, setCells] = useState<Cell[]>(() => Array(total).fill("hidden"));
  const [mineSet, setMineSet] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(0);
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [roundId, setRoundId] = useState<string>();
  const [serverSeed, setServerSeed] = useState<string>();
  const stage = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const wraps = gsap.utils.toArray<HTMLElement>(".mine-tile-wrap");
        const cleanups: Array<() => void> = [];
        wraps.forEach((el) => {
          const enter = () => {
            gsap.to(el, { y: -6, scale: 1.04, duration: 0.18, ease: "power2.out" });
          };
          const leave = () => {
            gsap.to(el, { y: 0, scale: 1, duration: 0.18, ease: "power2.out" });
          };
          el.addEventListener("pointerenter", enter);
          el.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            el.removeEventListener("pointerenter", enter);
            el.removeEventListener("pointerleave", leave);
            gsap.set(el, { clearProps: "transform" });
          });
        });
        return () => cleanups.forEach((fn) => fn());
      });
      return () => mm.revert();
    },
    { scope: stage, dependencies: [size, live] },
  );

  const multi = useMemo(() => minesMultiplier(total, mineCount, revealed), [total, mineCount, revealed]);

  async function start() {
    if (live || busy) return;
    if (balance + 1e-9 < bet) {
      push("Insufficient balance", "error");
      return;
    }
    setBusy(true);
    const commit = await commitRound();
    const paid = await debit(bet, { game: "mines", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const spots = await pickUniqueIndices(commit.serverSeed, commit.clientSeed, commit.nonce, mineCount, total);
    bumpNonce(mineCount + 4);
    setMineSet(new Set(spots));
    setCells(Array(total).fill("hidden"));
    setRevealed(0);
    setLive(true);
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setSeed(undefined);
    setServerSeed(commit.serverSeed);
    setNonce(commit.nonce);
    setRoundId(paid.roundId);
    setBusy(false);
  }

  async function reveal(i: number) {
    if (!live || busy || cells[i] !== "hidden") return;
    if (mineSet.has(i)) {
      const next = cells.map((c, idx) => (mineSet.has(idx) ? "mine" : c === "gem" ? "gem" : "hidden"));
      setCells(next);
      setLive(false);
      setSeed(serverSeed);
      setLast("Boom — lost " + formatSC(bet));
      push("Hit a mine", "lose");
      if (roundId) await credit(0, { roundId, payout: 0, serverSeed, result: { mines, hit: i } });
      return;
    }
    const nextRevealed = revealed + 1;
    const nextCells = cells.slice();
    nextCells[i] = "gem";
    setCells(nextCells);
    setRevealed(nextRevealed);
    const maxSafe = total - mineCount;
    if (nextRevealed >= maxSafe) {
      await cashOut(nextRevealed, nextCells);
    }
  }

  async function cashOut(rev = revealed, grid = cells) {
    if (!live) return;
    const m = minesMultiplier(total, mineCount, rev);
    const payout = Math.round(bet * m * 100) / 100;
    const next = grid.map((c, idx) => (c === "gem" ? "gem" : mineSet.has(idx) ? "idle-mine" : "hidden"));
    setCells(next);
    setLive(false);
    setSeed(serverSeed);
    setLast(`Cashed ${formatMulti(m)} · ${formatSC(payout)}`);
    push(`Cashed out ${formatSC(payout)}`, "win");
    await credit(payout, { roundId, payout, serverSeed, result: { mines, revealed: rev, multi: m } });
  }

  return (
    <GameShell
      title="Mines"
      rules="25 tiles. Pick gems, dodge mines. Multiplier climbs with every gem — cash out before it blows."
      bet={bet}
      onBet={setBet}
      busy={busy || live}
      lastResult={last}
      hash={hash}
      revealedSeed={seed}
      nonce={nonce}
      extraControls={
        <>
          <div className="field">
            <label htmlFor="mines-count">Mines</label>
            <input
              id="mines-count"
              type="number"
              min={1}
              max={10}
              value={mines}
              disabled={live}
              onChange={(e) => setMines(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="chip-row">
            {[3, 5].map((s) => (
              <button type="button" key={s} className={`chip ${size === s ? "on" : ""}`} disabled={live} aria-label={`Set grid to ${s} by ${s}`} onClick={() => {
                setSize(s);
                setCells(Array(s * s).fill("hidden"));
              }}>
                {s}×{s}
              </button>
            ))}
          </div>
          {!live ? (
            <button type="button" className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void start()}>
              Bet {formatSC(bet)}
            </button>
          ) : (
            <button type="button" className="btn btn-emerald" style={{ width: "100%" }} disabled={revealed === 0} onClick={() => void cashOut()}>
              Cash out {formatMulti(multi)} · {formatSC(bet * multi)}
            </button>
          )}
        </>
      }
    >
      <div ref={stage} className="panel game-canvas mines-stage gold-edge">
        <div className="stat">
          <span>Multiplier</span>
          <b className="win">{formatMulti(multi)}</b>
        </div>
        <div
          className="mines-grid"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, marginTop: 16 }}
        >
          {cells.map((c, i) => (
            <div key={`${size}-${i}`} className="mine-tile-wrap">
              <motion.button
                type="button"
                className={`mine-tile ${c === "gem" ? "gem" : c === "mine" || c === "idle-mine" ? "bomb" : ""}`}
                onClick={() => void reveal(i)}
                disabled={!live || c !== "hidden"}
                aria-label={`Tile ${i + 1}${c === "gem" ? ", gem" : c === "mine" || c === "idle-mine" ? ", mine" : ", sealed"}`}
                animate={{ rotateY: c === "hidden" ? 0 : 180 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                whileTap={{ scale: 0.97 }}
              >
                <div className="mine-face mine-front" aria-hidden="true">
                  <span className="tile-stamp">
                    <span>LC</span>
                  </span>
                </div>
                <motion.div
                  className="mine-face mine-back"
                  aria-hidden="true"
                  animate={c === "mine" ? { scale: [1, 1.25, 1], boxShadow: ["0 0 0 #ff4d6a", "0 0 40px #ff4d6a", "0 0 0 #ff4d6a"] } : { scale: 1 }}
                >
                  {c === "hidden" ? null : c === "gem" ? <span className="gem-icon" /> : <span className="mine-icon" />}
                </motion.div>
              </motion.button>
            </div>
          ))}
        </div>
      </div>
    </GameShell>
  );
}
