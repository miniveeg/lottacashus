import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

export type SidebarMode = "nav" | "chat";

type SidebarContextValue = {
  mode: SidebarMode;
  isChatMode: boolean;
  setMode: (mode: SidebarMode) => void;
  toggleMode: () => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
  toggleMobile: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const COLLAPSED_KEY = "lc-sidebar-collapsed";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SidebarMode>("nav");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const { pathname } = useLocation();

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((open) => !open), []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "nav" ? "chat" : "nav"));
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("lc-sidebar-open", mobileOpen);
    return () => document.body.classList.remove("lc-sidebar-open");
  }, [mobileOpen]);

  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") closeMobile();
    }
    if (mobileOpen) {
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
  }, [mobileOpen, closeMobile]);

  const value = useMemo(
    () => ({
      mode,
      isChatMode: mode === "chat",
      setMode,
      toggleMode,
      collapsed,
      toggleCollapsed,
      mobileOpen,
      openMobile,
      closeMobile,
      toggleMobile,
    }),
    [mode, toggleMode, collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile, toggleMobile]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
