export type CryptoChain = "sol" | "ltc" | "eth";

export const CRYPTO_CHAINS: { id: CryptoChain; label: string; symbol: string }[] = [
  { id: "sol", label: "Solana", symbol: "SOL" },
  { id: "ltc", label: "Litecoin", symbol: "LTC" },
  { id: "eth", label: "Ethereum", symbol: "ETH" },
];

export const CONFIRMATIONS_LABEL: Record<CryptoChain, string> = {
  sol: "1 confirmation (~seconds)",
  ltc: "6 confirmations (~15 min)",
  eth: "12 confirmations (~3 min)",
};

export type DepositAddressResponse = {
  chain: CryptoChain;
  address: string;
  confirmationsRequired: number;
};

export type CryptoDepositRow = {
  id: string;
  chain: CryptoChain;
  tx_hash: string;
  crypto_amount: number;
  usd_amount: number;
  confirmations: number;
  required_confirmations: number;
  status: string;
  created_at: string;
};
