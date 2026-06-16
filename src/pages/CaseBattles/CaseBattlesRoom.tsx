import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { viewCaseBattle, type CaseBattleView } from "../../lib/caseBattles";
import { CaseBattleArena } from "./CaseBattleArena";
import { CaseBattlesTopbar } from "./CaseBattlesTopbar";
import { gamemodeLabel } from "./caseBattlesUi";
import "./CaseBattlesPages.css";
import "./CaseBattlesRoom.css";

export function CaseBattlesRoom() {
  const { battleId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();

  const [battle, setBattle] = useState<CaseBattleView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBattle = useCallback(async (id: string, cancelled?: () => boolean) => {
    const { data, error: viewErr } = await viewCaseBattle(id);
    if (cancelled?.()) return;
    if (data) {
      setBattle(data);
      setError(null);
    } else {
      setBattle(null);
      setError(viewErr ?? "Could not load battle.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!battleId) return;
    let stale = false;
    setLoading(true);
    setBattle(null);
    void loadBattle(battleId, () => stale);
    return () => {
      stale = true;
    };
  }, [battleId, loadBattle]);

  useEffect(() => {
    if (
      !battle ||
      !["waiting", "running", "pending_eos", "pending_jackpot_eos"].includes(battle.status)
    )
      return;
    const pollMs =
      battle.status === "pending_eos" || battle.status === "pending_jackpot_eos" ? 600 : 1500;
    const id = window.setInterval(async () => {
      const { data } = await viewCaseBattle(battle.battleId);
      if (!data) return;
      setBattle(data);
      if (data.status === "completed") {
        setError(null);
        window.clearInterval(id);
        void refreshProfile();
      } else if (data.status === "pending_jackpot_eos" && data.players.some((p) => p.drops.length > 0)) {
        setError(null);
      }
    }, pollMs);
    return () => window.clearInterval(id);
  }, [battle?.battleId, battle?.status]);

  if (!battleId) {
    return <Navigate to="/case-battles" replace />;
  }

  const balance = profile?.balance ?? 0;
  const subtitle = battle
    ? `${battle.playerMode.toUpperCase()} · ${gamemodeLabel(battle.gamemode)}`
    : undefined;
  const battleReady = battle != null && battle.battleId === battleId;

  return (
    <div className="cb-page cb-page--compact cbr">
      <CaseBattlesTopbar
        backTo="/case-battles"
        backLabel="Battles"
        title="Battle room"
        subtitle={subtitle}
      />

      {error && !loading && !battleReady ? (
        <div className="lc-empty cbr__empty">
          <p className="cb-page__error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="cb-page__btn-primary"
            onClick={() => {
              setLoading(true);
              setError(null);
              void loadBattle(battleId);
            }}
          >
            Retry
          </button>
          <Link to="/case-battles" className="lc-btn lc-btn--ghost">
            Back to battles
          </Link>
        </div>
      ) : loading || !battleReady ? (
        <div className="lc-loading cbr__loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading battle…</p>
        </div>
      ) : (
        <CaseBattleArena
          battle={battle!}
          userId={user?.id}
          balance={balance}
          onBattleUpdate={(next) => {
            setBattle(next);
            if (next.status === "completed" || next.status === "running") {
              setError(null);
            }
          }}
          onError={setError}
          onPayoutClaimed={() => void refreshProfile()}
          onComplete={() => navigate("/case-battles")}
        />
      )}
    </div>
  );
}