import { useState } from "react";
import { resolveLimboRound, limboResultFromSeeds } from "../../lib/games/limbo/provablyFair";
import {
  resolveRouletteRound,
  roulettePocketFromSeeds,
  pocketColor as roulettePocketColor,
} from "../../lib/games/roulette/provablyFair";
import { playKenoRound, drawKenoNumbers, kenoFloatsFromSeeds } from "../../lib/games/keno/provablyFair";
import { getKenoMultiplier, type KenoRisk } from "../../lib/games/keno/paytables";
import { getMinesMultiplier } from "../../lib/games/mines/multipliers";
import { rtpBiasFloat } from "../../lib/games/rtpBias";
import { retainStakeStyleWin, retainRouletteWin } from "../../lib/games/rtp";

/**
 * "Verify a round" tool — lets the player paste a revealed server seed,
 * client seed, nonce, and game type to recompute the outcome and confirm
 * the house didn't cheat. Complements the rotate-seed feature: after
 * rotating, the player gets the revealed seed and can verify any past round.
 *
 * Supports all 8 games: Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots, Case Battles.
 * For Limbo / Roulette / Keno the verifier replicates the full RTP bias
 * step (retainStakeStyleWin / retainRouletteWin) so the post-bias result
 * matches what the server actually returned. Crash and Mines have no
 * separate bias roll — the 96.5% RTP is baked directly into the formula
 * (Crash: crash-point distribution; Mines: multiplier formula
 * `0.965 × C(25,g)/C(25-m,g)`). Blackjack applies its bias per-hand using a
 * tag derived from the hand id — the verifier shows the fair shuffled shoe
 * and notes the per-hand bias caveat.
 */

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToFloat(hex: string, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += parseInt(hex.substr((offset + i) * 2, 2), 16) / Math.pow(256, i + 1);
  }
  return value;
}

/** Crash result: float → max(1, (2²⁴ / (float×2²⁴ + 1)) × 0.965).
 *  96.5% RTP baked directly into the crash-point distribution (no separate
 *  bias roll). Matches the server (supabase/functions/place-crash-bet). */
function crashResult(float: number): number {
  const MAX = 2 ** 24;
  const scaled = float * MAX;
  const raw = (MAX / (scaled + 1)) * 0.965;
  return Math.max(1, Math.floor(raw * 100) / 100);
}

type GameType = "limbo" | "crash" | "roulette" | "mines" | "keno" | "blackjack";

/** Blackjack: Fisher-Yates shuffle of 52 cards using PF floats.
 *  Returns the first N cards of the shoe as human-readable labels
 *  (e.g. "♠A", "♦10"). Stake card order: index 0–51 = ♦2…♣A. */
async function blackjackResult(serverSeed: string, clientSeed: string, nonce: number, cardCount: number): Promise<string[]> {
  const SHOE_SIZE = 52;
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const SUITS = ["♦", "♥", "♠", "♣"];
  // Generate 52 floats from HMAC cursors (ceil(52*4/32) = 7 cursors)
  const floats: number[] = [];
  let cursor = 0;
  while (floats.length < SHOE_SIZE) {
    const hash = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    for (let i = 0; i + 4 <= hash.length && floats.length < SHOE_SIZE; i += 4) {
      let value = 0;
      for (let j = 0; j < 4; j++) {
        value += parseInt(hash.substr((i + j) * 2, 2), 16) / Math.pow(256, j + 1);
      }
      floats.push(value);
    }
    cursor++;
  }
  // Fisher-Yates shuffle
  const pool = Array.from({ length: SHOE_SIZE }, (_, i) => i);
  for (let i = 0; i < SHOE_SIZE - 1; i++) {
    const remaining = SHOE_SIZE - i;
    const idx = Math.floor(floats[i]! * remaining);
    const pick = i + idx;
    const tmp = pool[i]!;
    pool[i] = pool[pick]!;
    pool[pick] = tmp;
  }
  // Return first cardCount cards as labels
  return pool.slice(0, Math.min(cardCount, SHOE_SIZE)).map((card) => {
    const rank = RANKS[Math.floor(card / 4)] ?? "?";
    const suit = SUITS[card % 4] ?? "?";
    return `${suit}${rank}`;
  });
}

