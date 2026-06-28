import { useEffect } from "react";

const POLL_MS = 2000;

/** Poll lobby on an interval and whenever the tab becomes visible again.
 *
 * The `focus` event listener was removed (audit H1) — it fired a lobby
 * refetch every time the user alt-tabbed back to the tab, which is
 * excessive. The realtime subscription in useLobbySubscription covers
 * instant updates, the 2 s poll covers the rest, and `visibilitychange`
 * still fires one refetch when the user returns to the tab. */
export function useCaseBattlesLobbyPoll(
  enabled: boolean,
  loadLobby: () => void | Promise<void>
) {
  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      void loadLobby();
    };

    tick();

    const intervalId = window.setInterval(tick, POLL_MS);

    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, loadLobby]);
}
