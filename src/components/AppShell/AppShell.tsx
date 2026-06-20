import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider, useSidebar } from "../../contexts/SidebarContext";
import { isGuestBrowsableGamePath } from "../../content/originals";
import { useSessionReminder } from "../../lib/useSessionReminder";
import { AffiliateRefCapture } from "../AffiliateRefCapture/AffiliateRefCapture";
import { AtmosphericLayer } from "../atmosphere/AtmosphericLayer";
import { SmoothScroll } from "../atmosphere/SmoothScroll";
import { GameGuestBanner } from "../GameGuestBanner/GameGuestBanner";
import { Topbar } from "../Topbar/Topbar";
import { Sidebar } from "../Sidebar/Sidebar";
import { Footer } from "../Footer/Footer";
import { PageTransition } from "../PageTransition/PageTransition";
import "../../styles/layout.css";

type AppShellProps = {
  children: ReactNode;
};

/**
 * AppShell — the outermost layout frame for the LottaCash app.
 *
 * Obsidian Gold redesign:
 *   • Grid: topbar row (60px) + sidebar/main row (fills viewport)
 *   • Sidebar collapses on desktop, becomes off-canvas drawer on mobile
 *   • Main column scrolls vertically; horizontal overflow is clipped
 *   • AtmosphericLayer sits behind everything (z-index 0)
 *   • SmoothScroll wraps main for Lenis inertia (skipped for reduced motion)
 *   • PageTransition fades between routes (opacity-only, 0.2s)
 *   • Footer sits at the bottom of main, after the page content
 */
function AppShellInner({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const { mobileOpen, closeMobile, collapsed } = useSidebar();
  const mainRef = useRef<HTMLElement>(null);
  const showGuestBanner = isGuestBrowsableGamePath(pathname);
  const showHero3d = pathname === "/";
  useSessionReminder();

  return (
    <div
      className={`app-shell${mobileOpen ? " app-shell--sidebar-open" : ""}${collapsed ? " app-shell--sidebar-collapsed" : ""}`}
    >
      <AtmosphericLayer show3d={showHero3d} />
      <AffiliateRefCapture />
      <div className="app-shell__topbar">
        <Topbar />
      </div>
      <button
        type="button"
        className="app-shell__backdrop"
        aria-label="Close menu"
        onClick={closeMobile}
        tabIndex={mobileOpen ? 0 : -1}
      />
      <div className="app-shell__sidebar">
        <Sidebar />
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
