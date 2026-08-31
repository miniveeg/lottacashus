import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GameShell } from "./GameShell";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, resultFloat } from "../../lib/fair";
import { formatSC } from "../../lib/format";
import {
  ROULETTE_ORDER,
  roulettePayout,
  wheelColor,
  type RouletteBet,
  type RouletteBetKind,
} from "../../lib/games";

const STEP = 360 / 37;

export function RouletteGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const [bet, setBet] = useState(10);
  const [kind, setKind] = useState<RouletteBetKind>("red");
  const [number, setNumber] = useState(17);
  const [dozen, setDozen] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [history, setHistory] = useState<number[]>([0, 32, 15, 19, 4]);
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [pocket, setPocket] = useState<number | null>(null);

  const currentBet: RouletteBet = useMemo(
    () => ({ kind, amount: bet, number, dozen }),
    [kind, bet, number, dozen],
  );

  async function spin() {
    if (busy) return;
    if (balance + 1e-9 < bet) {
      push("Insufficient balance", "error");
      return;
    }
    setBusy(true);
    const commit = await commitRound();
    const paid = await debit(bet, { game: "roulette", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const f = await resultFloat(commit.serverSeed, commit.clientSeed, commit.nonce);
    bumpNonce(1);
    const idx = Math.min(36, Math.floor(f * 37));
    const winNum = ROULETTE_ORDER[idx]!;
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setNonce(commit.nonce);
    setSeed(undefined);
    setPocket(null);

    const extra = 360 * 6;
    const target = extra + (360 - (idx * STEP + STEP / 2));
    setRotation((r) => r - (r % 360) + target);

    await new Promise((r) => setTimeout(r, 3800));
    setPocket(winNum);
    setSeed(commit.serverSeed);
    setHistory((h) => [winNum, ...h].slice(0, 16));
    const payout = roulettePayout(currentBet, winNum);
    const won = payout > 0;
    setLast(`${winNum} ${wheelColor(winNum)} · ${won ? formatSC(payout) : "lost"}`);
    push(
      won ? `Pocket ${winNum} — ${formatSC(payout)}` : `Pocket ${winNum}. No hit.`,
      won ? "win" : "lose",
    );
    await credit(payout, {
      roundId: paid.roundId,
      payout,
      serverSeed: commit.serverSeed,
      result: { pocket: winNum, kind, number, dozen },
    });
    setBusy(false);
  }

  return (
    <GameShell
      title="Roulette"
      rules="European wheel, 0–36. Number pays 35:1, even-money 1:1, dozens 2:1. One wager per spin. House 2.70%."
      bet={bet}
      onBet={setBet}
      busy={busy}
      lastResult={last}
      hash={hash}
      revealedSeed={seed}
      nonce={nonce}
      extraControls={
        <>
          <div className="chip-row">
            {(["red", "black", "odd", "even", "low", "high", "dozen", "number"] as RouletteBetKind[]).map((k) => (
              <button type="button" key={k} className={`chip ${kind === k ? "on" : ""}`} disabled={busy} aria-label={`Bet ${k}`} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
          {kind === "dozen" && (
            <div className="chip-row">
              {([1, 2, 3] as const).map((d) => (
                <button type="button" key={d} className={`chip ${dozen === d ? "on" : ""}`} disabled={busy} aria-label={`Dozen ${d}`} onClick={() => setDozen(d)}>
                  {d === 1 ? "1–12" : d === 2 ? "13–24" : "25–36"}
                </button>
              ))}
            </div>
          )}
          {kind === "number" && (
            <div className="field">
              <label htmlFor="straight-up">Straight up</label>
              <input
                id="straight-up"
                type="number"
                min={0}
                max={36}
                value={number}
                disabled={busy}
                onChange={(e) => setNumber(Math.min(36, Math.max(0, Number(e.target.value) || 0)))}
              />
            </div>
          )}
          <button type="button" className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void spin()}>
            Spin
          </button>
        </>
      }
    >
      <div className="panel">
        <div className="history-strip">
          {history.map((n, i) => (
            <div key={`${n}-${i}`} className={`pocket ${wheelColor(n)}`}>
              {n}
            </div>
          ))}
        </div>
        <div className="wheel-wrap">
          <motion.svg
            width={360}
            height={360}
            viewBox="-110 -110 220 220"
            animate={{ rotate: rotation }}
            transition={{ duration: 3.6, ease: [0.12, 0.7, 0.16, 1] }}
          >
            {ROULETTE_ORDER.map((n, i) => {
              const a0 = ((i * STEP - 90) * Math.PI) / 180;
              const a1 = (((i + 1) * STEP - 90) * Math.PI) / 180;
              const x0 = Math.cos(a0) * 100;
              const y0 = Math.sin(a0) * 100;
              const x1 = Math.cos(a1) * 100;
              const y1 = Math.sin(a1) * 100;
              const tx = Math.cos((a0 + a1) / 2) * 72;
              const ty = Math.sin((a0 + a1) / 2) * 72;
              const col = wheelColor(n);
              const fill = col === "green" ? "#164a3c" : col === "red" ? "#8a2430" : "#16110c";
              return (
                <g key={n}>
                  <path d={`M 0 0 L ${x0} ${y0} A 100 100 0 0 1 ${x1} ${y1} Z`} fill={fill} stroke="#c9a24a" strokeWidth="0.4" />
                  <text
                    x={tx}
                    y={ty}
                    fill="#f4efe4"
                    fontSize="7"
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${i * STEP + STEP / 2} ${tx} ${ty})`}
                  >
                    {n}
                  </text>
                </g>
              );
            })}
            <circle r="28" fill="#071910" stroke="#c9a24a" strokeWidth="2" />
            <text textAnchor="middle" y="4" fill="#c9a24a" fontSize="10" fontFamily="Fraunces, serif" fontWeight="700">
              LC
            </text>
          </motion.svg>
          <div
            style={{
              position: "absolute",
              top: 8,
              width: 0,
              height: 0,
              borderLeft: "8px solid transparent",
              borderRight: "8px solid transparent",
              borderTop: "14px solid #c9a24a",
            }}
          />
        </div>
        {pocket !== null && (
          <div className="stat" style={{ justifyContent: "center", border: 0, fontSize: 18 }}>
            <b className={wheelColor(pocket) === "red" ? "loss" : wheelColor(pocket) === "green" ? "win" : ""}>
              {pocket} {wheelColor(pocket)}
            </b>
          </div>
        )}
        <div className="num-grid" style={{ marginTop: 12 }}>
          {Array.from({ length: 37 }, (_, n) => (
            <button
              key={n}
              type="button"
              className={`num-cell pocket ${wheelColor(n)} ${kind === "number" && number === n ? "on" : ""}`}
              disabled={busy}
              aria-label={`Straight up ${n}`}
              onClick={() => {
                setKind("number");
                setNumber(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </GameShell>
  );
}
