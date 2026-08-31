import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CASES } from "../../lib/cases";
import { createBattle, housePot, listBattles } from "../../lib/battles";
import { formatSC } from "../../lib/format";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";

export function BattlesLobby() {
  const nav = useNavigate();
  const { debit, balance } = useWallet();
  const { push } = useToast();
  const [caseId, setCaseId] = useState(CASES[0]!.id);
  const [seats, setSeats] = useState<2 | 4>(2);
  const [rounds, setRounds] = useState<1 | 2 | 3>(1);
  const [list, setList] = useState(() => listBattles());
  const def = useMemo(() => CASES.find((c) => c.id === caseId) ?? CASES[0]!, [caseId]);
  const cost = def.price * rounds;

  async function create() {
    if (balance + 1e-9 < cost) {
      push("Insufficient balance", "error");
      return;
    }
    const paid = await debit(cost, { game: "battles" });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      return;
    }
    const b = createBattle({ caseId: def.id, seats, rounds, hostName: "You" });
    setList(listBattles());
    nav(`/battles/${b.id}`);
  }

  return (
    <div className="game-page">
      <h1>Case Battles</h1>
      <p className="lede">
        Same crate, same rounds, highest unbox total takes the pot (2% house). Empty seats fill with bots in 1.5s so you can always play solo.
      </p>
      <div className="game-layout">
        <div className="panel">
          <h2>Open battles</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {list.map((b) => {
              const c = CASES.find((x) => x.id === b.caseId);
              return (
                <Link key={b.id} to={`/battles/${b.id}`} className="case-card" style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <b>{c?.name ?? b.caseId}</b>
                    <span className="demo-badge">{b.status}</span>
                  </div>
                  <p>
                    {b.players.length}/{b.seats} seats · {b.rounds} round{b.rounds > 1 ? "s" : ""} · pot {formatSC(b.pot)}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
        <aside className="panel">
          <h2>Create battle</h2>
          <div className="field">
            <label htmlFor="battle-case">Case</label>
            <select id="battle-case" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              {CASES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatSC(c.price)}
                </option>
              ))}
            </select>
          </div>
          <div className="chip-row">
            {([2, 4] as const).map((n) => (
              <button type="button" key={n} className={`chip ${seats === n ? "on" : ""}`} aria-label={`${n} players`} onClick={() => setSeats(n)}>
                {n} players
              </button>
            ))}
          </div>
          <div className="chip-row">
            {([1, 2, 3] as const).map((n) => (
              <button type="button" key={n} className={`chip ${rounds === n ? "on" : ""}`} aria-label={`${n} round${n > 1 ? "s" : ""}`} onClick={() => setRounds(n)}>
                {n} round{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
          <div className="stat">
            <span>Your buy-in</span>
            <b>{formatSC(cost)}</b>
          </div>
          <div className="stat">
            <span>Winner pot</span>
            <b>{formatSC(housePot(def.price, seats, rounds))}</b>
          </div>
          <motion.button type="button" className="btn btn-gold" style={{ width: "100%" }} whileTap={{ scale: 0.97 }} onClick={() => void create()}>
            Create battle
          </motion.button>
        </aside>
      </div>
    </div>
  );
}
