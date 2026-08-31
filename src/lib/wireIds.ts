/** Shared payload-field readers. Pure so unit tests can import them
 *  without constructing a Supabase client. */

export function extractCrashBetId(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const row = data as Record<string, unknown>;
  const raw = row.betId ?? row.bet_id ?? row.out_bet_id;
  const id = String(raw ?? "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

export function extractDepositAddress(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const nested =
    row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
  const raw =
    row.address ??
    row.deposit_address ??
    row.depositAddress ??
    nested?.address ??
    nested?.deposit_address;
  const addr = String(raw ?? "").trim();
  return addr || null;
}
