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
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    const dur = 220;
    setTimeout(() => onDismiss(toast.id), dur);
  }, [toast.id, onDismiss]);

  // Swipe-to-dismiss (touch). Visually tracks the finger horizontally so the
  // gesture feels responsive; commits to dismiss past a small threshold.
  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    dragging.current = true;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null || !dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    // Only allow rightward drag (feels natural for toasts on the right).
    setDragX(Math.max(0, dx));
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    dragging.current = false;
    startX.current = null;
    if (Math.abs(dx) > 60) {
      handleDismiss();
    } else {
      setDragX(0); // snap back
    }
  }

  const isError = toast.variant === "error";

  const dragStyle = dragX !== 0 ? { transform: `translateX(${dragX}px)` } : undefined;

  return (
    <div
      role="status"
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={`lc-toast lc-toast--${toast.variant}${exiting ? " lc-toast--exiting" : ""}`}
      style={dragStyle}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
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
    <div className="lc-toast-region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
