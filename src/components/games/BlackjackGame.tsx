import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GameShell } from "./GameShell";
import { useWallet } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { bumpNonce, commitRound, resultFloat } from "../../lib/fair";
import { formatSC } from "../../lib/format";
import {
  buildShoe,
  handValue,
  suitColor,
  suitGlyph,
  type Card,
} from "../../lib/blackjack";

type Phase = "idle" | "player" | "dealer" | "done";

const IDLE_SLOTS = [0, 1] as const;

function CardView({ card, hidden, i }: { card: Card; hidden?: boolean; i: number }) {
  if (hidden) {
    return (
      <motion.div
        className="playing-card back"
        initial={{ y: -80, opacity: 0, rotate: -8 }}
        animate={{ y: 0, opacity: 1, rotate: 0 }}
        transition={{ delay: i * 0.12 }}
      >
        <span className="card-back-mark" aria-hidden="true">LC</span>
      </motion.div>
    );
  }
  return (
    <motion.div
      className={`playing-card ${suitColor(card.suit)}`}
      initial={{ y: -80, opacity: 0, rotate: -8 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ delay: i * 0.12, type: "spring", stiffness: 260, damping: 22 }}
    >
      <div className="rank">{card.rank}</div>
      <div className="suit">{suitGlyph(card.suit)}</div>
    </motion.div>
  );
}

function IdleBacks() {
  return (
    <>
      {IDLE_SLOTS.map((i) => (
        <div key={i} className={`playing-card back idle-back i${i}`} aria-hidden="true">
          <span className="card-back-mark">LC</span>
        </div>
      ))}
    </>
  );
}

