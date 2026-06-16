const EOS_RPC = "https://eos.greymass.com/v1/chain";

export type EosHead = {
  blockNum: number;
  blockId: string;
};

export type EosBlock = {
  id: string;
  blockNum: number;
  timestamp: string;
};

export async function getEosHead(): Promise<EosHead> {
  const res = await fetch(`${EOS_RPC}/get_info`, { method: "POST" });
  if (!res.ok) throw new Error(`EOS get_info failed (${res.status})`);
  const data = await res.json();
  return {
    blockNum: Number(data.head_block_num),
    blockId: String(data.head_block_id),
  };
}

export async function getEosBlock(blockNum: number): Promise<EosBlock> {
  const res = await fetch(`${EOS_RPC}/get_block`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block_num_or_id: blockNum }),
  });
  if (!res.ok) throw new Error(`EOS get_block failed (${res.status})`);
  const data = await res.json();
  return {
    id: String(data.id),
    blockNum: Number(data.block_num),
    timestamp: String(data.timestamp ?? ""),
  };
}

/** Wait until a target block height is available (polls ~400ms). */
export async function waitForEosBlock(
  targetBlockNum: number,
  maxWaitMs = 12_000
): Promise<EosBlock | null> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const head = await getEosHead();
    if (head.blockNum >= targetBlockNum) {
      return getEosBlock(targetBlockNum);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}