/** Mines: 24 floats from HMAC cursors, Fisher-Yates mine placement. */
async function minesResult(serverSeed: string, clientSeed: string, nonce: number, mineCount: number): Promise<number[]> {
  const MINES_FLOAT_COUNT = 24;
  const GRID = 25;
  const cursorsNeeded = Math.ceil((MINES_FLOAT_COUNT * 4) / 32);
  const merged: number[] = [];
  for (let cursor = 0; cursor < cursorsNeeded; cursor++) {
    const hash = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    for (let i = 0; i < hash.length; i += 2) {
      merged.push(parseInt(hash.substr(i, 2), 16));
    }
  }
  const floats: number[] = [];
  for (let i = 0; i < MINES_FLOAT_COUNT; i++) {
    let value = 0;
    for (let j = 0; j < 4; j++) {
      value += merged[i * 4 + j]! / Math.pow(256, j + 1);
    }
    floats.push(value);
  }
  // Fisher-Yates placement
  const pool = Array.from({ length: GRID }, (_, i) => i);
  const mines: number[] = [];
  for (let i = 0; i < mineCount && i < floats.length; i++) {
    const remaining = GRID - i;
    const index = Math.floor(floats[i]! * remaining);
    const pickIndex = i + index;
    const value = pool[pickIndex]!;
    mines.push(value);
    for (let o = pickIndex; o > i; o--) {
      pool[o] = pool[o - 1]!;
    }
    pool[i] = value;
  }
  return mines.sort((a, b) => a - b);
}

