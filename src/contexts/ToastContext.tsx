import {
  createContext,
  useCallback,
  useContext,
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
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
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

  return (
    <ToastContext.Provider
      value={{ toasts, toast, success, error, info, warning, loading, dismiss, resolve, promise }}
    >
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
