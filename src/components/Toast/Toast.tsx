import { useCallback, useRef, useState } from "react";
import { useToast, type Toast } from "../../contexts/ToastContext";
import "./Toast.css";

// ── Icons ──────────────────────────────────────────────────────────────────

function IconSuccess() {
  return (
    <svg className="lc-toast__icon" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconError() {
  return (
    <svg className="lc-toast__icon" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg className="lc-toast__icon" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 2L18.66 17H1.34L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8v4M10 14.5v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg className="lc-toast__icon" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5M10 6v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

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
        <span className="lc-toast__spinner" aria-hidden />
      ) : toast.variant === "success" ? (
        <IconSuccess />
      ) : toast.variant === "error" ? (
        <IconError />
      ) : toast.variant === "warning" ? (
        <IconWarning />
      ) : (
        <IconInfo />
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
        <IconClose />
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
