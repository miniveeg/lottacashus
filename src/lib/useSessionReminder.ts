import { useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { trackSessionActivity, getSessionDuration } from "./responsibleGaming";

const REMINDER_INTERVAL_MS = 60000;

type ToastOptions = { duration?: number };

export function useSessionReminder() {
  const { user } = useAuth();
  const toast = useToast();
  const oneHourShown = useRef(false);

  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      await trackSessionActivity();

      const durationMs = await getSessionDuration(user.id);
      const hours = durationMs / 3600000;

      if (hours >= 1 && !oneHourShown.current) {
        oneHourShown.current = true;
        const opts: ToastOptions = { duration: 8000 };
        toast.info(
          "You have been playing for 1 hour. Consider taking a break.",
          opts.duration
        );
      }
    }, REMINDER_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      oneHourShown.current = false;
    };
  }, [user, toast]);
}
