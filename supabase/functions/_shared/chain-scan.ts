import type { Chain } from "./config.ts";

export type DetectedIncoming = {
  txHash: string;
  amount: number;
  confirmations: number;
};

export async function scanIncomingTransactions(
  chain: Chain,
  address: string
): Promise<DetectedIncoming[]> {
  switch (chain) {
    case "ltc":
      return scanLtc(address);
    case "eth":
      return scanEth(address);
    case "sol":
      return scanSol(address);
    default:
      return [];
  }
}

async function scanLtc(address: string): Promise<DetectedIncoming[]> {
  const token = Deno.env.get("BLOCKCYPHER_TOKEN");
  const url = token
    ? `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full?token=${token}`
    : `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full`;

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const incoming: DetectedIncoming[] = [];

  for (const tx of data.txs ?? []) {
    for (const out of tx.outputs ?? []) {
      if (out.addresses?.includes(address) && out.value > 0) {
        incoming.push({
          txHash: tx.hash,
          amount: out.value / 1e8,
          confirmations: tx.confirmations ?? 0,
        });
      }
    }
  }
  return incoming;
}

async function scanEth(address: string): Promise<DetectedIncoming[]> {
  const apiKey = Deno.env.get("ETHERSCAN_API_KEY");
  if (!apiKey) {
    console.warn("ETHERSCAN_API_KEY missing — skipping ETH scan");
    return [];
  }

  const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.status !== "1" || !Array.isArray(data.result)) return [];

  const incoming: DetectedIncoming[] = [];
  const addrLower = address.toLowerCase();

  for (const tx of data.result) {
    if (tx.to?.toLowerCase() === addrLower && tx.isError === "0") {
      const valueEth = Number(tx.value) / 1e18;
      if (valueEth > 0) {
        const latest = Number(tx.confirmations ?? 0);
        incoming.push({
          txHash: tx.hash,
          amount: valueEth,
          confirmations: latest,
        });
      }
    }
  }
  return incoming;
}

async function scanSol(address: string): Promise<DetectedIncoming[]> {
  const rpc = Deno.env.get("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";

  const sigRes = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit: 20 }],
    }),
  });

  if (!sigRes.ok) return [];
  const sigData = await sigRes.json();
  const signatures = sigData.result ?? [];
  const incoming: DetectedIncoming[] = [];

  for (const sig of signatures) {
    if (sig.err) continue;

    const txRes = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      }),
    });

    if (!txRes.ok) continue;
    const txData = await txRes.json();
    const tx = txData.result;
    if (!tx?.meta || tx.meta.err) continue;

    const pre = tx.meta.preBalances ?? [];
    const post = tx.meta.postBalances ?? [];
    const accountKeys = tx.transaction?.message?.accountKeys ?? [];

    let addrIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      const key = typeof accountKeys[i] === "string" ? accountKeys[i] : accountKeys[i].pubkey;
      if (key === address) {
        addrIndex = i;
        break;
      }
    }

    if (addrIndex >= 0 && post[addrIndex] > pre[addrIndex]) {
      const lamports = post[addrIndex] - pre[addrIndex];
      incoming.push({
        txHash: sig.signature,
        amount: lamports / 1e9,
        confirmations: sig.confirmationStatus === "finalized" ? 32 : 1,
      });
    }
  }

  return incoming;
}