export function BlackjackGame() {
  const { debit, credit, balance } = useWallet();
  const { push } = useToast();
  const [bet, setBet] = useState(25);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [player, setPlayer] = useState<Card[]>([]);
  const [dealer, setDealer] = useState<Card[]>([]);
  const [hideHole, setHideHole] = useState(true);
  const [hash, setHash] = useState<string>();
  const [seed, setSeed] = useState<string>();
  const [nonce, setNonce] = useState<number>();
  const [last, setLast] = useState<string>();
  const [stake, setStake] = useState(0);
  const [roundId, setRoundId] = useState<string>();
  const [serverSeed, setServerSeed] = useState<string>();
  const shoe = useRef<Card[]>([]);
  const doubled = useRef(false);

  async function ensureShoe(commitSeed: string, clientSeed: string, nonce0: number) {
    if (shoe.current.length >= 60) return;
    const floats: number[] = [];
    for (let i = 0; i < 320; i++) floats.push(await resultFloat(commitSeed, clientSeed, nonce0 + i));
    shoe.current = buildShoe(floats);
  }

  function draw(): Card {
    const c = shoe.current.pop();
    if (!c) throw new Error("empty shoe");
    return c;
  }

  async function deal() {
    if (busy || phase === "player") return;
    if (balance + 1e-9 < bet) {
      push("Insufficient balance", "error");
      return;
    }
    setBusy(true);
    const commit = await commitRound();
    const paid = await debit(bet, { game: "blackjack", clientSeed: commit.clientSeed, nonce: commit.nonce });
    if (!paid.ok) {
      push("Insufficient balance", "error");
      setBusy(false);
      return;
    }
    const reshuffle = shoe.current.length < 60;
    await ensureShoe(commit.serverSeed, commit.clientSeed, commit.nonce);
    bumpNonce(reshuffle ? 321 : 8);
    doubled.current = false;
    const p1 = draw();
    const d1 = draw();
    const p2 = draw();
    const d2 = draw();
    const pHand = [p1, p2];
    const dHand = [d1, d2];
    setPlayer(pHand);
    setDealer(dHand);
    setHideHole(true);
    setHash(paid.serverSeedHash ?? commit.serverSeedHash);
    setSeed(undefined);
    setServerSeed(commit.serverSeed);
    setNonce(commit.nonce);
    setRoundId(paid.roundId);
    setStake(bet);

    const pv = handValue(pHand);
    const dv = handValue(dHand);
    if (pv.blackjack || dv.blackjack) {
      setHideHole(false);
      await settle(pHand, dHand, bet, commit.serverSeed, paid.roundId);
      setBusy(false);
      return;
    }
    setPhase("player");
    setBusy(false);
  }

  async function hit() {
    if (phase !== "player" || busy) return;
    setBusy(true);
    const next = [...player, draw()];
    setPlayer(next);
    const v = handValue(next);
    if (v.bust || v.total === 21) {
      await standWith(next);
    } else {
      setBusy(false);
    }
  }

  async function doubleDown() {
    if (phase !== "player" || player.length !== 2 || busy) return;
    if (balance + 1e-9 < stake) {
      push("Insufficient balance to double", "error");
      return;
    }
    setBusy(true);
    const paid = await debit(stake, { game: "blackjack-double" });
    if (!paid.ok) {
      push("Insufficient balance to double", "error");
      setBusy(false);
      return;
    }
    doubled.current = true;
    const nextStake = stake * 2;
    setStake(nextStake);
    const next = [...player, draw()];
    setPlayer(next);
    await standWith(next, nextStake);
  }

  async function stand() {
    if (phase !== "player" || busy) return;
    setBusy(true);
    await standWith(player);
  }

  async function standWith(pHand: Card[], money = stake) {
    setPhase("dealer");
    setHideHole(false);
    let dHand = dealer.slice();
    await new Promise((r) => setTimeout(r, 420));
    while (handValue(dHand).total < 17) {
      dHand = [...dHand, draw()];
      setDealer(dHand);
      await new Promise((r) => setTimeout(r, 380));
    }
    await settle(pHand, dHand, money, serverSeed, roundId);
    setBusy(false);
  }

  async function settle(pHand: Card[], dHand: Card[], money: number, sSeed?: string, rid?: string) {
    const pv = handValue(pHand);
    const dv = handValue(dHand);
    let payout = 0;
    let msg: string;
    if (pv.blackjack && !dv.blackjack) {
      payout = Math.round(money * 2.5 * 100) / 100;
      msg = `Blackjack ${formatSC(payout)}`;
    } else if (dv.blackjack && !pv.blackjack) {
      payout = 0;
      msg = "Dealer blackjack";
    } else if (pv.bust) {
      payout = 0;
      msg = `Bust ${pv.total}`;
    } else if (dv.bust) {
      payout = money * 2;
      msg = `Dealer bust — ${formatSC(payout)}`;
    } else if (pv.total > dv.total) {
      payout = money * 2;
      msg = `${pv.total} beats ${dv.total}`;
    } else if (pv.total < dv.total) {
      payout = 0;
      msg = `${pv.total} loses to ${dv.total}`;
    } else {
      payout = money;
      msg = `Push ${pv.total}`;
    }
    setLast(msg);
    setPhase("done");
    setSeed(sSeed);
    push(msg, payout > money ? "win" : payout === money ? "info" : "lose");
    await credit(payout, {
      roundId: rid,
      payout,
      serverSeed: sSeed,
      result: { player: pv.total, dealer: dv.total, payout },
    });
  }

  const pv = handValue(player);
  const dv = handValue(hideHole ? dealer.slice(0, 1) : dealer);

  return (
    <GameShell
      title="Blackjack"
      rules="Six-deck shoe. Dealer stands on all 17s. Blackjack pays 3:2. Double on your first two cards. Push returns the stake."
      bet={bet}
      onBet={setBet}
      busy={busy || phase === "player"}
      lastResult={last}
      hash={hash}
      revealedSeed={seed}
      nonce={nonce}
      extraControls={
        <>
          {phase !== "player" ? (
            <button className="btn btn-gold" style={{ width: "100%" }} disabled={busy} onClick={() => void deal()}>
              Deal {formatSC(bet)}
            </button>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <button className="btn btn-gold" disabled={busy} onClick={() => void hit()}>
                Hit
              </button>
              <button className="btn" disabled={busy} onClick={() => void stand()}>
                Stand
              </button>
              <button className="btn btn-emerald" disabled={busy || player.length !== 2} onClick={() => void doubleDown()}>
                Double
              </button>
            </div>
          )}
        </>
      }
    >
      <div className="felt gold-edge">
        <p style={{ textAlign: "center", color: "#9a9488", marginBottom: 8 }}>
          Dealer {dealer.length ? (hideHole ? `${dv.total}+` : dv.total) : "waiting"}
        </p>
        <div className="hand">
          {dealer.length === 0 ? (
            <IdleBacks />
          ) : (
            <AnimatePresence>
              {dealer.map((c, i) => (
                <CardView key={c.id} card={c} hidden={hideHole && i === 1} i={i} />
              ))}
            </AnimatePresence>
          )}
        </div>
        <p style={{ textAlign: "center", margin: "28px 0 8px", fontFamily: "var(--font-display)", letterSpacing: "0.2em" }}>
          {phase === "player" ? "YOUR PLAY" : phase === "dealer" ? "DEALER" : phase === "idle" ? "DEAL TO START" : "LottaCash"}
        </p>
        <div className="hand">
          {player.length === 0 ? (
            <IdleBacks />
          ) : (
            <AnimatePresence>
              {player.map((c, i) => (
                <CardView key={c.id} card={c} i={i} />
              ))}
            </AnimatePresence>
          )}
        </div>
        <p style={{ textAlign: "center", color: "var(--brass-2)", marginTop: 10 }}>
          {player.length ? `${pv.total}${pv.soft ? " soft" : ""}${pv.blackjack ? " blackjack" : ""}` : "Place a bet, then deal"}
        </p>
      </div>
    </GameShell>
  );
}
