const STORAGE_KEY = "lottacash_affiliate_ref";

/** Uppercase A–Z / 0–9 only; matching is case-insensitive via normalization. */
export function normalizeAffiliateCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

export function storeAffiliateRef(code: string) {
  const normalized = normalizeAffiliateCode(code);
  if (!normalized) return;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    /* ignore quota / private mode */
  }
}

export function getStoredAffiliateRef(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const normalized = normalizeAffiliateCode(value);
    return normalized || null;
  } catch {
    return null;
  }
}

export function clearStoredAffiliateRef() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function buildAffiliateSignupUrl(origin: string, code: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/signup?ref=${encodeURIComponent(code)}`;
}
