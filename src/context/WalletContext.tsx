import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  credit as creditWallet,
  debit as debitWallet,
  demoDeposit,
  getBalance,
  isLiveWallet,
  refreshLiveBalance,
  subscribeBalance,
  type Json,
} from "../lib/wallet";

type DebitMeta = { game?: string; clientSeed?: string; nonce?: number };
type CreditMeta = { roundId?: string; payout?: number; result?: Json; serverSeed?: string };

type Ctx = {
  balance: number;
  live: boolean;
  debit: (amount: number, meta?: DebitMeta) => Promise<{ ok: boolean; roundId?: string; serverSeedHash?: string }>;
  credit: (amount: number, meta?: CreditMeta) => Promise<void>;
  deposit: (amount: number) => Promise<void>;
  refresh: () => Promise<void>;
};

const WalletContext = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [balance, setBal] = useState(() => getBalance());

  useEffect(() => {
    const unsub = subscribeBalance(() => setBal(getBalance()));
    void refreshLiveBalance();
    return unsub;
  }, []);

  const debit = useCallback(async (amount: number, meta?: DebitMeta) => {
    return debitWallet(amount, meta);
  }, []);

  const credit = useCallback(async (amount: number, meta?: CreditMeta) => {
    await creditWallet(amount, meta);
  }, []);

  const deposit = useCallback(async (amount: number) => {
    await demoDeposit(amount);
  }, []);

  const refresh = useCallback(async () => {
    await refreshLiveBalance();
    setBal(getBalance());
  }, []);

  const value = useMemo(
    () => ({ balance, live: isLiveWallet(), debit, credit, deposit, refresh }),
    [balance, debit, credit, deposit, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Ctx {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside provider");
  return ctx;
}
