import { formatCoins } from "../../lib/format";
import type { CaseBattleView } from "../../lib/caseBattles";
import { gamemodeLabel } from "./caseBattlesUi";
import {
  battleTotalUnboxed,
  buildPlayerResultLines,
  displayWinAmount,
  teamWinnerEqualShare,
  winnerSlotShare,
  type PlayerResultLine,
} from "./battleResultHelpers";
type CaseBattleFinalResultsProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  slotGroups: number[][];
  showTeamDividers: boolean;
};

function FinalPlayerCard({
  line,
  isJackpot,
  winAmount,
  teamShare,
  slotShare,
}: {
  line: PlayerResultLine;
  isJackpot: boolean;
  winAmount: number;
  teamShare: number;
  slotShare: number;
}) {
  const showTeamShareNote =
    line.isWinner &&
    line.borrowPercent > 0 &&
    teamShare > 0 &&
    winAmount > 0 &&
    Math.abs(winAmount - teamShare) > 0.01;

  return (
    <div
      className={
        "cbr__final-card" +
        (line.isWinner ? " cbr__final-card--winner" : "") +
        (line.isYou ? " cbr__final-card--you" : "")
      }
    >
      <div className="cbr__final-card-top">
        <span className="cbr__final-card-avatar">{line.isBot ? "🤖" : "👤"}</span>
        <span className="cbr__final-card-name">
          {line.displayName}
          {line.isYou ? " (you)" : ""}
        </span>
        {line.isWinner && <span className="cbr__final-card-badge">Winner</span>}
      </div>
      <p className="cbr__final-card-unboxed">Unboxed {formatCoins(line.unboxedTotal, "balance")}</p>
      <p
        className={
          "cbr__final-card-won" + (winAmount > 0 ? " cbr__final-card-won--positive" : "")
        }
      >
        {winAmount > 0 ? `Won ${formatCoins(winAmount, "balance")}` : line.isWinner && slotShare > 0 ? "Won —" : "—"}
      </p>
      {line.isWinner && line.isBot && slotShare > 0 && winAmount > 0 && (
        <p className="cbr__final-card-note">Full slot share — not credited to balance</p>
      )}
      {isJackpot && line.jackpotPct != null && (
        <p className="cbr__final-card-jp">{line.jackpotPct}% jackpot odds</p>
      )}
      {line.borrowPercent > 0 && (
        <p className="cbr__final-card-borrow">
          {line.borrowPercent}% borrow
          {line.entryPaid != null ? ` · ${formatCoins(line.entryPaid, "balance")} paid` : ""}
        </p>
      )}
      {showTeamShareNote && (
        <p className="cbr__final-card-note">Team share {formatCoins(teamShare, "balance")} before borrow</p>
      )}
    </div>
  );
}

export function CaseBattleFinalResults({
  battle,
  userId,
  slotGroups,
  showTeamDividers,
}: CaseBattleFinalResultsProps) {
  const lines = buildPlayerResultLines(battle, userId);
  const lineBySlot = new Map(lines.map((l) => [l.slot, l]));
  const isJackpot = battle.gamemode === "jackpot";
  const resultData = battle.results as { jackpotReelSlot?: number } | null;
  const jackpotSlot = resultData?.jackpotReelSlot ?? battle.winnerSlot;
  const jackpotWinner = battle.players.find((p) => p.slot === jackpotSlot);
  const totalUnboxed = battleTotalUnboxed(battle);
  const teamShare = teamWinnerEqualShare(lines, battle);
  const slotShare = winnerSlotShare(lines, battle);
  const winnerLine = lines.find((l) => l.slot === jackpotSlot) ?? lines.find((l) => l.isWinner);
  const isTeamMode = battle.playerMode === "2v2" || battle.playerMode === "3v3";
  const payoutNote = isTeamMode
    ? "— winning team splits this evenly per slot; borrow only reduces your credit"
    : isJackpot
      ? "— jackpot winner takes the full pool; borrow only reduces your credit"
      : "— winner(s) take the full unboxed pool; borrow only reduces your credit";

  return (
    <section className="cbr__final" aria-label="Battle results">
      <div className="cbr__final-hero">
        <p className="cbr__final-eyebrow">{gamemodeLabel(battle.gamemode)} · Battle complete</p>
        <h2 className="cbr__final-title">
          {winnerLine ? (
            <>
              <span className="cbr__final-winner-name">{winnerLine.displayName}</span>
              {winnerLine.isYou ? " (you)" : ""} wins
            </>
          ) : (
            "Results"
          )}
        </h2>
        <p className="cbr__final-pot">
          Total unboxed <strong>{formatCoins(totalUnboxed, "balance")}</strong>
          <span className="cbr__final-pot-note"> {payoutNote}</span>
        </p>
        {isJackpot && jackpotWinner && (
          <p className="cbr__final-jackpot">
            Jackpot landed on <strong>{jackpotWinner.displayName}</strong>
          </p>
        )}
      </div>

      <div className="cbr__final-row">
        {slotGroups.map((teamSlots, groupIdx) => (
          <div key={`final-g-${groupIdx}`} className="cbr__board-group">
            {showTeamDividers && groupIdx > 0 && (
              <span className="cbr__lobby-vs cbr__lobby-vs--battle" aria-hidden>
                ×
              </span>
            )}
            <div className="cbr__board-team">
              {teamSlots.map((slot) => {
                const line = lineBySlot.get(slot);
                if (!line) return <div key={slot} className="cbr__final-card cbr__final-card--empty" />;
                const winAmount = displayWinAmount(line, lines, battle);
                return (
                  <FinalPlayerCard
                    key={line.slot}
                    line={line}
                    isJackpot={isJackpot}
                    winAmount={winAmount}
                    teamShare={teamShare}
                    slotShare={slotShare}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
