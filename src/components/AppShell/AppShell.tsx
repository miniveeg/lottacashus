import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider, useSidebar } from "../../contexts/SidebarContext";
import { isGuestBrowsableGamePath } from "../../content/originals";
import { AffiliateRefCapture } from "../AffiliateRefCapture/AffiliateRefCapture";
import { AtmosphericLayer } from "../atmosphere/AtmosphericLayer";
import { SmoothScroll } from "../atmosphere/SmoothScroll";
import { GameGuestBanner } from "../GameGuestBanner/GameGuestBanner";
import { Topbar } from "../Topbar/Topbar";
import { Sidebar } from "../Sidebar/Sidebar";
import { PageTransition } from "../PageTransition/PageTransition";
import "../../styles/layout.css";

type AppShellProps = {
  children: ReactNode;
};

function AppShellInner({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const { mobileOpen, closeMobile, collapsed } = useSidebar();
  const mainRef = useRef<HTMLElement>(null);
  const showGuestBanner = isGuestBrowsableGamePath(pathname);
  const showHero3d = pathname === "/";

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
      <SmoothScroll targetRef={mainRef}>
        <main ref={mainRef} className="app-shell__main">
          <PageTransition>
            {showGuestBanner ? <GameGuestBanner /> : null}
            {children}
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
