import { Buffer } from "node:buffer";
import type { Chain } from "./config.ts";
import { getMainWallet } from "./config.ts";
import type { DerivedWallet } from "./crypto-wallet.ts";
import { LITECOIN_NETWORK } from "./crypto-wallet.ts";

const DUST: Record<Chain, number> = { sol: 0.001, ltc: 0.0001, eth: 0.0005 };

export async function sweepAddress(wallet: DerivedWallet): Promise<string | null> {
  const main = getMainWallet(wallet.chain);
  const balance = await getOnChainBalance(wallet.chain, wallet.address);
  if (balance <= DUST[wallet.chain]) return null;

  try {
    if (wallet.chain === "eth" && wallet.privateKeyEth) {
      const { ethers } = await import("npm:ethers@6.13.0");
      const provider = new ethers.JsonRpcProvider(
        Deno.env.get("ETH_RPC_URL") ?? "https://ethereum.publicnode.com"
      );
      const signer = new ethers.Wallet(wallet.privateKeyEth, provider);
      const feeData = await provider.getFeeData();
      const gasLimit = 21000n;
      const gasPrice = feeData.gasPrice ?? 20n * 10n ** 9n;
      const gasCost = gasLimit * gasPrice;
      const valueWei = ethers.parseEther(String(balance)) - gasCost;
      if (valueWei <= 0n) return null;
      const tx = await signer.sendTransaction({ to: main, value: valueWei });
      await tx.wait(1);
      return tx.hash;
    }

    if (wallet.chain === "sol" && wallet.privateKeyHex) {
      const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } =
        await import("npm:@solana/web3.js@1.98.0");
      const rpc = Deno.env.get("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";
      const connection = new Connection(rpc, "confirmed");
      const secret = Uint8Array.from(Buffer.from(wallet.privateKeyHex, "hex"));
      const from = Keypair.fromSecretKey(secret);
      const lamports = Math.floor((balance - DUST.sol) * LAMPORTS_PER_SOL);
      if (lamports <= 0) return null;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: from.publicKey,
          toPubkey: new PublicKey(main),
          lamports,
        })
      );
      return await sendAndConfirmTransaction(connection, tx, [from]);
    }

    if (wallet.chain === "ltc" && wallet.privateKeyHex) {
      return await sweepLtc(wallet, main);
    }
  } catch (err) {
    console.error(`Sweep failed ${wallet.chain} ${wallet.address}:`, err);
  }
  return null;
}

export async function getOnChainBalance(chain: Chain, address: string): Promise<number> {
  if (chain === "eth") {
    const { ethers } = await import("npm:ethers@6.13.0");
    const provider = new ethers.JsonRpcProvider(
      Deno.env.get("ETH_RPC_URL") ?? "https://ethereum.publicnode.com"
    );
    const wei = await provider.getBalance(address);
    return Number(ethers.formatEther(wei));
  }
  if (chain === "sol") {
    const rpc = Deno.env.get("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    const data = await res.json();
    return (data.result?.value ?? 0) / 1e9;
  }
  if (chain === "ltc") {
    const token = Deno.env.get("BLOCKCYPHER_TOKEN");
    const url = token
      ? `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance?token=${token}`
      : `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();
    return (data.balance ?? 0) / 1e8;
  }
  return 0;
}

async function sweepLtc(wallet: DerivedWallet, main: string): Promise<string | null> {
  const token = Deno.env.get("BLOCKCYPHER_TOKEN");
  if (!token) {
    console.warn("BLOCKCYPHER_TOKEN missing — cannot sweep LTC");
    return null;
  }

  const { ECPairFactory } = await import("npm:ecpair@2.1.0");
  const ecc = await import("npm:tiny-secp256k1@2.2.3");
  const bitcoin = await import("npm:bitcoinjs-lib@6.1.6");
  const ECPair = ECPairFactory(ecc);
  const keyPair = ECPair.fromPrivateKey(Buffer.from(wallet.privateKeyHex!, "hex"), {
    network: LITECOIN_NETWORK,
  });

  const base = "https://api.blockcypher.com/v1/ltc/main";
  const newTxRes = await fetch(`${base}/txs/new?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [{ addresses: [wallet.address] }],
      outputs: [{ addresses: [main] }],
      preference: "medium",
    }),
  });

  if (!newTxRes.ok) {
    const errText = await newTxRes.text();
    console.error(`LTC txs/new failed for ${wallet.address}:`, errText);
    return null;
  }

  const newTx = await newTxRes.json();
  if (newTx.errors?.length) {
    console.error(`LTC txs/new errors for ${wallet.address}:`, newTx.errors);
    return null;
  }

  const isSegwit = wallet.ltcScriptType === "p2wpkh" || wallet.address.startsWith("ltc1");
  const pubkeys: string[] = [];
  const signatures = (newTx.tosign as string[]).map((tosign: string) => {
    pubkeys.push(keyPair.publicKey.toString("hex"));
    const sig = keyPair.sign(Buffer.from(tosign, "hex"));
    return bitcoin.script.signature
      .encode(sig, bitcoin.Transaction.SIGHASH_ALL)
      .toString("hex");
  });

  const sendBody: Record<string, unknown> = {
    tx: newTx.tx,
    tosign: newTx.tosign,
    signatures,
    pubkeys,
  };
  if (isSegwit) {
    sendBody.witnesses = signatures.map((sig, i) => [sig, pubkeys[i]]);
  }

  const sendRes = await fetch(`${base}/txs/send?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sendBody),
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    console.error(`LTC txs/send failed for ${wallet.address}:`, errText);
    return null;
  }

  const sent = await sendRes.json();
  if (sent.errors?.length) {
    console.error(`LTC txs/send errors for ${wallet.address}:`, sent.errors);
    return null;
  }

  return sent.tx?.hash ?? null;
}
