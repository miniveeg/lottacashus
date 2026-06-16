/**
 * Node port of supabase/functions/_shared crypto sweep (for scripts/manual-sweep-deposits.mjs).
 */
import { Buffer } from "node:buffer";
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import { ethers } from "ethers";
import { derivePath } from "ed25519-hd-key";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

export const CHAINS = ["sol", "ltc", "eth"];
export const DUST = { sol: 0.001, ltc: 0.0001, eth: 0.0005 };

const LITECOIN_NETWORK = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export function getMainWallet(chain) {
  const env = {
    sol: process.env.MAIN_SOL_WALLET ?? "617G2ByNoHDu75oSNVqiwbho5Z3iHpGytTswufiiV42o",
    ltc: process.env.MAIN_LTC_WALLET ?? "LTtJVrXcdDPFf9yrNkqJpuyY2aPuiNppn1",
    eth: process.env.MAIN_ETH_WALLET ?? "0x6e1641a2D94F3f3605De0f62AECf677B996006A0",
  };
  return env[chain];
}

export function getExtraSweepEntries() {
  const hardcoded = [];
  const env = process.env.SWEEP_EXTRA?.trim();
  const fromEnv = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return [...hardcoded, ...fromEnv];
}

export function parseExtraSweepEntry(entry) {
  const match = entry.match(/^(sol|ltc|eth)_([a-f0-9]{64})$/i);
  if (!match) return null;
  const chain = match[1].toLowerCase();
  if (!CHAINS.includes(chain)) return null;
  return { chain, privateKeyHex: match[2] };
}

function getMnemonic() {
  const mnemonic = process.env.CRYPTO_MASTER_MNEMONIC?.trim();
  if (!mnemonic) throw new Error("CRYPTO_MASTER_MNEMONIC is not set.");
  return mnemonic;
}

async function deriveLtcWallet(mnemonic, index) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, LITECOIN_NETWORK);
  const child = root.derivePath(`m/44'/2'/0'/0/${index}`);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: child.publicKey,
    network: LITECOIN_NETWORK,
  });
  if (!address) throw new Error("Failed to derive LTC address");
  return {
    chain: "ltc",
    derivationIndex: index,
    address,
    privateKeyHex: Buffer.from(child.privateKey).toString("hex"),
  };
}

export async function ltcWalletFromPrivateKeyHex(hex) {
  const keyPair = ECPair.fromPrivateKey(Buffer.from(hex, "hex"), { network: LITECOIN_NETWORK });
  const { address } = bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network: LITECOIN_NETWORK,
  });
  if (!address) throw new Error("Failed to derive LTC address from private key");
  return { chain: "ltc", derivationIndex: -1, address, privateKeyHex: hex };
}

export async function deriveWallet(chain, index) {
  const mnemonic = getMnemonic();
  if (chain === "eth") {
    const path = `m/44'/60'/0'/0/${index}`;
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return {
      chain,
      derivationIndex: index,
      address: wallet.address,
      privateKeyEth: wallet.privateKey,
    };
  }
  if (chain === "ltc") return deriveLtcWallet(mnemonic, index);
  if (chain === "sol") {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const path = `m/44'/501'/${index}'/0'`;
    const derived = derivePath(path, seed.toString("hex"));
    const keypair = Keypair.fromSeed(derived.key.slice(0, 32));
    return {
      chain,
      derivationIndex: index,
      address: keypair.publicKey.toBase58(),
      privateKeyHex: Buffer.from(keypair.secretKey).toString("hex"),
    };
  }
  throw new Error(`Unsupported chain: ${chain}`);
}

export async function getOnChainBalance(chain, address) {
  if (chain === "eth") {
    const provider = new ethers.JsonRpcProvider(
      process.env.ETH_RPC_URL ?? "https://ethereum.publicnode.com"
    );
    const wei = await provider.getBalance(address);
    return Number(ethers.formatEther(wei));
  }
  if (chain === "sol") {
    const rpc = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
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
    const token = process.env.BLOCKCYPHER_TOKEN;
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

async function sweepLtc(wallet, main) {
  const token = process.env.BLOCKCYPHER_TOKEN;
  if (!token) throw new Error("BLOCKCYPHER_TOKEN is required for LTC sweep");

  const keyPair = ECPair.fromPrivateKey(Buffer.from(wallet.privateKeyHex, "hex"), {
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
    throw new Error(`LTC txs/new failed: ${await newTxRes.text()}`);
  }

  const newTx = await newTxRes.json();
  if (newTx.errors?.length) {
    throw new Error(`LTC txs/new: ${JSON.stringify(newTx.errors)}`);
  }

  const pubkeys = [];
  const signatures = newTx.tosign.map((tosign) => {
    pubkeys.push(keyPair.publicKey.toString("hex"));
    const sig = keyPair.sign(Buffer.from(tosign, "hex"));
    return bitcoin.script.signature
      .encode(sig, bitcoin.Transaction.SIGHASH_ALL)
      .toString("hex");
  });

  const sendRes = await fetch(`${base}/txs/send?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tx: newTx.tx,
      tosign: newTx.tosign,
      signatures,
      pubkeys,
    }),
  });

  if (!sendRes.ok) {
    throw new Error(`LTC txs/send failed: ${await sendRes.text()}`);
  }

  const sent = await sendRes.json();
  if (sent.errors?.length) {
    throw new Error(`LTC txs/send: ${JSON.stringify(sent.errors)}`);
  }

  return sent.tx?.hash ?? null;
}

export async function sweepAddress(wallet) {
  const main = getMainWallet(wallet.chain);
  const balance = await getOnChainBalance(wallet.chain, wallet.address);
  if (balance <= DUST[wallet.chain]) return null;

  if (wallet.chain === "eth" && wallet.privateKeyEth) {
    const provider = new ethers.JsonRpcProvider(
      process.env.ETH_RPC_URL ?? "https://ethereum.publicnode.com"
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
    const rpc = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
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

  return null;
}
