/**
 * Manually sweep user deposit addresses → main treasury wallets.
 *
 * Setup:
 *   copy scripts\sweep.env.example scripts\sweep.env  (fill secrets)
 *   npm install
 *
 * Usage:
 *   npm run sweep:dry      — balances only
 *   npm run sweep:manual   — sweep (prompts YES)
 *
 * Options:
 *   --dry-run
 *   --yes
 *   --chain sol|ltc|eth
 *   --index N
 *   --address ADDR
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  CHAINS,
  DUST,
  deriveWallet,
  getExtraSweepEntries,
  getMainWallet,
  getOnChainBalance,
  ltcWalletFromPrivateKeyHex,
  parseExtraSweepEntry,
  sweepAddress,
} from "./lib/sweep-node.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "sweep.env");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

function parseCli(argv) {
  const out = { dryRun: false, yes: false, help: false, chain: undefined, index: undefined, address: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--chain") out.chain = argv[++i]?.toLowerCase();
    else if (a === "--index") out.index = Number(argv[++i]);
    else if (a === "--address") out.address = argv[++i]?.trim();
  }
  return out;
}

function askYes(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer?.trim().toUpperCase() === "YES");
    });
  });
}

const args = parseCli(process.argv.slice(2));

if (args.help) {
  console.log(`npm run sweep:dry | sweep:manual
  --dry-run  --yes  --chain sol|ltc|eth  --index N  --address ADDR`);
  process.exit(0);
}

if (!loadEnvFile(ENV_PATH)) {
  console.error(`Missing ${ENV_PATH}`);
  console.error("Copy scripts/sweep.env.example → scripts/sweep.env and fill secrets.");
  process.exit(1);
}

if (args.chain && !CHAINS.includes(args.chain)) {
  console.error("--chain must be sol, ltc, or eth");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mnemonic = process.env.CRYPTO_MASTER_MNEMONIC?.trim();

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/sweep.env");
  process.exit(1);
}
if (!mnemonic) {
  console.error("Missing CRYPTO_MASTER_MNEMONIC in scripts/sweep.env");
  process.exit(1);
}
if (!args.dryRun && (!args.chain || args.chain === "ltc") && !process.env.BLOCKCYPHER_TOKEN) {
  console.warn("Warning: BLOCKCYPHER_TOKEN not set — LTC sweeps will fail.");
}

console.log("\n=== LottaCash manual deposit sweep ===\n");
console.log("Mode:", args.dryRun ? "DRY RUN (no txs)" : "LIVE SWEEP");
console.log("Treasury:");
for (const c of CHAINS) {
  console.log(`  ${c.toUpperCase()} → ${getMainWallet(c)}`);
}
if (args.chain) console.log("Filter chain:", args.chain);
if (args.index != null && !Number.isNaN(args.index)) console.log("Filter index:", args.index);
if (args.address) console.log("Filter address:", args.address);
console.log("");

const supabase = createClient(supabaseUrl, serviceKey);
const { data: rows, error: addrError } = await supabase
  .from("user_deposit_addresses")
  .select("chain, address, derivation_index");

if (addrError) {
  console.error("Failed to load user_deposit_addresses:", addrError.message);
  process.exit(1);
}

/** @type {{ chain: string, address: string, derivationIndex: number, source: string, privateKeyHex?: string }[]} */
const targets = [];

for (const row of rows ?? []) {
  const chain = row.chain;
  if (args.chain && chain !== args.chain) continue;
  if (args.index != null && row.derivation_index !== args.index) continue;
  if (args.address && row.address !== args.address) continue;
  targets.push({
    chain,
    address: row.address,
    derivationIndex: row.derivation_index,
    source: "db",
  });
}

for (const entry of getExtraSweepEntries()) {
  const parsed = parseExtraSweepEntry(entry);
  if (!parsed) continue;
  if (args.chain && parsed.chain !== args.chain) continue;
  if (parsed.chain === "ltc") {
    const wallet = await ltcWalletFromPrivateKeyHex(parsed.privateKeyHex);
    if (args.address && wallet.address !== args.address) continue;
    if (targets.some((t) => t.address === wallet.address)) continue;
    targets.push({
      chain: "ltc",
      address: wallet.address,
      derivationIndex: -1,
      source: "extra",
      privateKeyHex: parsed.privateKeyHex,
    });
  }
}

if (targets.length === 0) {
  console.log("No matching deposit addresses.");
  process.exit(0);
}

console.log(`Found ${targets.length} address(es) to check.\n`);

/** @type {{ target: typeof targets[0], balance: number }[]} */
const toSweep = [];

for (const target of targets) {
  const balance = await getOnChainBalance(target.chain, target.address);
  const dust = DUST[target.chain];
  const status = balance > dust ? "SWEEP" : "skip";
  console.log(
    `[${status}] ${target.chain.toUpperCase()} #${target.derivationIndex} ${target.address} — ${balance} (${target.source})`
  );
  if (balance > dust) toSweep.push({ target, balance });
}

if (toSweep.length === 0) {
  console.log("\nNothing above dust threshold to sweep.");
  process.exit(0);
}

console.log(`\n${toSweep.length} address(es) with funds.`);

if (args.dryRun) {
  console.log("\nDry run complete. Run: npm run sweep:manual");
  process.exit(0);
}

if (!args.yes) {
  console.log("\nThis will send on-chain transactions to your main wallets.");
  const ok = await askYes("Type YES to continue: ");
  if (!ok) {
    console.log("Aborted.");
    process.exit(0);
  }
}

let swept = 0;
const errors = [];

for (const { target, balance } of toSweep) {
  console.log(`\nSweeping ${target.chain} ${target.address} (${balance})…`);
  try {
    const wallet =
      target.privateKeyHex && target.chain === "ltc"
        ? await ltcWalletFromPrivateKeyHex(target.privateKeyHex)
        : await deriveWallet(target.chain, target.derivationIndex);

    if (wallet.address !== target.address) {
      throw new Error(`Derived address mismatch: expected ${target.address}, got ${wallet.address}`);
    }

    const txHash = await sweepAddress(wallet);
    if (txHash) {
      swept++;
      console.log(`  ✓ Tx: ${txHash}`);
      await supabase
        .from("crypto_deposits")
        .update({ status: "swept", swept_at: new Date().toISOString() })
        .eq("address", target.address)
        .eq("status", "credited");
    } else {
      console.log("  — No tx (balance below dust or sweep returned null)");
      errors.push(`${target.chain} ${target.address}: no tx hash`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg}`);
    errors.push(`${target.chain} ${target.address}: ${msg}`);
  }
}

console.log("\n=== Done ===");
console.log(`Swept: ${swept} / ${toSweep.length}`);
if (errors.length) {
  console.log("Errors:");
  for (const e of errors) console.log(`  - ${e}`);
}
