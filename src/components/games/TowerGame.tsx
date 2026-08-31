import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "./GameShell";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, pickUniqueIndices } from "../../lib/fair";
import { formatMulti, formatSC } from "../../lib/format";
import { towerMultiplier } from "../../lib/games";
import { gsap, useGSAP } from "../../lib/motion";

type Diff = "easy" | "medium" | "hard";
const DIFF: Record<Diff, { tiles: number; bombs: number }> = {
  easy: { tiles: 4, bombs: 1 },
  medium: { tiles: 3, bombs: 1 },
  hard: { tiles: 2, bombs: 1 },
};
const FLOORS = 8;
const RAIN = Array.from({ length: 18 }, (_, i) => i);
const DIFF_KEYS = Object.keys(DIFF) as Diff[];

type TileState = "idle" | "safe" | "bomb" | "hidden-bomb";

export function TowerGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const [bet, setBet] = useState(10);
  const [diff, setDiff] = useState<Diff>("easy");
  const cfg = DIFF[diff];
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [floor, setFloor] = useState(0);
  const [bombs, setBombs] = useState<number[]>([]);
  const [tiles, setTiles] = useState<TileState[][]>(() => Array.from({ length: FLOORS }, () => Array(cfg.tiles).fill("idle")));
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [serverSeed, setServerSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [roundId, setRoundId] = useState<string>();
  const [rain, setRain] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          ".tower-floor-row",
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: "power2.out", clearProps: "all" },
        );
      });
      return () => mm.revert();
    },
    { scope: stage, dependencies: [diff] },
  );

  const multi = useMemo(() => towerMultiplier(cfg.tiles, cfg.bombs, floor), [cfg, floor]);

  async function start() {
    if (live || busy) return;
    if (balance + 1e-9 < bet) {
      push("Insufficient balance", "error");
      return;
    }
    setBusy(true);
    const commit = await commitRound();
    const paid = await debit(bet, { game: "tower", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const spots: number[] = [];
    for (let f = 0; f < FLOORS; f++) {
      const picked = await pickUniqueIndices(commit.serverSeed, commit.clientSeed, commit.nonce + f, cfg.bombs, cfg.tiles);
      spots.push(picked[0] ?? 0);
    }
    bumpNonce(FLOORS + 2);
    setBombs(spots);
    setTiles(Array.from({ length: FLOORS }, () => Array(cfg.tiles).fill("idle")));
    setFloor(0);
    setLive(true);
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setSeed(undefined);
    setServerSeed(commit.serverSeed);
    setNonce(commit.nonce);
    setRoundId(paid.roundId);
    setRain(false);
    setBusy(false);
  }

  async function pick(f: number, t: number) {
    if (!live || f !== floor || busy) return;
    const next = tiles.map((row) => row.slice());
    if (bombs[f] === t) {
      next[f]![t] = "bomb";
      for (let i = 0; i < cfg.tiles; i++) {
        if (i !== t && bombs[f] === i) next[f]![i] = "bomb";
        else if (i !== t) next[f]![i] = bombs[f] === i ? "bomb" : next[f]![i]!;
      }
      next[f]![bombs[f]!] = "bomb";
      setTiles(next);
      setLive(false);
      setSeed(serverSeed);
      setLast("Collapsed — lost " + formatSC(bet));
      push("Bomb. Tower falls.", "lose");
      if (roundId) await credit(0, { roundId, payout: 0, serverSeed, result: { floor: f, bomb: t } });
      return;
    }
    next[f]![t] = "safe";
    next[f]![bombs[f]!] = "hidden-bomb";
    setTiles(next);
    const nextFloor = f + 1;
    setFloor(nextFloor);
    if (nextFloor >= FLOORS) {
      await cash(nextFloor);
    }
  }

  async function cash(cleared = floor) {
    if (!live && cleared === floor) return;
    if (cleared <= 0) return;
    const m = towerMultiplier(cfg.tiles, cfg.bombs, cleared);
    const payout = Math.round(bet * m * 100) / 100;
    setLive(false);
    setSeed(serverSeed);
    setLast(`Summit ${formatMulti(m)} · ${formatSC(payout)}`);
    setRain(true);
    push(`Cashed out ${formatSC(payout)}`, "win");
    await credit(payout, { roundId, payout, serverSeed, result: { floors: cleared, multi: m } });
  }

  return (
    <GameShell
      title="Tower"
      rules="Climb eight floors. Each floor hides one bomb. Safe tiles raise the multiplier — cash out or greed it."
      bet={bet}
      onBet={setBet}
      busy={busy || live}
      lastResult={last}
      hash={hash}
      revealedSeed={seed}
      nonce={nonce}
      extraControls={
        <>
          <div className="chip-row">
            {DIFF_KEYS.map((d) => (
              <button type="button" key={d} className={`chip ${diff === d ? "on" : ""}`} disabled={live} aria-label={`Set ${d} difficulty`} onClick={() => {
                setDiff(d);
                setTiles(Array.from({ length: FLOORS }, () => Array(DIFF[d].tiles).fill("idle")));
              }}>
                {d} {DIFF[d].tiles}/1
              </button>
            ))}
          </div>
          {!live ? (
            <button type="button" className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void start()}>
              Climb {formatSC(bet)}
            </button>
          ) : (
            <button type="button" className="btn btn-emerald" style={{ width: "100%" }} disabled={floor === 0} onClick={() => void cash()}>
              Cash out {formatMulti(multi)} · {formatSC(bet * multi)}
            </button>
          )}
        </>
      }
    >
      <div ref={stage} className="panel game-canvas tower-stage gold-edge" style={{ position: "relative", overflow: "hidden" }}>
        <div className="stat">
          <span>Floor {Math.min(floor + 1, FLOORS)} / {FLOORS}</span>
          <b className="win">{formatMulti(multi)}</b>
        </div>
        <div className="tower-summit" aria-hidden="true">Summit</div>
        <div className="tower" style={{ marginTop: 16 }}>
          {tiles.map((row, f) => (
            <div key={f} className="tower-floor-row" style={{ opacity: live && f > floor ? 0.4 : 1 }}>
              <span className="tower-floor-label">{f + 1}</span>
              <div className="tower-floor" style={{ gridTemplateColumns: `repeat(${cfg.tiles}, 1fr)` }}>
                {row.map((st, t) => (
                  <motion.button
                    key={t}
                    type="button"
                    className={`tower-tile ${st === "safe" ? "safe" : st === "bomb" ? "bomb" : st === "hidden-bomb" ? "sealed" : "idle"}`}
                    onClick={() => void pick(f, t)}
                    disabled={!live || f !== floor}
                    aria-label={`Floor ${f + 1}, vault ${t + 1}`}
                    whileTap={{ scale: 0.97 }}
                    animate={st === "bomb" ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                    transition={{ duration: 0.4 }}
                  >
                    {st === "safe" ? (
                      <span className="gem-icon" aria-hidden="true" />
                    ) : st === "bomb" ? (
                      <span className="mine-icon" aria-hidden="true" />
                    ) : (
                      <span className="vault-plate" aria-hidden="true">
                        <span className="vault-num">F{f + 1}</span>
                      </span>
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <AnimatePresence>
          {rain ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            >
              {RAIN.map((i) => (
                <motion.span
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${6 + i * 5}%`,
                    top: -20,
                    color: "#e8c36a",
                    fontSize: 18,
                  }}
                  animate={{ y: [0, 520], opacity: [1, 0] }}
                  transition={{ duration: 1.4 + (i % 5) * 0.12, ease: "easeIn" }}
                >
                  ●
                </motion.span>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </GameShell>
  );
}
