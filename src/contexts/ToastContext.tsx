import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info" | "warning" | "loading";

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  duration?: number; // ms; 0 = no auto-dismiss
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, variant?: ToastVariant, duration?: number) => string;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  loading: (message: string) => string;
  dismiss: (id: string) => void;
  /** Resolve a loading toast to a success/error */
  resolve: (id: string, message: string, variant?: "success" | "error") => void;
  /** Promise helper: shows loading → resolves to success/error */
  promise: <T>(
    p: Promise<T>,
    messages: { loading: string; success: string; error: string }
  ) => Promise<T>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 3500,
  error: 5000,
  info: 4000,
  warning: 4500,
  loading: 0,
};

let _idCounter = 0;
function genId() {
  return `toast-${++_idCounter}-${Date.now()}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info", duration?: number): string => {
      const id = genId();
      const dur = duration !== undefined ? duration : DEFAULT_DURATIONS[variant];

      // Prevent duplicate messages (same variant + message already visible)
      setToasts((prev) => {
        const dup = prev.find((t) => t.message === message && t.variant === variant);
        if (dup) return prev;
        const next: Toast = { id, variant, message, duration: dur };
        // Cap queue at 5
        const capped = prev.length >= 5 ? prev.slice(1) : prev;
        return [...capped, next];
      });

      if (dur > 0) {
        const timer = setTimeout(() => dismiss(id), dur);
        timers.current.set(id, timer);
      }

      return id;
    },
    [dismiss]
  );

  // Reconcile timers with the active toast list: when toasts are evicted by the
  // 5-item cap (or removed by other means), clear any lingering timers so we
  // don't hold timer closures in memory after the toast is gone.
  useEffect(() => {
    const activeIds = new Set(toasts.map((t) => t.id));
    for (const [id, timer] of timers.current) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [toasts]);

  // Clear all pending timers on unmount to prevent the timers map from leaking.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const success = useCallback(
    (message: string, duration?: number) => toast(message, "success", duration),
    [toast]
  );
  const error = useCallback(
    (message: string, duration?: number) => toast(message, "error", duration),
    [toast]
  );
  const info = useCallback(
    (message: string, duration?: number) => toast(message, "info", duration),
    [toast]
  );
  const warning = useCallback(
    (message: string, duration?: number) => toast(message, "warning", duration),
    [toast]
  );
  const loading = useCallback((message: string) => toast(message, "loading", 0), [toast]);

  const resolve = useCallback(
    (id: string, message: string, variant: "success" | "error" = "success") => {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      const dur = DEFAULT_DURATIONS[variant];
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, variant, message, duration: dur } : t))
      );
      const timer = setTimeout(() => dismiss(id), dur);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const promise = useCallback(
    async <T,>(
      p: Promise<T>,
      messages: { loading: string; success: string; error: string }
    ): Promise<T> => {
      const id = loading(messages.loading);
      try {
        const result = await p;
        resolve(id, messages.success, "success");
        return result;
      } catch (err) {
        resolve(id, messages.error, "error");
        throw err;
      }
    },
    [loading, resolve]
  );

  // PERFORMANCE: memoize the context value so consumers only re-render when
  // the `toasts` array changes (or when one of the stable callbacks changes,
  // which is never — they're all useCallback'd). The previous literal
  // `value={{...}}` re-rendered every consumer on EVERY toast event, even
  // when the toast array was unchanged.
  const value = useMemo<ToastContextValue>(
    () => ({ toasts, toast, success, error, info, warning, loading, dismiss, resolve, promise }),
    [toasts, toast, success, error, info, warning, loading, dismiss, resolve, promise]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
