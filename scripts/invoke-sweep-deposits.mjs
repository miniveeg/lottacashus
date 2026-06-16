/**
 * Call deployed sweep-deposits (or health check) on Supabase.
 *
 * Requires in project root .env:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   CRON_SECRET  (same as Supabase secret + cron-job.org x-cron-secret header)
 *
 * Usage:
 *   npm run sweep:remote:health
 *   npm run sweep:remote
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
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
}

loadDotEnv(ENV_PATH);

const health = process.argv.includes("--health");
const baseUrl = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const cronSecret = process.env.CRON_SECRET?.trim();

if (!baseUrl || !anonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

if (!cronSecret) {
  console.error(
    "Missing CRON_SECRET in .env (must match Supabase secrets and cron-job.org x-cron-secret header)"
  );
  process.exit(1);
}

const url = `${baseUrl}/functions/v1/sweep-deposits${health ? "?health=1" : ""}`;

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
    "x-cron-secret": cronSecret,
  },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log(JSON.stringify(body, null, 2));

if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  if (res.status === 401) {
    console.error(
      "401 = wrong CRON_SECRET or missing Authorization/apikey headers. Cron jobs need all three headers."
    );
  }
  process.exit(1);
}
