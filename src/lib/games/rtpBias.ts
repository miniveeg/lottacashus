/** Provably fair RTP bias rolls (deterministic from seeds). */

function bytesToFloat(bytes: Uint8Array, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

/** Independent bias float in [0, 1) for RTP outcome adjustment. */
export async function rtpBiasFloat(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  tag: string
): Promise<number> {
  const hash = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:rtp:${tag}`);
  return bytesToFloat(hash, 0);
}
