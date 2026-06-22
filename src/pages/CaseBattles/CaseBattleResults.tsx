import { Bot, User } from "lucide-react";
import { formatCoins } from "../../lib/format";
import type { CaseBattleView } from "../../lib/caseBattles";
import { gamemodeLabel } from "./caseBattlesUi";
import {
  battleTotalUnboxed,
  buildPlayerResultLines,
  displayWinAmount,
  teamWinnerEqualShare,
  type PlayerResultLine,
} from "./battleResultHelpers";

type CaseBattleResultsProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  layout?: "stacked" | "columns";
  slotGroups?: number[][];
  showTeamDividers?: boolean;
};

function PlayerResultColumn({
  line,
  isJackpot,
  winAmount,
  teamShare,
}: {
  line: PlayerResultLine;
  isJackpot: boolean;
  winAmount: number;
  teamShare: number;
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
        "cbr__result-col" +
        (line.isYou ? " cbr__result-col--you" : "") +
        (line.isWinner ? " cbr__result-col--winner" : "")
      }
    >
      <div className="cbr__result-col-head">
        <span className="cbr__result-col-avatar" aria-hidden>{line.isBot ? <Bot size={14} /> : <User size={14} />}</span>
        <span className="cbr__result-col-name">
          {line.displayName}
          {line.isYou ? " (you)" : ""}
        </span>
        {line.isWinner && <span className="cbr__result-col-badge">Winner</span>}
      </div>
      <div className="cbr__result-col-body">
        <p className="cbr__result-col-unboxed">
          Unboxed <strong>{formatCoins(line.unboxedTotal, "balance")}</strong>
        </p>
        {isJackpot && line.jackpotPct != null && (
          <p className="cbr__result-col-jp">{line.jackpotPct}% jackpot odds</p>
        )}
        {line.borrowPercent > 0 && (
          <p className="cbr__result-col-borrow">
            {line.borrowPercent}% borrow
            {line.entryPaid != null ? ` · paid ${formatCoins(line.entryPaid, "balance")}` : ""}
          </p>
        )}
        <p
          className={
            "cbr__result-col-payout" + (winAmount > 0 ? " cbr__result-col-payout--win" : "")
          }
        >
          {winAmount > 0 ? `Won ${formatCoins(winAmount, "balance")}` : line.isWinner ? "Won —" : "—"}
        </p>
        {showTeamShareNote && (
          <p className="cbr__result-col-borrow-note">Team share {formatCoins(teamShare, "balance")}</p>
        )}
      </div>
    </div>
  );
}

export function CaseBattleResultsSummary({ battle }: { battle: CaseBattleView }) {
  const isJackpot = battle.gamemode === "jackpot";
  const resultData = battle.results as { jackpotReelSlot?: number } | null;
  const jackpotLandedSlot = resultData?.jackpotReelSlot ?? battle.winnerSlot;

  return (
    <>
      <h3 className="cbr__results-title">Final results</h3>
      <p className="cbr__results-sub">
        {gamemodeLabel(battle.gamemode)} · Total unboxed {formatCoins(battleTotalUnboxed(battle), "balance")}
        {isJackpot && jackpotLandedSlot != null && (
          <>
            {" "}
            · Jackpot landed on{" "}
            <strong>
              {battle.players.find((p) => p.slot === jackpotLandedSlot)?.displayName ?? "—"}
            </strong>
          </>
        )}
      </p>
    </>
  );
}

export function CaseBattleResults({
  battle,
  userId,
  layout = "stacked",
  slotGroups,
  showTeamDividers = false,
}: CaseBattleResultsProps) {
  const lines = buildPlayerResultLines(battle, userId);
  const lineBySlot = new Map(lines.map((l) => [l.slot, l]));
  const isJackpot = battle.gamemode === "jackpot";
  const teamShare = teamWinnerEqualShare(lines, battle);

  if (layout === "columns" && slotGroups) {
    return (
      <div className="cbr__results-board" aria-label="Battle results">
        <div className="cbr__results-board-head">
          <CaseBattleResultsSummary battle={battle} />
        </div>
        <div className="cbr__results-board-cols">
          {slotGroups.map((teamSlots, groupIdx) => (
            <div key={`res-g-${groupIdx}`} className="cbr__board-group">
              {showTeamDividers && groupIdx > 0 && (
                <span className="cbr__lobby-vs cbr__lobby-vs--battle" aria-hidden>
                  ×
                </span>
              )}
              <div className="cbr__board-team">
                {teamSlots.map((slot) => {
                  const line = lineBySlot.get(slot);
                  if (!line) return null;
                  const winAmount = displayWinAmount(line, lines, battle);
                  return (
                    <PlayerResultColumn
                      key={line.slot}
                      line={line}
                      isJackpot={isJackpot}
                      winAmount={winAmount}
                      teamShare={teamShare}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="cbr__results" aria-label="Battle results">
      <CaseBattleResultsSummary battle={battle} />
      <ul className="cbr__results-list">
        {lines.map((line) => {
          const winAmount = displayWinAmount(line, lines, battle);
          const showTeamShareNote =
            line.isWinner &&
            line.borrowPercent > 0 &&
            teamShare > 0 &&
            winAmount > 0 &&
            Math.abs(winAmount - teamShare) > 0.01;
          return (
            <li
              key={line.slot}
              className={
                "cbr__results-row" +
                (line.isWinner ? " cbr__results-row--winner" : "") +
                (line.isYou ? " cbr__results-row--you" : "")
              }
            >
              <div className="cbr__results-player">
                <span className="cbr__results-avatar" aria-hidden>{line.isBot ? <Bot size={14} /> : <User size={14} />}</span>
                <div className="cbr__results-meta">
                  <span className="cbr__results-name">
                    {line.displayName}
                    {line.isYou ? " (you)" : ""}
                  </span>
                  <span className="cbr__results-unboxed">
                    Unboxed {formatCoins(line.unboxedTotal, "balance")}
                  </span>
                </div>
              </div>
              <div className="cbr__results-outcome">
                {isJackpot && line.jackpotPct != null && (
                  <span className="cbr__results-jp-pct">{line.jackpotPct}% odds</span>
                )}
                {line.borrowPercent > 0 && (
                  <span className="cbr__results-borrow">
                    {line.borrowPercent}% borrow
                    {line.entryPaid != null ? ` · paid ${formatCoins(line.entryPaid, "balance")}` : ""}
                  </span>
                )}
                <span
                  className={
                    "cbr__results-payout" + (winAmount > 0 ? " cbr__results-payout--win" : "")
                  }
                >
                  {winAmount > 0 ? `Won ${formatCoins(winAmount, "balance")}` : line.isWinner ? "Won —" : "—"}
                </span>
                {showTeamShareNote && (
                  <span className="cbr__results-borrow-note">Team share {formatCoins(teamShare, "balance")}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
