import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type CoinType = "balance" | "sweeps_coins";

type PlayModeContextValue = {
  coinType: CoinType;
  label: string;
  toggle: () => void;
  setCoinType: (t: CoinType) => void;
};

const PlayModeContext = createContext<PlayModeContextValue | null>(null);

export function PlayModeProvider({ children }: { children: ReactNode }) {
  const [coinType, setCoinType] = useState<CoinType>("balance");

  const value = useMemo<PlayModeContextValue>(
    () => ({
      coinType,
      label: coinType === "balance" ? "GC" : "SC",
      toggle: () =>
        setCoinType((prev) => (prev === "balance" ? "sweeps_coins" : "balance")),
      setCoinType,
    }),
    [coinType]
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
