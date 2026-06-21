import { useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import {
  trackSessionActivity,
  getSessionDuration,
  resetSessionTracking,
} from "./responsibleGaming";

/** How often to poll the session duration and check whether a reminder is
 *  due. 60s keeps the polling cost negligible while still landing the
 *  reminder within a minute of the threshold. */
const REMINDER_INTERVAL_MS = 60000;

/** Session-duration threshold (in hours) at which to fire the reminder. */
const REMINDER_THRESHOLD_HOURS = 1;

/** Toast display duration for the reminder. */
const REMINDER_TOAST_DURATION_MS = 8000;

/**
 *  Periodically checks the signed-in user's session duration and surfaces a
 *  toast reminder once they've been playing for >= 1 hour.
 *
 *  - No-op when not signed in (the `useAuth().user` guard short-circuits).
 *  - Cleans up its interval on unmount / sign-out, and clears the per-user
 *    session-start tracking so a subsequent sign-in as the same user starts
 *    a fresh session.
 *  - Uses a `cancelledRef` to prevent a toast firing after the user has
 *    signed out (the interval callback is async — without the guard, an
 *    in-flight callback could call `toast.info()` between `user` going null
 *    and the cleanup running).
 *  - `oneHourShown.current` is reset on cleanup so the reminder fires again
 *    if the user signs out and back in (correct UX — each session gets its
 *    own reminder).
 */
export function useSessionReminder() {
  const { user } = useAuth();
  // Destructure `info` (a stable `useCallback`-memoized function from
  // ToastProvider) rather than holding the whole `toast` context value.
  // The context value object is recreated whenever the toast LIST changes
  // (every toast added/dismissed anywhere in the app), so depending on the
  // whole `toast` object would tear down and re-create this effect's
  // interval — calling `resetSessionTracking(user.id)` in cleanup and
  // `trackSessionActivity(user.id)` on re-mount, which silently resets the
  // session-duration clock to zero. The 1-hour reminder would then never
  // fire as long as any toast appeared during the hour. Depending on just
  // `info` (stable across toast-list changes) keeps the interval alive.
  const { info } = useToast();
  const oneHourShown = useRef(false);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    // Mark this user's session as active (sets the start timestamp on first
    // sight; no-op on subsequent ticks).
    void trackSessionActivity(user.id);

    const interval = setInterval(async () => {
      if (cancelled) return;
      const durationMs = await getSessionDuration(user.id);
      if (cancelled) return;

      const hours = durationMs / 3_600_000;
      if (hours >= REMINDER_THRESHOLD_HOURS && !oneHourShown.current) {
        oneHourShown.current = true;
        info(
          "You have been playing for 1 hour. Consider taking a break.",
          REMINDER_TOAST_DURATION_MS
        );
      }
    }, REMINDER_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      oneHourShown.current = false;
      // Clear this user's session-start so a future sign-in (same user,
      // same page session) starts a fresh 1-hour timer.
      resetSessionTracking(user.id);
    };
  }, [user, info]);
}
