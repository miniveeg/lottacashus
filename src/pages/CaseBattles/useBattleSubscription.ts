/**
 * Case Battles v2 — realtime hooks.
 * Replaces the old 1.5s polling with Supabase realtime subscriptions.
 * Battle updates push instantly — zero polling lag.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { viewCaseBattle, listOpenBattles } from "./caseBattlesApi";
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

  // Local-play polling: when the battle exists in the local in-memory store
  // (no realtime subscription will fire), poll every 400ms so the UI picks up
  // state changes (add bot, start, resolve, claim).
  useEffect(() => {
    if (!battleId) return;
    let active = true;
    const iv = setInterval(async () => {
      if (!active) return;
      const { localViewCaseBattle } = await import("../../lib/local-case-battles");
      const local = localViewCaseBattle(battleId);
      if (local) await fetchBattle();
    }, 400);
    return () => { active = false; clearInterval(iv); };
  }, [battleId, fetchBattle]);

  return { battle, loading, error, refetch: fetchBattle };
}

/**
 * Subscribes to the lobby list (all open battles).
 * Returns the list + a manual refresh function.
 *
 * Optionally filters by `coinType` so the user only sees battles in the
 * currency they currently have selected (driven by `usePlayMode()`).
 */
export function useLobbySubscription(options?: {
  coinType?: "balance" | "sweeps_coins";
}) {
  const [battles, setBattles] = useState<CaseBattleView[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);
  const coinType = options?.coinType;

  const fetchLobby = useCallback(async () => {
    const { data, error } = await listOpenBattles(
      coinType ? { coinType } : undefined,
    );
    if (cancelledRef.current) return;
    if (error || !data) {
      setBattles([]);
    } else {
      setBattles(data);
    }
    setLoading(false);
  }, [coinType]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setBattles([]);
    fetchLobby();

    if (!isSupabaseConfigured) {
      // Local-play polling: refresh lobby every 1s to pick up new local battles.
      const iv = setInterval(() => fetchLobby(), 1000);
      return () => { cancelledRef.current = true; clearInterval(iv); };
    }

    // Filter the lobby subscription to only receive events for battles the
    // user can actually see in the lobby (status waiting/committing/running).
    // Without this filter, Supabase broadcasts EVERY case_battles change to
    // EVERY client — at 1000+ rooms this is N² traffic. The filter pushes
    // filtering server-side so each client only receives relevant events.
    // (Completed/cancelled battles no longer broadcast to lobby subscribers.)
    const channel = supabase
      .channel("lobby")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "case_battles",
          filter: "status=in.(waiting,committing,running)",
        },
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
