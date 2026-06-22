import type { CaseBattlePlayer, CaseBattleView } from "../../lib/caseBattles";
import { battleSlotGroups } from "./caseBattlesUi";
import { Bot, User } from "lucide-react";

type CaseBattleLobbySlotsProps = {
  battle: CaseBattleView;
  userId: string | undefined;
  isCreator: boolean;
  pendingBotSlots: ReadonlySet<number>;
  onAddBot: (slotIndex: number) => void;
};

function LobbySlot({
  slot,
  occupant,
  userId,
  isCreator,
  isPending,
  onAddBot,
}: {
  slot: number;
  occupant: CaseBattlePlayer | undefined;
  userId: string | undefined;
  isCreator: boolean;
  isPending: boolean;
  onAddBot: (slotIndex: number) => void;
}) {
  const isYou = occupant?.userId === userId;

  return (
    <div
      className={
        "cbr__slot" +
        (occupant ? " cbr__slot--filled" : " cbr__slot--empty") +
        (isYou ? " cbr__slot--you" : "")
      }
    >
      <span className="cbr__slot-index">Slot {slot + 1}</span>
      {occupant ? (
        <>
          <span
            className={"cbr__slot-avatar" + (occupant.isBot ? " cbr__slot-avatar--bot" : "")}
            aria-hidden
          >
            {occupant.isBot ? <Bot size={14} /> : <User size={14} />}
          </span>
          <span className="cbr__slot-name">{occupant.displayName}</span>
          {occupant.isBot && <span className="cbr__slot-tag">Bot</span>}
          {!occupant.isBot && (occupant.borrowPercent ?? 0) > 0 && (
            <span className="cbr__slot-tag">{occupant.borrowPercent}% borrow</span>
          )}
          {isYou && <span className="cbr__slot-tag cbr__slot-tag--you">You</span>}
        </>
      ) : isCreator ? (
        <button
          type="button"
          className="cbr__slot-add-bot"
          disabled={isPending}
          onClick={() => onAddBot(slot)}
        >
          {isPending ? "…" : "+ Call bot"}
        </button>
      ) : (
        <span className="cbr__slot-wait">Waiting…</span>
      )}
    </div>
  );
}

export function CaseBattleLobbySlots({
  battle,
  userId,
  isCreator,
  pendingBotSlots,
  onAddBot,
}: CaseBattleLobbySlotsProps) {
  const groups = battleSlotGroups(battle.playerMode, battle.gamemode, battle.maxPlayers);
  const showDividers = battle.gamemode !== "group" && groups.length > 1;

  return (
    <div className="cbr__lobby" aria-label="Battle slots" data-count={battle.maxPlayers}>
      {groups.map((teamSlots, groupIdx) => (
        <div key={groupIdx} className="cbr__lobby-group">
          {showDividers && groupIdx > 0 && (
            <span className="cbr__lobby-vs" aria-hidden>
              ×
            </span>
          )}
          <div className="cbr__lobby-team">
            {teamSlots.map((slot) => (
              <LobbySlot
                key={slot}
                slot={slot}
                occupant={battle.players.find((p) => p.slot === slot)}
                userId={userId}
                isCreator={isCreator}
                isPending={pendingBotSlots.has(slot)}
                onAddBot={onAddBot}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
