import { useEffect, useRef, type ReactNode } from "react";
import Lenis from "lenis";

type SmoothScrollProps = {
  children: ReactNode;
  targetRef: React.RefObject<HTMLElement | null>;
};

export function SmoothScroll({ children, targetRef }: SmoothScrollProps) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const lenis = new Lenis({
      wrapper: el,
      content: el,
      lerp: 0.085,
      smoothWheel: true,
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

  return children;
}
