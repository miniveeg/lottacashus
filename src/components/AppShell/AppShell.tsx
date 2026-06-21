import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider } from "../../contexts/SidebarContext";
import { isGuestBrowsableGamePath } from "../../content/originals";
import { useSessionReminder } from "../../lib/useSessionReminder";
import { AffiliateRefCapture } from "../AffiliateRefCapture/AffiliateRefCapture";
import { AtmosphericLayer } from "../atmosphere/AtmosphericLayer";
import { SmoothScroll } from "../atmosphere/SmoothScroll";
import { GameGuestBanner } from "../GameGuestBanner/GameGuestBanner";
import { Topbar } from "../Topbar/Topbar";
import { Dock, MobileTabBar } from "../Sidebar/Sidebar";
import { ChatPanel } from "../Sidebar/SidebarChat";
import { DockNav } from "../Sidebar/SidebarNav";
import { Footer } from "../Footer/Footer";
import { PageTransition } from "../PageTransition/PageTransition";
import "../../styles/layout.css";

type AppShellProps = {
  children: ReactNode;
};

/**
 * AppShell — the outermost layout frame for the LottaCash app.
 *
 * v3 "Command Center" redesign — STRUCTURAL change, not a reskin:
 *   • The left sidebar is GONE. Main content is FULL WIDTH.
 *   • Grid: topbar row (56px) + main row (fills viewport). No sidebar column.
 *   • Navigation lives in a floating DOCK (left-center, desktop only) and a
 *     bottom TAB BAR (mobile only) — both are position:fixed, OUTSIDE the grid.
 *   • Live chat is now a slide-in panel from the right (driven by
 *     SidebarContext.chatOpen), not an always-visible sidebar section.
 *   • AtmosphericLayer sits behind everything (z-index 0).
 *   • SmoothScroll wraps main for Lenis inertia (skipped for reduced motion).
 *   • PageTransition fades between routes (opacity-only, 0.2s).
 *   • Footer sits at the bottom of main, after the page content.
 */
function AppShellInner({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const showGuestBanner = isGuestBrowsableGamePath(pathname);
  const showHero3d = pathname === "/";
  useSessionReminder();

  return (
    <div className="app-shell">
      <AtmosphericLayer show3d={showHero3d} />
      <AffiliateRefCapture />
      <div className="app-shell__topbar">
        <Topbar />
      </div>
      <SmoothScroll targetRef={mainRef} scrollKey={pathname}>
        <main ref={mainRef} className="app-shell__main">
          <PageTransition>
            {showGuestBanner ? <GameGuestBanner /> : null}
            {children}
            <Footer />
          </PageTransition>
        </main>
      </SmoothScroll>

      {/* Floating dock — desktop only (CSS hides on ≤768px) */}
      <Dock />

      {/* Mobile bottom tab bar — mobile only (CSS shows on ≤768px) */}
      <MobileTabBar />

      {/* Slide-in chat panel (right side, driven by SidebarContext) */}
      <ChatPanel />

      {/* Visually-hidden full nav for assistive-tech users — the Dock and
          MobileTabBar only show 4–5 quick links, so this guarantees every
          destination is reachable by keyboard / screen reader. */}
      <DockNav />
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}
