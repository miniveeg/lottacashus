import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useToast, type Toast } from "../../contexts/ToastContext";
import "./Toast.css";

// ── Single Toast Item ──────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);
  const startX = useRef<number | null>(null);
  const el = useRef<HTMLDivElement>(null);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    const dur = 220;
    setTimeout(() => onDismiss(toast.id), dur);
  }, [toast.id, onDismiss]);

  // Swipe-to-dismiss (touch)
  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 60) handleDismiss();
    startX.current = null;
  }

  const isError = toast.variant === "error";

  return (
    <div
      ref={el}
      role="status"
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={`lc-toast lc-toast--${toast.variant}${exiting ? " lc-toast--exiting" : ""}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {toast.variant === "loading" ? (
        <Loader2 size={16} className="lc-toast__spinner" />
      ) : toast.variant === "success" ? (
        <Check size={16} className="lc-toast__icon" aria-hidden />
      ) : toast.variant === "error" ? (
        <X size={16} className="lc-toast__icon" aria-hidden />
      ) : toast.variant === "warning" ? (
        <AlertTriangle size={16} className="lc-toast__icon" aria-hidden />
      ) : (
        <Info size={16} className="lc-toast__icon" aria-hidden />
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

// ── Toast Region ───────────────────────────────────────────────────────────

export function ToastRegion() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className="lc-toast-region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
