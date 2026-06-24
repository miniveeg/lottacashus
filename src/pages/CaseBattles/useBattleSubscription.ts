/**
 * Case Battles v2 — realtime hooks.
 * Replaces the old 1.5s polling with Supabase realtime subscriptions.
 * Battle updates push instantly — zero polling lag.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { viewCaseBattle } from "./caseBattlesApi";
import type { CaseBattleView } from "./types";

/**
 * Subscribes to a single battle's realtime updates.
 * Returns the latest battle state. Re-fetches on any change to the battle,
 * its players, or its drops.
 */
export function useBattleSubscription(battleId: string | undefined): {
  battle: CaseBattleView | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [battle, setBattle] = useState<CaseBattleView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const fetchBattle = useCallback(async () => {
    if (!battleId || cancelledRef.current) return;
    const { data, error: err } = await viewCaseBattle(battleId);
    if (cancelledRef.current) return;
    if (err) {
      setError(err);
      setBattle(null);
    } else {
      setError(null);
      setBattle(data);
    }
    setLoading(false);
  }, [battleId]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setBattle(null);
    setError(null);
    fetchBattle();

    if (!isSupabaseConfigured || !battleId) return;

    // Subscribe to all three tables for this battle. Any change triggers a
    // single re-fetch (the fetch is debounced by React's state batching).
    const channel = supabase
      .channel(`battle-${battleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_battles", filter: `id=eq.${battleId}` },
        () => fetchBattle(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_battle_players", filter: `battle_id=eq.${battleId}` },
        () => fetchBattle(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_battle_drops", filter: `battle_id=eq.${battleId}` },
        () => fetchBattle(),
      )
      .subscribe();

    return () => {
      cancelledRef.current = true;
      supabase.removeChannel(channel);
    };
  }, [battleId, fetchBattle]);

  return { battle, loading, error, refetch: fetchBattle };
}

/**
 * Subscribes to the lobby list (all open battles).
 * Returns the list + a manual refresh function.
 */
export function useLobbySubscription() {
  const [battles, setBattles] = useState<CaseBattleView[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const fetchLobby = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("case_battles")
      .select("*")
      .in("status", ["waiting", "committing", "running"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (cancelledRef.current) return;
    if (error) {
      setBattles([]);
    } else if (data) {
      // Fetch player counts
      const ids = data.map((r) => r.id);
      let playersByBattle = new Map<string, number>();
      if (ids.length > 0) {
        const { data: players } = await supabase
          .from("case_battle_players")
          .select("battle_id")
          .in("battle_id", ids);
        if (players) {
          for (const p of players) {
            const bid = p.battle_id as string;
            playersByBattle.set(bid, (playersByBattle.get(bid) ?? 0) + 1);
          }
        }
      }
      const views: CaseBattleView[] = data.map((row) => ({
        battleId: String(row.id),
        creatorId: String(row.creator_id ?? ""),
        gamemode: row.gamemode as CaseBattleView["gamemode"],
        crazy: Boolean(row.crazy),
        playerMode: String(row.player_mode),
        maxPlayers: Number(row.max_players),
        caseIds: (row.case_ids as string[]) ?? [],
        rounds: Number(row.rounds),
        entryCost: Number(row.entry_cost),
        borrowPercent: Number(row.borrow_percent ?? 0),
        potTotal: Number(row.pot_total ?? 0),
        status: row.status as CaseBattleView["status"],
        seedHash: row.seed_hash ?? null,
        eosBlockTarget: row.eos_block_target ?? null,
        eosBlockId: row.eos_block_id ?? null,
        battleSeed: row.battle_seed ?? null,
        createdAt: String(row.created_at),
        startedAt: row.started_at ?? null,
        completedAt: row.completed_at ?? null,
        players: [],
        drops: [],
      }));
      // Attach player count as a synthetic field (we don't need full player
      // objects in the lobby — just the count for display)
      (views as any[]).forEach((v) => {
        v._playerCount = playersByBattle.get(v.battleId) ?? 0;
      });
      setBattles(views);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    fetchLobby();

    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel("lobby")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_battles" },
        () => fetchLobby(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_battle_players" },
        () => fetchLobby(),
      )
      .subscribe();

    return () => {
      cancelledRef.current = true;
      supabase.removeChannel(channel);
    };
  }, [fetchLobby]);

  return { battles, loading, refetch: fetchLobby };
}
