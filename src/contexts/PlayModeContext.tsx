import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Single-balance mode.
 * The platform now uses only Sweeps Coins (SC).
 * Gold Coins (GC) have been fully removed.
 */
export type CoinType = "sweeps_coins";

type PlayModeContextValue = {
  coinType: CoinType;
  label: string;
  /** No-op kept for API compatibility with existing game code. */
  toggle: () => void;
  /** No-op kept for API compatibility with existing game code. */
  setCoinType: (t: CoinType) => void;
};

const PlayModeContext = createContext<PlayModeContextValue | null>(null);

export function PlayModeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PlayModeContextValue>(
    () => ({
      coinType: "sweeps_coins",
      label: "SC",
      toggle: () => {
        /* single-balance mode — no toggle */
      },
      setCoinType: () => {
        /* single-balance mode — always SC */
      },
    }),
    []
  );

  return (
    <PlayModeContext.Provider value={value}>{children}</PlayModeContext.Provider>
  );
}

export function usePlayMode() {
  const ctx = useContext(PlayModeContext);
  if (!ctx) throw new Error("usePlayMode must be used within PlayModeProvider");
  return ctx;
}
