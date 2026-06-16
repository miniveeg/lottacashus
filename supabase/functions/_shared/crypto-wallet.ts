import { Buffer } from "node:buffer";
import * as bip39 from "npm:bip39@3.1.0";
import { ethers } from "npm:ethers@6.13.0";
import { derivePath } from "npm:ed25519-hd-key@1.3.0";
import { Keypair } from "npm:@solana/web3.js@1.98.0";
import type { Chain } from "./config.ts";

export const LITECOIN_NETWORK = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export type LtcScriptType = "p2pkh" | "p2wpkh";

export type DerivedWallet = {
  address: string;
  chain: Chain;
  derivationIndex: number;
  privateKeyHex?: string;
  privateKeyEth?: string;
  /** LTC only: legacy (L…) vs native SegWit (ltc1…) */
  ltcScriptType?: LtcScriptType;
};

export function getMnemonic(): string {
  const mnemonic = Deno.env.get("CRYPTO_MASTER_MNEMONIC");
  if (!mnemonic?.trim()) {
    throw new Error("CRYPTO_MASTER_MNEMONIC is not set in Edge Function secrets.");
  }
  return mnemonic.trim();
}

async function deriveLtcWallet(mnemonic: string, index: number): Promise<DerivedWallet> {
  const { BIP32Factory } = await import("npm:bip32@4.0.0");
  const ecc = await import("npm:tiny-secp256k1@2.2.3");
  const { payments } = await import("npm:bitcoinjs-lib@6.1.6");

  const bip32 = BIP32Factory(ecc);
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, LITECOIN_NETWORK);
  const child = root.derivePath(`m/44'/2'/0'/0/${index}`);
  const { address } = payments.p2pkh({ pubkey: child.publicKey, network: LITECOIN_NETWORK });
  if (!address) throw new Error("Failed to derive LTC address");

  return {
    chain: "ltc",
    derivationIndex: index,
    address,
    privateKeyHex: Buffer.from(child.privateKey!).toString("hex"),
  };
}

async function ltcWalletFromKeyPair(
  keyPair: { publicKey: Buffer },
  privateKeyHex: string,
  scriptType: LtcScriptType,
  derivationIndex: number
): Promise<DerivedWallet> {
  const { payments } = await import("npm:bitcoinjs-lib@6.1.6");
  const payment =
    scriptType === "p2wpkh"
      ? payments.p2wpkh({ pubkey: keyPair.publicKey, network: LITECOIN_NETWORK })
      : payments.p2pkh({ pubkey: keyPair.publicKey, network: LITECOIN_NETWORK });
  if (!payment.address) throw new Error(`Failed to derive LTC ${scriptType} address`);

  return {
    chain: "ltc",
    derivationIndex,
    address: payment.address,
    privateKeyHex,
    ltcScriptType: scriptType,
  };
}

export async function ltcWalletFromPrivateKeyHex(
  hex: string,
  scriptType: LtcScriptType = "p2pkh"
): Promise<DerivedWallet> {
  const { ECPairFactory } = await import("npm:ecpair@2.1.0");
  const ecc = await import("npm:tiny-secp256k1@2.2.3");
  const ECPair = ECPairFactory(ecc);
  const keyPair = ECPair.fromPrivateKey(Buffer.from(hex, "hex"), { network: LITECOIN_NETWORK });
  return ltcWalletFromKeyPair(keyPair, hex, scriptType, -1);
}

/** Same private key → legacy (L…) and native SegWit (ltc1…) addresses. */
export async function ltcWalletVariantsFromPrivateKeyHex(hex: string): Promise<DerivedWallet[]> {
  return [
    await ltcWalletFromPrivateKeyHex(hex, "p2pkh"),
    await ltcWalletFromPrivateKeyHex(hex, "p2wpkh"),
  ];
}

/** Find mnemonic-derived wallet that controls `targetAddress` (BIP44 legacy + SegWit paths). */
export async function findLtcWalletForAddress(
  targetAddress: string,
  maxIndex = 250
): Promise<DerivedWallet | null> {
  const mnemonic = getMnemonic();
  const { BIP32Factory } = await import("npm:bip32@4.0.0");
  const ecc = await import("npm:tiny-secp256k1@2.2.3");
  const bip32 = BIP32Factory(ecc);
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, LITECOIN_NETWORK);
  const normalized = targetAddress.toLowerCase();

  const paths: Array<{ path: (i: number) => string; scriptType: LtcScriptType }> = [
    { path: (i) => `m/44'/2'/0'/0/${i}`, scriptType: "p2pkh" },
    { path: (i) => `m/44'/2'/0'/0/${i}`, scriptType: "p2wpkh" },
    { path: (i) => `m/84'/2'/0'/0/${i}`, scriptType: "p2wpkh" },
  ];

  for (const { path, scriptType } of paths) {
    for (let i = 0; i <= maxIndex; i++) {
      const child = root.derivePath(path(i));
      const hex = Buffer.from(child.privateKey!).toString("hex");
      const wallet = await ltcWalletFromKeyPair(child, hex, scriptType, i);
      if (wallet.address.toLowerCase() === normalized) {
        return wallet;
      }
    }
  }
  return null;
}

export async function deriveWallet(chain: Chain, index: number): Promise<DerivedWallet> {
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

  if (chain === "ltc") {
    return deriveLtcWallet(mnemonic, index);
  }

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
