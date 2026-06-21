import { useEffect, useRef, type ReactNode } from "react";
import Lenis from "lenis";

type SmoothScrollProps = {
  children: ReactNode;
  targetRef: React.RefObject<HTMLElement | null>;
  /** A key (typically the route pathname) that, when it changes, resets the
   *  scroll position of the wrapper to the top so navigation doesn't leave
   *  the user partway down the new page. */
  scrollKey?: string;
};

const REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)";

/**
 * Wraps the main scroll container with Lenis for inertia-smoothed wheel
 * scrolling. Behaviour notes:
 *  - When the user prefers reduced motion we skip Lenis entirely and rely on
 *    native scrolling (better for accessibility and avoids fighting the OS).
 *    We also re-evaluate the preference live, so toggling the OS setting
 *    mid-session destroys/recreates Lenis without a page reload.
 *  - Touch devices keep native momentum scrolling (syncTouch defaults to
 *    false in Lenis) — feels better on mobile and avoids jank.
 *  - Keyboard scrolling is left to the browser.
 *  - When `scrollKey` changes (route change) we jump to the top immediately
 *    so the new page starts at its header.
 *  - Browser routing: BrowserRouter uses real URL paths
 *    (`/#/mines`), so anchor-link clicks inside a page (`<a href="#sec">`)
 *    would mutate the route, not scroll. Lenis doesn't intercept anchor
 *    clicks by default (`anchors` option defaults to false), so there is no
 *    conflict with BrowserRouter here.
 */
export function SmoothScroll({ children, targetRef, scrollKey }: SmoothScrollProps) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(REDUCED_MOTION_MEDIA);

    let frame: number | undefined;
    let stopped = false;
    let lenis: Lenis | null = null;

    const start = () => {
      const el = targetRef.current;
      if (!el) return;
      lenis = new Lenis({
        wrapper: el,
        content: el,
        lerp: 0.085,
        smoothWheel: true,
        // syncTouch defaults to false → touch devices keep native momentum
        // scrolling, which feels better on mobile and avoids jank.
        touchMultiplier: 1.2,
      });
      lenisRef.current = lenis;

      const raf = (time: number) => {
        if (stopped) return;
        lenis!.raf(time);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
    };

    const stop = () => {
      // Stop the rAF loop first so we never call `lenis.raf()` on a
      // destroyed instance (which throws in some Lenis versions).
      stopped = true;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
      if (lenis) {
        lenis.destroy();
        lenis = null;
      }
      lenisRef.current = null;
    };

    if (!mql.matches) start();

    const onChange = () => {
      if (mql.matches) {
        stop();
      } else {
        stop();
        start();
      }
    };
    mql.addEventListener("change", onChange);

    return () => {
      mql.removeEventListener("change", onChange);
      stop();
    };
  }, [targetRef]);

  // Reset scroll position on route change so users land at the top of each
  // new page (Lenis preserves scrollTop otherwise). Falls back to native
  // `scrollTop = 0` when Lenis isn't running (reduced-motion users).
  useEffect(() => {
    if (!scrollKey) return;
    const lenis = lenisRef.current;
    if (lenis) {
      lenis.scrollTo(0, { immediate: true });
    } else if (targetRef.current) {
      targetRef.current.scrollTop = 0;
    }
  }, [scrollKey, targetRef]);

  return children;
}
