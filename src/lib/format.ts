export function formatSC(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}${formatted} SC`;
}

export function formatMulti(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 1000) return `${n.toFixed(2)}x`;
  if (n >= 10) return `${n.toFixed(2)}x`;
  return `${n.toFixed(2)}x`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function shortId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