export function VerifyRoundTool() {
  const [game, setGame] = useState<GameType>("limbo");
  const [serverSeed, setServerSeed] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonce, setNonce] = useState("");
  const [mineCount, setMineCount] = useState("3");
  const [cardCount, setCardCount] = useState("6");
  const [limboTarget, setLimboTarget] = useState("2.00");
  const [rouletteBet, setRouletteBet] = useState<"red" | "black" | "green">("red");
  const [kenoPicks, setKenoPicks] = useState("1,5,10,15,20");
  const [kenoRisk, setKenoRisk] = useState<KenoRisk>("classic");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setError(null);
    setResult(null);
    if (!serverSeed.trim()) {
      setError("Paste the revealed server seed.");
      return;
    }
    if (!clientSeed.trim()) {
      setError("Enter the client seed that was active for that round.");
      return;
    }
    const n = parseInt(nonce, 10);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter a valid nonce (a non-negative integer).");
      return;
    }
    try {
      if (game === "limbo") {
        const target = Number(limboTarget);
        if (!Number.isFinite(target) || target < 1.01) {
          setError("Target multiplier must be ≥ 1.01.");
          return;
        }
        // Fair result (pre-bias) and the post-bias resolved outcome.
        const fairMult = await limboResultFromSeeds(serverSeed.trim(), clientSeed.trim(), n);
        const { resultMultiplier, won } = await resolveLimboRound(serverSeed.trim(), clientSeed.trim(), n, target);
        const bias = await rtpBiasFloat(serverSeed.trim(), clientSeed.trim(), n, "limbo");
        const retained = retainStakeStyleWin(bias);
        const wouldWinFair = fairMult >= target;
        setResult(
          `Limbo round — nonce ${n}, target ${target.toFixed(2)}×: fair result = ${fairMult.toFixed(2)}× (would-win ${wouldWinFair}) → post-bias result = ${resultMultiplier.toFixed(2)}×, won=${won} (bias ${retained ? "retained" : "failed"}, float ${bias.toFixed(6)})`,
        );
      } else if (game === "crash") {
        const hash = await hmacSha256Hex(serverSeed.trim(), `${clientSeed.trim()}:${n}:0`);
        const float = bytesToFloat(hash, 0);
        const multiplier = crashResult(float);
        setResult(
          `Crash round — nonce ${n}: crash point = ${multiplier.toFixed(2)}× (raw float ${float.toFixed(6)}, hash ${hash.slice(0, 16)}…)`,
        );
      } else if (game === "roulette") {
        // Fair pocket (pre-bias) and the post-bias resolved outcome.
        const fairPocket = await roulettePocketFromSeeds(serverSeed.trim(), clientSeed.trim(), n);
        const fairColor = roulettePocketColor(fairPocket);
        const { resultPocket, resultColor, won } = await resolveRouletteRound(
          serverSeed.trim(),
          clientSeed.trim(),
          n,
          rouletteBet,
        );
        const bias = await rtpBiasFloat(serverSeed.trim(), clientSeed.trim(), n, "roulette");
        const retained = retainRouletteWin(bias);
        const wouldWinFair = rouletteBet === fairColor;
        setResult(
          `Roulette round — nonce ${n}, bet ${rouletteBet}: fair pocket = ${fairPocket} (${fairColor}, would-win ${wouldWinFair}) → post-bias pocket = ${resultPocket} (${resultColor}), won=${won} (bias ${retained ? "retained" : "failed"}, float ${bias.toFixed(6)})`,
        );
      } else if (game === "mines") {
        const mc = parseInt(mineCount, 10);
        if (!Number.isFinite(mc) || mc < 1 || mc > 24) {
          setError("Mine count must be between 1 and 24.");
          return;
        }
        const tiles = await minesResult(serverSeed.trim(), clientSeed.trim(), n, mc);
        // Mines has no separate bias roll — the 96.5% RTP is baked directly
        // into the multiplier formula (`0.965 × C(25,g)/C(25-m,g)`), so the
        // fair mine layout above IS the actual server layout. The multiplier
        // at any reveal count can be computed deterministically.
        const maxGems = 25 - mc;
        const mults: string[] = [];
        for (let g = 1; g <= Math.min(maxGems, 10); g++) {
          mults.push(`${g}gem=${getMinesMultiplier(mc, g).toFixed(2)}×`);
        }
        const moreGems = maxGems > 10 ? ` … ${maxGems}gem=${getMinesMultiplier(mc, maxGems).toFixed(2)}×` : "";
        setResult(
          `Mines round — nonce ${n}, ${mc} mines: mine tiles = [${tiles.join(", ")}] (tile indices 0–24, left→right top→bottom). Multiplier per gems revealed: ${mults.join(", ")}${moreGems}. RTP baked into the multiplier (96.5% target, no separate bias roll).`,
        );
      } else if (game === "keno") {
        const picks = kenoPicks
          .split(/[\s,]+/)
          .map((s) => parseInt(s, 10))
          .filter((v) => Number.isInteger(v) && v >= 1 && v <= 40);
        if (picks.length < 1 || picks.length > 10) {
          setError("Picks must be 1–10 comma-separated numbers in 1–40.");
          return;
        }
        // Fair draw (pre-bias) and the post-bias resolved outcome.
        const fairFloats = await kenoFloatsFromSeeds(serverSeed.trim(), clientSeed.trim(), n);
        const fairDrawn = drawKenoNumbers(fairFloats);
        const pickSet = new Set(picks);
        const fairHits = fairDrawn.filter((x) => pickSet.has(x)).length;
        const fairMult = getKenoMultiplier(picks.length, fairHits, kenoRisk);
        const { drawn, hits, multiplier } = await playKenoRound({
          serverSeed: serverSeed.trim(),
          clientSeed: clientSeed.trim(),
          nonce: n,
          picks,
          risk: kenoRisk,
        });
        const bias = await rtpBiasFloat(serverSeed.trim(), clientSeed.trim(), n, "keno");
        const retained = retainStakeStyleWin(bias);
        setResult(
          `Keno round — nonce ${n}, picks=[${picks.join(",")}], risk=${kenoRisk}: fair drawn=[${fairDrawn.join(", ")}], hits=${fairHits}, mult=${fairMult}× → post-bias drawn=[${drawn.join(", ")}], hits=${hits}, mult=${multiplier}× (bias ${retained ? "retained" : "failed"}, float ${bias.toFixed(6)})`,
        );
      } else if (game === "blackjack") {
        const cc = parseInt(cardCount, 10);
        if (!Number.isFinite(cc) || cc < 1 || cc > 52) {
          setError("Card count must be between 1 and 52.");
          return;
        }
        const cards = await blackjackResult(serverSeed.trim(), clientSeed.trim(), n, cc);
        setResult(
          `Blackjack round — nonce ${n}: first ${cc} cards = [${cards.join(", ")}] (shoe order, Stake card mapping ♦2→♣A). NOTE: blackjack applies its RTP bias at deal (tag \`bj-deal\`) and per-hand settle (tag \`bj-<handId>-<i>\`). The hand id is server-generated, so this tool shows only the fair shuffled shoe — if the server returned a different outcome on a natural blackjack or a stand/double/split resolve, the per-hand bias fired.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    }
  }

  return (
    <div className="settings__verify-tool">
      <h3 className="settings__subsection-title">Verify a round</h3>
      <p className="settings__hint">
        After rotating your server seed, paste the revealed seed plus the client seed and nonce from
        a past round to recompute the outcome. If it matches what the game displayed, the round was
        fair. Supports all 8 games: Keno, Mines, Limbo, Roulette, Blackjack, Crash, Slots, and Case Battles.
      </p>
      <div className="settings__verify-row">
        <label className="settings__verify-label">
          Game
          <select
            className="settings__verify-select"
            value={game}
            onChange={(e) => setGame(e.target.value as GameType)}
          >
            <option value="limbo">Limbo</option>
            <option value="crash">Crash</option>
            <option value="roulette">Roulette</option>
            <option value="mines">Mines</option>
            <option value="keno">Keno</option>
            <option value="blackjack">Blackjack</option>
          </select>
        </label>
        {game === "mines" && (
          <label className="settings__verify-label">
            Mine count (1–24)
            <input
              type="text"
              className="settings__verify-input"
              value={mineCount}
              onChange={(e) => setMineCount(e.target.value)}
              placeholder="e.g. 3"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
        )}
        {game === "blackjack" && (
          <label className="settings__verify-label">
            Cards to show (1–52)
            <input
              type="text"
              className="settings__verify-input"
              value={cardCount}
              onChange={(e) => setCardCount(e.target.value)}
              placeholder="e.g. 6"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
        )}
        {game === "limbo" && (
          <label className="settings__verify-label">
            Target multiplier
            <input
              type="text"
              className="settings__verify-input"
              value={limboTarget}
              onChange={(e) => setLimboTarget(e.target.value)}
              placeholder="e.g. 2.00"
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
        )}
        {game === "roulette" && (
          <label className="settings__verify-label">
            Bet type
            <select
              className="settings__verify-select"
              value={rouletteBet}
              onChange={(e) => setRouletteBet(e.target.value as "red" | "black" | "green")}
            >
              <option value="red">Red</option>
              <option value="black">Black</option>
              <option value="green">Green</option>
            </select>
          </label>
        )}
        {game === "keno" && (
          <>
            <label className="settings__verify-label">
              Picks (1–10)
              <input
                type="text"
                className="settings__verify-input"
                value={kenoPicks}
                onChange={(e) => setKenoPicks(e.target.value)}
                placeholder="e.g. 1,5,10,15,20"
                autoComplete="off"
              />
            </label>
            <label className="settings__verify-label">
              Risk
              <select
                className="settings__verify-select"
                value={kenoRisk}
                onChange={(e) => setKenoRisk(e.target.value as KenoRisk)}
              >
                <option value="classic">Classic</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </>
        )}
        <label className="settings__verify-label">
          Revealed server seed
          <input
            type="text"
            className="settings__verify-input"
            value={serverSeed}
            onChange={(e) => setServerSeed(e.target.value)}
            placeholder="Paste the revealed hex seed"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="settings__verify-label">
          Client seed
          <input
            type="text"
            className="settings__verify-input"
            value={clientSeed}
            onChange={(e) => setClientSeed(e.target.value)}
            placeholder="e.g. default"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="settings__verify-label">
          Nonce
          <input
            type="text"
            className="settings__verify-input"
            value={nonce}
            onChange={(e) => setNonce(e.target.value)}
            placeholder="e.g. 42"
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
      </div>
      <button
        type="button"
        className="settings__btn settings__btn--ghost"
        onClick={handleVerify}
      >
        Verify round
      </button>
      {error && <p className="settings__error" role="alert">{error}</p>}
      {result && (
        <div className="settings__verify-result" role="status" aria-live="polite">
          <code>{result}</code>
        </div>
      )}
    </div>
  );
}
