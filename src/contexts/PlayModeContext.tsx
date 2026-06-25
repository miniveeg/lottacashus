import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CoinType = "balance" | "sweeps_coins";

type PlayModeContextValue = {
  coinType: CoinType;
  label: string;
  toggle: () => void;
  setCoinType: (t: CoinType) => void;
};

const PlayModeContext = createContext<PlayModeContextValue | null>(null);

const STORAGE_KEY = "lc_coin_type";

function readStoredCoinType(): CoinType {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "balance" || stored === "sweeps_coins") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.)
  }
  return "balance";
}

export function PlayModeProvider({ children }: { children: ReactNode }) {
  const [coinType, setCoinTypeState] = useState<CoinType>(readStoredCoinType);

  const setCoinType = (t: CoinType) => {
    setCoinTypeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  };

  // Persist on change (in case readStoredCoinType returned a default)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, coinType);
    } catch {
      // ignore
    }
  }, [coinType]);

  const value = useMemo<PlayModeContextValue>(
    () => ({
      coinType,
      label: coinType === "balance" ? "GC" : "SC",
      toggle: () =>
        setCoinType(coinType === "balance" ? "sweeps_coins" : "balance"),
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
