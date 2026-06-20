import { useState } from "react";
import {
  entryAfterBorrow,
  MAX_BORROW_PERCENT,
  payoutKeepMultiplier,
} from "../../lib/games/case-battles";
import { formatCoins } from "../../lib/format";
import { joinCaseBattle, type CaseBattleView } from "../../lib/caseBattles";

type CaseBattleJoinPanelProps = {
  battle: CaseBattleView;
  balance: number;
  onJoined: (battle: CaseBattleView) => void;
  onError: (message: string | null) => void;
};

export function CaseBattleJoinPanel({
  battle,
  balance,
  onJoined,
  onError,
}: CaseBattleJoinPanelProps) {
  const [borrow, setBorrow] = useState(false);
  const [borrowPercent, setBorrowPercent] = useState(50);
  const [busy, setBusy] = useState(false);

  const effectiveBorrow = borrow ? borrowPercent : 0;
  const joinCost = entryAfterBorrow(battle.entryCost, effectiveBorrow);
  const keepPct = Math.round(payoutKeepMultiplier(effectiveBorrow) * 100);
  const canAfford = balance >= joinCost;

  const handleJoin = () => {
    if (busy || !canAfford) return;
    setBusy(true);
    onError(null);
    void joinCaseBattle(battle.battleId, effectiveBorrow).then(({ data, error: err }) => {
      setBusy(false);
      if (data) {
        onJoined(data);
        return;
      }
      onError(err ?? "Could not join battle.");
    });
  };

  return (
    <div className="cbr__join-panel">
      <p className="cbr__join-panel-lead">
        Join this battle — entry {formatCoins(battle.entryCost, "balance")} full price
      </p>
      <div className="cbr__join-panel-borrow">
        <button
          type="button"
          className="cbr__join-borrow-toggle"
          aria-pressed={borrow}
          onClick={() => setBorrow((v) => !v)}
        >
          <span className={"cbr__join-toggle-track" + (borrow ? " cbr__join-toggle-track--on" : "")}>
            <span className="cbr__join-toggle-thumb" />
          </span>
          Borrow
        </button>
        <label className={"cbr__join-borrow-slider" + (borrow ? "" : " cbr__join-borrow-slider--off")}>
          <span>{borrowPercent}%</span>
          <input
            type="range"
            min={1}
            max={MAX_BORROW_PERCENT}
            value={borrowPercent}
            disabled={!borrow}
            onChange={(e) => setBorrowPercent(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="cbr__join-panel-cost">
        You pay <strong>{formatCoins(joinCost, "balance")}</strong>
        {effectiveBorrow > 0 && (
          <span className="cbr__join-panel-note">
            {" "}
            · {effectiveBorrow}% borrowed · keep {keepPct}% of any winnings
          </span>
        )}
      </p>
      {!canAfford && (
        <p className="cbr__join-panel-warn">Insufficient balance ({formatCoins(balance, "balance")} available)</p>
      )}
      <button
        type="button"
        className="cb-page__btn-primary cbr__join-panel-btn"
        disabled={busy || !canAfford}
        onClick={handleJoin}
      >
        {busy ? "Joining…" : "Join battle"}
      </button>
    </div>
  );
}
