import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useToast, type Toast } from "../../contexts/ToastContext";
import "./Toast.css";

// ── Single Toast Item ──────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItemImpl({ toast, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);
  const startX = useRef<number | null>(null);
  // Track the exit-animation timer so we can clear it on unmount. Without this,
  // a toast that is evicted by the ToastContext (e.g. via auto-dismiss) while
  // its 220ms exit animation is pending would still fire `onDismiss(toast.id)`
  // after it's already gone — a no-op, but a leaked closure holding the toast
  // object and onDismiss callback in memory until the timer fires.
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      onDismiss(toast.id);
    }, 220);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    return () => {
      if (exitTimer.current !== null) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, []);

  // Swipe-to-dismiss (touch)
  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    startX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      if (startX.current === null) return;
      const dx = e.changedTouches[0].clientX - startX.current;
      if (Math.abs(dx) > 60) handleDismiss();
      startX.current = null;
    },
    [handleDismiss]
  );

  const isError = toast.variant === "error";

  // `role="alert"` is implicitly aria-live="assertive" + aria-atomic="true";
  // `role="status"` is implicitly aria-live="polite" + aria-atomic="true".
  // Using the correct role per variant avoids the conflicting setup that the
  // previous code had (role="status" — polite — paired with aria-live="assertive"
  // on error toasts, which screen readers resolve inconsistently).
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-atomic="true"
      className={`lc-toast lc-toast--${toast.variant}${exiting ? " lc-toast--exiting" : ""}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {toast.variant === "loading" ? (
        <Loader2 size={18} className="lc-toast__spinner" aria-hidden />
      ) : toast.variant === "success" ? (
        <Check size={18} className="lc-toast__icon" aria-hidden />
      ) : toast.variant === "error" ? (
        <X size={18} className="lc-toast__icon" aria-hidden />
      ) : toast.variant === "warning" ? (
        <AlertTriangle size={18} className="lc-toast__icon" aria-hidden />
      ) : (
        <Info size={18} className="lc-toast__icon" aria-hidden />
      )}

      <div className="lc-toast__body">
        <p className="lc-toast__message">{toast.message}</p>
      </div>

      <button
        type="button"
        className="lc-toast__close"
        aria-label="Dismiss notification"
        onClick={handleDismiss}
      >
        <X size={12} />
      </button>
    </div>
  );
}

const ToastItem = memo(ToastItemImpl);
ToastItem.displayName = "ToastItem";

// ── Toast Region ───────────────────────────────────────────────────────────

export function ToastRegion() {
  const { toasts, dismiss } = useToast();

  // The region is always rendered (even when empty) so screen readers discover
  // it at page load. The container is a polite live region so additions are
  // announced; individual error toasts additionally carry `role="alert"`,
  // which establishes a nested assertive live region that overrides the
  // container's polite setting for that subtree (so errors are announced
  // assertively without needing a second visual stack).
  return (
    <div
      className="lc-toast-region"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
