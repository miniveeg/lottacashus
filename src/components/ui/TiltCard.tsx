import { useRef, type ReactNode, type MouseEvent } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

type TiltCardProps = {
  children: ReactNode;
  className?: string;
  intensity?: number;
};

export function TiltCard({ children, className, intensity = 12 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Cache the element's bounding rect on mouseenter so we don't trigger a
  // layout query (getBoundingClientRect) on every mousemove — that would
  // force a sync layout reflow each time the cursor moves. The rect is
  // invalidated on mouseleave; if the user scrolls or resizes while
  // hovering, the tilt will be slightly off until the next mouseenter, which
  // is acceptable for a purely decorative effect.
  const rectRef = useRef<DOMRect | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [intensity, -intensity]), {
    stiffness: 300,
    damping: 24,
  });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-intensity, intensity]), {
    stiffness: 300,
    damping: 24,
  });
  const reduceMotion = useReducedMotion();

  function handleEnter() {
    const el = ref.current;
    if (!el) return;
    rectRef.current = el.getBoundingClientRect();
  }

  function handleMove(e: MouseEvent<HTMLDivElement>) {
    const rect = rectRef.current;
    if (!rect) return;
    // `useMotionValue.set` is internally rAF-batched by framer-motion, so
    // this handler does NOT trigger a React re-render on every mousemove —
    // the springs consume the motion values directly on the GPU.
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handleLeave() {
    rectRef.current = null;
    x.set(0);
    y.set(0);
  }

  if (reduceMotion) {
    // Skip the 3D tilt and the whileHover lift entirely for users who
    // prefer reduced motion. The card stays flat but still interactive.
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      whileHover={{ y: -6, transition: { duration: 0.25 } }}
    >
      {children}
    </motion.div>
  );
}
