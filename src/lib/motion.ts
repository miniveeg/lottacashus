import type { Transition, Variants } from "framer-motion";

/* ════════════════════════════════════════════════════════════════
   LottaCash — Framer Motion variants & transitions · "Obsidian Gold"
   Export names are part of the public API (Home.tsx, Originals.tsx,
   ScrollReveal, MotionButton, MotionLink import them). Do NOT rename.
   ════════════════════════════════════════════════════════════════ */

/* Standard spring — crisp, slight overshoot */
export const springTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 28,
};

/* Smooth ease-out — used for color/opacity tweens */
export const smoothTransition: Transition = {
  duration: 0.25,
  ease: [0.16, 1, 0.3, 1],
};

/* Page transition — clean opacity fade only (0.2s). No blur, no
   transform: blur forces a full-content GPU repaint and is the main
   source of jank during navigation. */
export const pageTransitionVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] },
  },
};

/* Minor page transition (same-section navigation) — even faster */
export const minorPageTransitionVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

/* Fade + slide up (y 16 → 0, 0.4s ease-out). Accepts a custom delay
   index (used by `staggerContainer` children and `ScrollReveal`). */
export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.06,
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
};

/* Scale-in — fade + slight pop (scale 0.96 → 1). Good for cards,
   modals, icons. */
export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
  },
};

/* Stagger container — children fade up in sequence (0.06s stagger) */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

/* Gold glow pulse — subtle gold breathing for high-emphasis CTAs.
   Box-shadow animates between faint and strong gold glow. */
export const glowPulse = {
  scale: [1, 1.015, 1],
  boxShadow: [
    "0 0 12px rgba(245, 185, 66, 0.10)",
    "0 0 22px rgba(245, 185, 66, 0.24)",
    "0 0 12px rgba(245, 185, 66, 0.10)",
  ],
};
