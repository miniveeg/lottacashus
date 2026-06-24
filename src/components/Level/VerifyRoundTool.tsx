import { useState } from "react";

/**
 * "Verify a round" tool — lets the player paste a revealed server seed,
 * client seed, nonce, and game type to recompute the outcome and confirm
 * the house didn't cheat. Complements the rotate-seed feature: after
 * rotating, the player gets the revealed seed and can verify any past round.
 *
 * Currently supports Limbo (the simplest: one HMAC → one multiplier).
 * Future rounds can add Keno, Mines, Roulette, Blackjack, Crash verifiers.
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

/** Limbo result: float → 2²⁴ / (n+1) × 0.99, floored to 2 decimals. */
function limboResult(float: number): number {
  const MAX = 2 ** 24;
  const raw = Math.floor((MAX / (float * MAX + 1)) * 0.99 * 100) / 100;
  return Math.max(1, raw);
}

/** Crash result: float → max(1, (2²⁴ / (float×2²⁴ + 1)) × (1 - 0.01)). */
function crashResult(float: number): number {
  const MAX = 2 ** 24;
  const scaled = float * MAX;
  const raw = (MAX / (scaled + 1)) * (1 - 0.01);
  return Math.max(1, Math.floor(raw * 100) / 100);
}

/** Roulette result: float → floor(float × 37), returns pocket 0–36. */
function rouletteResult(float: number): number {
  return Math.floor(float * 37);
}

const ROULETTE_RED_POCKETS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

function pocketColor(pocket: number): string {
  if (pocket === 0) return "green";
  return ROULETTE_RED_POCKETS.has(pocket) ? "red" : "black";
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

/** Keno: 2 HMAC cursors → 10 floats → Fisher-Yates draw of 10 from 40. */
async function kenoResult(serverSeed: string, clientSeed: string, nonce: number): Promise<number[]> {
  const DRAW_COUNT = 10;
  const POOL_SIZE = 40;
  // 2 cursors, 32 bytes each = 64 bytes; use first 40 (10 floats × 4 bytes)
  const merged: number[] = [];
  for (let cursor = 0; cursor < 2; cursor++) {
    const hash = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    for (let i = 0; i < hash.length; i += 2) {
      merged.push(parseInt(hash.substr(i, 2), 16));
    }
  }
  const floats: number[] = [];
  for (let i = 0; i < DRAW_COUNT; i++) {
    let value = 0;
    for (let j = 0; j < 4; j++) {
      value += merged[i * 4 + j]! / Math.pow(256, j + 1);
    }
    floats.push(value);
  }
  // Fisher-Yates draw without replacement
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => i);
  const drawn: number[] = [];
  for (let t = 0; t < DRAW_COUNT && t < floats.length; t++) {
    const remaining = POOL_SIZE - t;
    const index = Math.floor(floats[t]! * remaining);
    const pickIndex = t + index;
    const value = pool[pickIndex]!;
    drawn.push(value + 1);
    for (let o = pickIndex; o > t; o--) {
      pool[o] = pool[o - 1]!;
    }
    pool[t] = value;
  }
  return drawn.sort((a, b) => a - b);
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
        const hash = await hmacSha256Hex(serverSeed.trim(), `${clientSeed.trim()}:${n}:limbo`);
        const float = bytesToFloat(hash, 0);
        const multiplier = limboResult(float);
        setResult(
          `Limbo round — nonce ${n}: result = ${multiplier.toFixed(2)}× (raw float ${float.toFixed(6)}, hash ${hash.slice(0, 16)}…)`,
        );
      } else if (game === "crash") {
        const hash = await hmacSha256Hex(serverSeed.trim(), `${clientSeed.trim()}:${n}:0`);
        const float = bytesToFloat(hash, 0);
        const multiplier = crashResult(float);
        setResult(
          `Crash round — nonce ${n}: crash point = ${multiplier.toFixed(2)}× (raw float ${float.toFixed(6)}, hash ${hash.slice(0, 16)}…)`,
        );
      } else if (game === "roulette") {
        const hash = await hmacSha256Hex(serverSeed.trim(), `${clientSeed.trim()}:${n}:0,1,2`);
        const float = bytesToFloat(hash, 0);
        const pocket = rouletteResult(float);
        const color = pocketColor(pocket);
        setResult(
          `Roulette round — nonce ${n}: pocket = ${pocket} (${color}) (raw float ${float.toFixed(6)}, hash ${hash.slice(0, 16)}…)`,
        );
      } else if (game === "mines") {
        const mc = parseInt(mineCount, 10);
        if (!Number.isFinite(mc) || mc < 1 || mc > 24) {
          setError("Mine count must be between 1 and 24.");
          return;
        }
        const tiles = await minesResult(serverSeed.trim(), clientSeed.trim(), n, mc);
        setResult(
          `Mines round — nonce ${n}, ${mc} mines: mine tiles = [${tiles.join(", ")}] (tile indices 0–24, left→right top→bottom)`,
        );
      } else if (game === "keno") {
        const drawn = await kenoResult(serverSeed.trim(), clientSeed.trim(), n);
        setResult(
          `Keno round — nonce ${n}: drawn numbers = [${drawn.join(", ")}] (10 of 40, fair draw before RTP bias)`,
        );
      } else if (game === "blackjack") {
        const cc = parseInt(cardCount, 10);
        if (!Number.isFinite(cc) || cc < 1 || cc > 52) {
          setError("Card count must be between 1 and 52.");
          return;
        }
        const cards = await blackjackResult(serverSeed.trim(), clientSeed.trim(), n, cc);
        setResult(
          `Blackjack round — nonce ${n}: first ${cc} cards = [${cards.join(", ")}] (shoe order, Stake card mapping ♦2→♣A)`,
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
        fair. Supports all 6 games: Limbo, Crash, Roulette, Mines, Keno, and Blackjack.
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
