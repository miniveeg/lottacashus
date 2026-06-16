type EosBlockWaitProps = {
  targetBlockNum: number | null | undefined;
  commitBlockNum?: number | null;
  blockId?: string | null;
  seedHash?: string | null;
  variant?: "cases" | "jackpot";
};

export function EosBlockWait({
  targetBlockNum,
  commitBlockNum,
  blockId,
  seedHash,
  variant = "cases",
}: EosBlockWaitProps) {
  const isJackpot = variant === "jackpot";

  return (
    <div className={"cbr__eos-wait" + (isJackpot ? " cbr__eos-wait--jackpot" : "")} aria-live="polite">
      <div className="cbr__eos-icon" aria-hidden>
        {isJackpot ? "🎰" : "⛓"}
      </div>
      <p className="cbr__eos-title">
        {isJackpot ? "Mining jackpot block" : "Waiting for EOS block"}
      </p>
      <p className="cbr__eos-desc">
        {isJackpot ? (
          <>
            All cases are opened. The jackpot winner is chosen when block{" "}
            <strong>{targetBlockNum ?? "…"}</strong> is mined on EOS mainnet.
          </>
        ) : (
          <>
            The battle seed is committed. Case opens begin after block{" "}
            <strong>{targetBlockNum ?? "…"}</strong> is mined on EOS mainnet.
          </>
        )}
      </p>
      {commitBlockNum != null && targetBlockNum != null && (
        <p className="cbr__eos-progress">
          Committed at block {commitBlockNum} · target {targetBlockNum}
        </p>
      )}
      {blockId && (
        <p className="cbr__eos-block-id">
          Block ID: <code>{blockId.slice(0, 16)}…</code>
        </p>
      )}
      {seedHash && (
        <p className="cbr__eos-hash">
          Seed hash: <code>{seedHash.slice(0, 12)}…</code>
        </p>
      )}
      <div className="cbr__eos-pulse" aria-hidden />
    </div>
  );
}
