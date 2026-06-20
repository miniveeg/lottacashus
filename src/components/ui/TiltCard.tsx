import { useRef, type ReactNode, type MouseEvent } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";

type TiltCardProps = {
  children: ReactNode;
  className?: string;
  /** Max tilt in degrees. Clamped to a subtle max for premium feel. */
  intensity?: number;
};

/**
 * Subtle 3D tilt on hover. Caps the rotation at 5° by default so cards
 * feel tactile without becoming distracting. Respects
 * `prefers-reduced-motion` by disabling rotation entirely.
 */
export function TiltCard({ children, className, intensity = 5 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Cap the intensity at 5° so callers can't accidentally over-tilt.
  const maxTilt = Math.min(intensity, 5);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [maxTilt, -maxTilt]), {
    stiffness: 300,
    damping: 24,
  });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-maxTilt, maxTilt]), {
    stiffness: 300,
    damping: 24,
  });

  function handleMove(e: MouseEvent<HTMLDivElement>) {
    if (reduceMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={
        reduceMotion
          ? undefined
          : { rotateX, rotateY, transformPerspective: 900 }
      }
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      whileHover={reduceMotion ? undefined : { y: -4, transition: { duration: 0.25 } }}
    >
      {children}
    </motion.div>
  );
}
