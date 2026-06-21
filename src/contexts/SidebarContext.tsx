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

/**
 * SidebarContext (v3 "Command Center" redesign)
 * ─────────────────────────────────────────────
 * The sidebar is GONE. The layout is now: topbar + full-width main + a
 * floating dock (desktop) / bottom tab bar (mobile).
 *
 * This context used to drive sidebar drawer/collapse state. It now drives
 * the slide-in panels (chat, user menu, notifications) instead. The export
 * name `useSidebar` is KEPT for backward compatibility — other files
 * (Topbar, AppShell, etc.) import it and we don't want to break them.
 *
 * Legacy fields (`collapsed`, `mobileOpen`, `openMobile`, etc.) are kept as
 * no-op stubs so any consumer that still reads them doesn't crash.
 */

export type SidebarMode = "nav" | "chat";

type PanelKind = "chat" | "user" | null;

type SidebarContextValue = {
  /** Which "mode" the dock is in. Chat mode is rare now (chat is a slide-in
   *  panel), but the field is kept for compat. */
  mode: SidebarMode;
  isChatMode: boolean;
  setMode: (mode: SidebarMode) => void;
  toggleMode: () => void;

  /** Slide-in chat panel — opens from the right. */
  chatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;

  /** Which slide-in panel is currently open (chat / user / none). Only one
   *  panel may be open at a time. */
  activePanel: PanelKind;
  openPanel: (panel: Exclude<PanelKind, null>) => void;
  closePanel: () => void;

  // ── Legacy stubs (no-ops) for backward compatibility ─────────────
  /** Always false — there's no sidebar to collapse anymore. */
  collapsed: false;
  toggleCollapsed: () => void;
  /** Always false — there's no mobile drawer anymore. */
  mobileOpen: false;
  openMobile: () => void;
  closeMobile: () => void;
  toggleMobile: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SidebarMode>("nav");
  const [activePanel, setActivePanel] = useState<PanelKind>(null);
  const { pathname } = useLocation();

  const openPanel = useCallback((panel: Exclude<PanelKind, null>) => {
    setActivePanel(panel);
  }, []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const toggleChat = useCallback(() => {
    setActivePanel((current) => (current === "chat" ? null : "chat"));
  }, []);
  const openChat = useCallback(() => setActivePanel("chat"), []);
  const closeChat = useCallback(() => {
    setActivePanel((current) => (current === "chat" ? null : current));
  }, []);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "nav" ? "chat" : "nav"));
  }, []);

  // Close any open panel on route change — feels natural and prevents the
  // chat panel from lingering after navigating away.
  useEffect(() => {
    setActivePanel(null);
  }, [pathname]);

  // Escape closes any open panel.
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") closePanel();
    }
    if (activePanel) {
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
  }, [activePanel, closePanel]);

  // Toggle a body class so other styles can react to an open panel
  // (e.g. lock scroll). The legacy `lc-sidebar-open` class is kept for
  // backward compat with global.css.
  useEffect(() => {
    const isOpen = activePanel !== null;
    document.body.classList.toggle("lc-sidebar-open", isOpen);
    return () => document.body.classList.remove("lc-sidebar-open");
  }, [activePanel]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      mode,
      isChatMode: mode === "chat",
      setMode,
      toggleMode,
      chatOpen: activePanel === "chat",
      openChat,
      closeChat,
      toggleChat,
      activePanel,
      openPanel,
      closePanel,
      // Legacy no-op stubs
      collapsed: false,
      toggleCollapsed: () => {},
      mobileOpen: false,
      openMobile: () => {},
      closeMobile: () => {},
      toggleMobile: () => {},
    }),
    [
      mode,
      toggleMode,
      activePanel,
      openChat,
      closeChat,
      toggleChat,
      openPanel,
      closePanel,
    ]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
