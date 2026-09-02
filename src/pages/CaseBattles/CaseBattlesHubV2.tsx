/**
 * Case Battles — Hub (lobby)
 * Dense cases.gg-style lobby on felt chrome. GC/SC filtered via usePlayMode.
 */
import { Link } from "react-router-dom";
import { Seo } from "../../components/Seo/Seo";
import { useLobbySubscription } from "./useBattleSubscription";
import { gamemodeLabelWithCrazy, GAMEMODES } from "./types";
import { formatCoins } from "../../lib/format";
import { getCaseById } from "../../lib/games/case-battles";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { expectedKeepPot } from "./caseBattlesApi";
import "./CaseBattlesV2.css";

export function CaseBattlesHubV2() {
  const { coinType, label: coinLabel } = usePlayMode();
  const { battles, loading } = useLobbySubscription({ coinType });

  return (
    <div className="cb-hub lc-page lc-page--wide">
      <Seo
        title="Case Battles"
        description="PvP case opens. Pick your mode, stack cases, and battle other players."
        path="/case-battles"
      />

      <header className="cb-hub__header">
        <div className="cb-hub__header-copy">
          <p className="cb-hub__eyebrow">Originals · Felt floor</p>
          <h1 className="cb-hub__title">Case Battles</h1>
          <p className="cb-hub__subtitle">
            Stack cases, fill seats, open in lockstep. Showing {coinLabel} lobbies.
          </p>
        </div>
        <Link to="/case-battles/create" className="cb-btn cb-btn--primary cb-hub__create-btn">
          Create battle
        </Link>
      </header>

      <div className="cb-hub__felt">
        <div className="cb-hub__modes" aria-label="Battle modes">
          {GAMEMODES.map((mode) => (
            <div key={mode.id} className="cb-hub__mode-chip">
              <span className="cb-hub__mode-icon" aria-hidden>
                {mode.icon}
              </span>
              <div>
                <span className="cb-hub__mode-name">{mode.name}</span>
                <span className="cb-hub__mode-desc">{mode.description}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="cb-hub__list" role="list">
          {loading ? (
            <div className="cb-hub__loading" aria-live="polite">
              <div className="lc-loading__pulse" aria-hidden />
              <p>Loading {coinLabel} battles…</p>
            </div>
          ) : battles.length === 0 ? (
            <div className="cb-hub__empty">
              <p>No open battles on the floor.</p>
              <p className="cb-hub__empty-hint">
                Stack cases, pick a mode, and put a pot in play.
              </p>
              <Link to="/case-battles/create" className="cb-btn cb-btn--primary">
                Create battle
              </Link>
            </div>
          ) : (
            battles.map((battle) => {
              const keepPot = expectedKeepPot(battle);
              return (
                <Link
                  key={battle.battleId}
                  to={`/case-battles/${battle.battleId}`}
                  className="cb-hub__row"
                  role="listitem"
                >
                  <div className="cb-hub__row-info">
                    <span className="cb-hub__row-mode">
                      {gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}
                    </span>
                    <span className="cb-hub__row-players">
                      {battle.playerMode.toUpperCase()} · {battle.playerCount}/{battle.maxPlayers}
                      {battle.borrowPercent > 0 ? ` · Borrow ${battle.borrowPercent}%` : ""}
                    </span>
                  </div>
                  <div className="cb-hub__row-cases" aria-hidden>
                    {battle.caseIds.slice(0, 6).map((cid, i) => {
                      const c = getCaseById(cid);
                      return (
                        <span
                          key={`${cid}-${i}`}
                          className="cb-hub__case-thumb"
                          style={{ borderColor: c?.accent ?? "var(--lc-border)" }}
                          title={c?.name}
                        >
                          {c?.name?.charAt(0) ?? "?"}
                        </span>
                      );
                    })}
                    {battle.caseIds.length > 6 && (
                      <span className="cb-hub__case-more">+{battle.caseIds.length - 6}</span>
                    )}
                  </div>
                  <div className="cb-hub__row-pot">
                    <span className="cb-hub__pot-label">
                      {battle.borrowPercent > 0 ? "Keep pot" : "Pot"}
                    </span>
                    <span className="cb-hub__pot-value">
                      {formatCoins(keepPot, battle.coinType)}
                    </span>
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
    </div>
  );
}
