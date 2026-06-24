/**
 * Case Battles v2 — Hub (lobby list)
 * Uses realtime subscription (no polling).
 */

import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { Seo } from "../../components/Seo/Seo";
import { useLobbySubscription } from "./useBattleSubscription";
import { gamemodeLabelWithCrazy } from "./types";
import { formatCoins } from "../../lib/format";
import { getCaseById } from "../../lib/games/case-battles";
import { GAMEMODES } from "./types";
import "./CaseBattlesV2.css";

export function CaseBattlesHubV2() {
  const { user } = useAuth();
  const { battles, loading } = useLobbySubscription();

  return (
    <div className="cb-hub lc-page">
      <Seo
        title="Case Battles"
        description="PvP case opens. Pick your mode, stack cases, and battle other players."
        path="/case-battles"
      />
      <header className="cb-hub__header">
        <div>
          <h1 className="cb-hub__title">Case Battles</h1>
          <p className="cb-hub__subtitle">
            Open cases head-to-head. Highest total value wins the pot.
          </p>
        </div>
        <Link to="/case-battles/create" className="cb-hub__create-btn">
          Create battle
        </Link>
      </header>

      {/* Mode legend */}
      <div className="cb-hub__modes">
        {GAMEMODES.map((mode) => (
          <div key={mode.id} className="cb-hub__mode-chip">
            <span className="cb-hub__mode-icon">{mode.icon}</span>
            <div>
              <span className="cb-hub__mode-name">{mode.name}</span>
              <span className="cb-hub__mode-desc">{mode.description}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Lobby list */}
      <div className="cb-hub__list">
        {loading ? (
          <div className="cb-hub__loading">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading battles…</p>
          </div>
        ) : battles.length === 0 ? (
          <div className="cb-hub__empty">
            <p>No active battles right now.</p>
            <Link to="/case-battles/create" className="cb-hub__create-btn">
              Create the first one
            </Link>
          </div>
        ) : (
          battles.map((battle) => {
            const playerCount = (battle as any)._playerCount ?? battle.players.length;
            const firstCase = battle.caseIds[0] ? getCaseById(battle.caseIds[0]) : null;
            return (
              <Link key={battle.battleId} to={`/case-battles/${battle.battleId}`} className="cb-hub__row">
                <div className="cb-hub__row-info">
                  <span className="cb-hub__row-mode">{gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}</span>
                  <span className="cb-hub__row-players">
                    {battle.playerMode.toUpperCase()} · {playerCount}/{battle.maxPlayers}
                  </span>
                </div>
                <div className="cb-hub__row-cases">
                  {battle.caseIds.slice(0, 5).map((cid, i) => {
                    const c = getCaseById(cid);
                    return (
                      <span key={i} className="cb-hub__case-thumb" title={c?.name}>
                        {c?.name?.charAt(0) ?? "?"}
                      </span>
                    );
                  })}
                  {battle.caseIds.length > 5 && (
                    <span className="cb-hub__case-more">+{battle.caseIds.length - 5}</span>
                  )}
                </div>
                <div className="cb-hub__row-pot">
                  <span className="cb-hub__pot-label">Pot</span>
                  <span className="cb-hub__pot-value">{formatCoins(battle.potTotal, "balance")}</span>
                </div>
                <div className="cb-hub__row-status">
                  <span className={`cb-status cb-status--${battle.status}`}>{battle.status}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
