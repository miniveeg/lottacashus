import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider, useSidebar } from "../../contexts/SidebarContext";
import { isGuestBrowsableGamePath } from "../../content/originals";
import { useSessionReminder } from "../../lib/useSessionReminder";
import { AffiliateRefCapture } from "../AffiliateRefCapture/AffiliateRefCapture";
import { AtmosphericLayer } from "../atmosphere/AtmosphericLayer";
import { ErrorBoundary } from "../ErrorBoundary/ErrorBoundary";
import { GameGuestBanner } from "../GameGuestBanner/GameGuestBanner";
import { Topbar } from "../Topbar/Topbar";
import { Sidebar } from "../Sidebar/Sidebar";
import { Footer } from "../Footer/Footer";
import { PageTransition } from "../PageTransition/PageTransition";
import "../../styles/layout.css";

type AppShellProps = {
  children: ReactNode;
};

/** Mobile breakpoint — must match the `@media (max-width: 900px)` rule in
 *  layout.css that turns the sidebar into an off-canvas drawer. */
const MOBILE_MEDIA = "(max-width: 900px)";

/** Stable id so the topbar menu button can point at the drawer via
 *  `aria-controls`. */
export const PRIMARY_SIDEBAR_ID = "lc-primary-sidebar";

/** Selector for focusable elements used by the focus-trap / focus-restore
 *  logic below. Kept in one place so the trap and the initial-focus code
 *  agree on what's focusable. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisuallyFocusable(el: HTMLElement, root: HTMLElement): boolean {
  let p: Element | null = el;
  while (p && p !== root) {
    const cs = getComputedStyle(p);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    p = p.parentElement;
  }
  return true;
}

function AppShellInner({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const { mobileOpen, closeMobile, collapsed } = useSidebar();
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const showGuestBanner = isGuestBrowsableGamePath(pathname);
  const showHero3d = pathname === "/";
  useSessionReminder();

  // Reset scroll position to the top of <main> on every route change.
  // Previously this was handled by the `lenis` smooth-scroll library via
  // <SmoothScroll scrollKey={pathname}>; lenis was removed in audit #3.2
  // because it added perceived input latency on the Case Battle arena page
  // (which re-renders every round). Native scroll + this reset hook covers
  // the same UX guarantee (new page starts at the top) without the library.
  useEffect(() => {
    const el = mainRef.current;
    if (el) el.scrollTop = 0;
  }, [pathname]);

  // Track whether the viewport matches the mobile media query so we can
  // (a) hide the closed drawer from the a11y tree via `inert` and
  // (b) only run focus-trap / focus-restore on mobile (desktop sidebar is
  //     always visible, so the concept doesn't apply).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_MEDIA);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // If the user resizes from mobile (drawer open) to desktop, close the
  // drawer so we don't leave `mobileOpen=true` lingering with no UI to
  // dismiss it (the menu button is `display:none` on desktop).
  useEffect(() => {
    if (!isMobile && mobileOpen) closeMobile();
  }, [isMobile, mobileOpen, closeMobile]);

  // On mobile, when the drawer is closed, mark the sidebar `inert` so its
  // links are removed from the tab order and the accessibility tree
  // (otherwise 12+ off-screen links are reachable via Tab and discoverable
  // by screen readers). On desktop the sidebar is always visible, so we
  // never set `inert`.
  const sidebarInert = isMobile && !mobileOpen;

  // Focus management for the mobile drawer:
  //  - On open: remember the element that had focus (the menu button) and
  //    move focus into the drawer.
  //  - On close: restore focus to the remembered element.
  const prevFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isMobile) return;

    if (mobileOpen) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && document.contains(active)) {
        prevFocusRef.current = active;
      }
      const sidebar = sidebarRef.current;
      if (sidebar) {
        const candidates = Array.from(
          sidebar.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => isVisuallyFocusable(el, sidebar));
        const target = candidates[0] ?? sidebar;
        // Defer one frame so the transform transition has started and the
        // drawer is on-screen before we move focus.
        const raf = requestAnimationFrame(() => target.focus());
        return () => cancelAnimationFrame(raf);
      }
      return;
    }

    // mobileOpen just went false → restore focus to the trigger.
    const prev = prevFocusRef.current;
    if (prev && document.contains(prev)) {
      prev.focus();
      prevFocusRef.current = null;
    }
  }, [mobileOpen, isMobile]);

  // Focus trap: while the drawer is open on mobile, Tab (and Shift+Tab)
  // cycle within the drawer rather than escaping to the page underneath.
  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      const focusables = Array.from(
        sidebar.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => isVisuallyFocusable(el, sidebar));
      if (focusables.length === 0) {
        e.preventDefault();
        sidebar.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !sidebar.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !sidebar.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobile, mobileOpen]);

  return (
    <div
      className={`app-shell${mobileOpen ? " app-shell--sidebar-open" : ""}${collapsed ? " app-shell--sidebar-collapsed" : ""}`}
    >
      {/* Skip link for keyboard users — visually hidden until focused. */}
      <a
        href="#lc-main-content"
        className="app-shell__skip-link"
        onClick={(e) => {
          e.preventDefault();
          const main = mainRef.current;
          if (main) {
            main.setAttribute("tabindex", "-1");
            main.focus();
            main.scrollIntoView({ block: "start" });
          }
        }}
      >
        Skip to main content
      </a>
      <AtmosphericLayer show3d={showHero3d} />
      <AffiliateRefCapture />
      <div className="app-shell__topbar">
        <Topbar />
      </div>
      <button
        type="button"
        className="app-shell__backdrop"
        aria-label="Close menu"
        aria-hidden={mobileOpen ? undefined : true}
        onClick={closeMobile}
        tabIndex={mobileOpen ? 0 : -1}
      />
      <div
        id={PRIMARY_SIDEBAR_ID}
        className="app-shell__sidebar"
        ref={sidebarRef}
        // When the mobile drawer is open, announce it as a modal dialog so
        // assistive tech treats the rest of the page as inert. (We also
        // physically mark the closed drawer `inert` below.)
        role={isMobile && mobileOpen ? "dialog" : undefined}
        aria-modal={isMobile && mobileOpen ? "true" : undefined}
        aria-label={isMobile && mobileOpen ? "Site menu" : undefined}
        // `inert` removes the closed mobile drawer from the tab order and
        // the accessibility tree. On desktop `isMobile` is false so the
        // prop is omitted and the static sidebar remains interactive.
        inert={sidebarInert || undefined}
      >
        <Sidebar />
      </div>
      <main
        ref={mainRef}
        id="lc-main-content"
        className={`app-shell__main${showHero3d ? " app-shell__main--hero" : ""}`}
      >
        {/* Production readiness (audit v3.4): wrap the page surface in an
            ErrorBoundary keyed by pathname so a single broken page doesn't
            white-screen the whole app. Topbar/sidebar/footer stay
            interactive, the user gets a styled "Something went wrong"
            fallback with Try-again + Reload actions, and a route change
            automatically resets the boundary (the `key` remounts it). */}
        <ErrorBoundary key={pathname}>
          <PageTransition>
            {showGuestBanner ? <GameGuestBanner /> : null}
            {children}
            <Footer />
          </PageTransition>
        </ErrorBoundary>
      </main>
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
