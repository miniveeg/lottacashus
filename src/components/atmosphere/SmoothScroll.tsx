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

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Wraps the main scroll container with Lenis for inertia-smoothed wheel
 * scrolling. Behaviour notes:
 *  - When the user prefers reduced motion we skip Lenis entirely and rely on
 *    native scrolling (better for accessibility and avoids fighting the OS).
 *  - Touch devices keep native momentum scrolling (syncTouch defaults to off).
 *  - Keyboard scrolling is left to the browser.
 *  - When `scrollKey` changes (route change) we jump to the top immediately
 *    so the new page starts at its header.
 */
export function SmoothScroll({ children, targetRef, scrollKey }: SmoothScrollProps) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    // Skip Lenis for reduced-motion users — native scroll is better here.
    if (prefersReducedMotion()) return;

    const el = targetRef.current;
    if (!el) return;

    const lenis = new Lenis({
      wrapper: el,
      content: el,
      lerp: 0.085,
      smoothWheel: true,
      // syncTouch defaults to false → touch devices keep native momentum
      // scrolling, which feels better on mobile and avoids jank.
      touchMultiplier: 1.2,
    });
    lenisRef.current = lenis;

    let frame: number;
    function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [targetRef]);

  // Reset scroll position on route change so users land at the top of each
  // new page (Lenis preserves scrollTop otherwise).
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
