import { useEffect } from "react";

const POLL_MS = 2000;

/** Poll lobby on an interval and whenever the tab becomes visible again. */
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

    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, loadLobby]);
}
