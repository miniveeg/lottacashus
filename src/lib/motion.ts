import type { Transition, Variants } from "framer-motion";

/* ════════════════════════════════════════════════════════════════
   LottaCash — Framer Motion variants & transitions
   Export names are part of the public API (Home.tsx, Originals.tsx,
   ScrollReveal, MotionButton, MotionLink import them). Do NOT rename.
   ════════════════════════════════════════════════════════════════ */

/* Standard spring — crisp, slight overshoot */
export const springTransition: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
};

/* Smooth ease-out — used for color/opacity tweens */
export const smoothTransition: Transition = {
  duration: 0.25,
  ease: [0.4, 0, 0.2, 1],
};

/* Page transition — clean opacity fade only. No blur, no transform:
   blur forces a full-content GPU repaint and is the main source of
   jank during navigation. */
export const pageTransitionVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
  },
};

/* Minor page transition (same-section navigation) — even faster */
export const minorPageTransitionVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

/* Fade + slide up. Accepts a custom delay index (used by
   `staggerContainer` children and `ScrollReveal`). */
export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.4,
      ease: [0.4, 0, 0.2, 1],
    },
  }),
};

/* Scale-in — fade + slight pop. Good for cards, modals, icons. */
export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] },
  },
};

/* Stagger container — children fade up in sequence */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

/* Glow pulse — subtle crimson breathing for high-emphasis CTAs */
export const glowPulse = {
  scale: [1, 1.015, 1],
  boxShadow: [
    "0 0 12px rgba(225, 29, 72, 0.10)",
    "0 0 22px rgba(225, 29, 72, 0.22)",
    "0 0 12px rgba(225, 29, 72, 0.10)",
  ],
};
