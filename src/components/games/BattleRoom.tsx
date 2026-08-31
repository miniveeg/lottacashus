import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  battleCase,
  fillBots,
  getBattle,
  housePot,
  saveBattle,
  type Battle,
} from "../../lib/battles";
import { rollPrize, type CasePrize, type Rarity } from "../../lib/cases";
import { bumpNonce, commitRound, resultFloat } from "../../lib/fair";
import { formatSC } from "../../lib/format";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";

const ITEM_W = 130;

function rarityClass(r: Rarity): string {
  return `reel-item r-${r}`;
}

export function BattleRoom() {
  const { id } = useParams();
  const { credit } = useWallet();
  const { push } = useToast();
  const [battle, setBattle] = useState<Battle | undefined>(() => (id ? getBattle(id) : undefined));
  const [strips, setStrips] = useState<Record<string, CasePrize[]>>({});
  const [xs, setXs] = useState<Record<string, number>>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const def = useMemo(() => (battle ? battleCase(battle) : undefined), [battle]);

  useEffect(() => {
    if (!id) return;
    const b = getBattle(id);
    setBattle(b);
    if (!b || b.status === "done") return;
    const t = window.setTimeout(() => {
      const next = fillBots({ ...b });
      next.status = "running";
      saveBattle(next);
      setBattle({ ...next });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [id]);

  useEffect(() => {
    if (!battle || battle.status !== "running" || running || battle.history.length > 0) return;
    void playAll(battle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.status]);

  async function playAll(start: Battle) {
    if (!def) return;
    setRunning(true);
    const commit = await commitRound();
    let nonce = commit.nonce;
    const current: Battle = {
      ...start,
      players: start.players.map((p) => ({ ...p, totals: [], prizeTotal: 0 })),
      history: [],
    };

    for (let round = 0; round < current.rounds; round++) {
      const results: { seatId: string; amount: number; prizeLabel: string }[] = [];
      const nextStrips: Record<string, CasePrize[]> = {};
      const nextXs: Record<string, number> = {};

      for (const p of current.players) {
        const f = await resultFloat(commit.serverSeed, commit.clientSeed, nonce++);
        const prize = rollPrize(def, f);
        const base: CasePrize[] = [];
        for (let r = 0; r < 24; r++) for (const it of def.prizes) base.push(it);
        const winIndex = 18 * def.prizes.length + def.prizes.findIndex((x) => x.id === prize.id);
        nextStrips[p.id] = base;
        nextXs[p.id] = 0;
        results.push({ seatId: p.id, amount: prize.amount, prizeLabel: prize.label });
        p.totals.push(prize.amount);
        p.prizeTotal += prize.amount;
        const windowW = 280;
        requestAnimationFrame(() => {
          setXs((old) => ({ ...old, [p.id]: windowW / 2 - ITEM_W / 2 - winIndex * ITEM_W }));
        });
        void nextXs;
      }
      setStrips((s) => ({ ...s, ...nextStrips }));
      current.history.push({ caseId: def.id, results });
      await new Promise((r) => setTimeout(r, 3200));
      setBattle({ ...current, players: current.players.map((p) => ({ ...p })) });
    }

    bumpNonce(nonce - commit.nonce);
    current.players.sort((a, b) => b.prizeTotal - a.prizeTotal);
    const top = current.players[0]!;
    current.winnerId = top.id;
    current.status = "done";
    current.pot = housePot(def.price, current.seats, current.rounds);
    saveBattle(current);
    setBattle({ ...current });
    setWinner(top.id);
    if (top.id === "you") {
      await credit(current.pot, { payout: current.pot, serverSeed: commit.serverSeed, result: { battle: current.id } });
      push(`You won the battle — ${formatSC(current.pot)}`, "win");
    } else {
      push(`${top.name} took the pot`, "lose");
    }
    setRunning(false);
  }

  if (!battle || !def) {
    return (
      <div className="game-page">
        <h1>Battle missing</h1>
        <p className="lede">That room is gone. Head back to the lobby.</p>
        <Link to="/battles" className="btn btn-gold">
          Battles
        </Link>
      </div>
    );
  }

  const cols = battle.seats;

  return (
    <div className="game-page">
      <h1>{def.name} battle</h1>
      <p className="lede">
        {battle.seats} players · {battle.rounds} round{battle.rounds > 1 ? "s" : ""} · pot {formatSC(battle.pot)} · {battle.status}
      </p>
      <div className="seat-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => {
          const p = battle.players[i];
          return (
            <div key={i} className="panel">
              <h2>{p ? p.name : "Waiting…"}</h2>
              {p && (
                <>
                  <div className="reel-window" style={{ height: 120 }}>
                    <div className="reel-center" />
                    <motion.div
                      className="reel-strip"
                      animate={{ x: xs[p.id] ?? 0 }}
                      transition={{ duration: 2.8, ease: [0.12, 0.82, 0.02, 1] }}
                    >
                      {(strips[p.id] ?? def.prizes).map((it, k) => (
                        <div key={`${it.id}-${k}`} className={rarityClass(it.rarity)} style={{ width: 110, height: 96 }}>
                          <div>{it.label}</div>
                          <div>{formatSC(it.amount)}</div>
                        </div>
                      ))}
                    </motion.div>
                  </div>
                  <div className="stat">
                    <span>Total</span>
                    <b>{formatSC(p.prizeTotal)}</b>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {winner && (
          <motion.div className="winner-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" initial={{ scale: 0.9 }} animate={{ scale: 1 }} style={{ textAlign: "center" }}>
              <h1>{winner === "you" ? "You take the pot" : `${battle.players.find((p) => p.id === winner)?.name} wins`}</h1>
              <p className="lede">{formatSC(battle.pot)}</p>
              <Link to="/battles" className="btn btn-gold">
                Back to lobby
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
