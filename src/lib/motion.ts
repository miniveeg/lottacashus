import type { Transition, Variants } from "framer-motion";

export const springTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 28,
};

export const smoothTransition: Transition = {
  duration: 0.38,
  ease: [0.22, 1, 0.36, 1],
};

export const pageTransitionVariants: Variants = {
  initial: {
    opacity: 0,
    filter: "blur(10px)",
    y: 16,
  },
  animate: {
    opacity: 1,
    filter: "blur(0px)",
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    filter: "blur(6px)",
    y: -10,
    transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
  },
};

export const minorPageTransitionVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22 } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.16 } },
};

export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.08,
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.06 },
  },
};

export const glowPulse = {
  scale: [1, 1.02, 1],
  boxShadow: [
    "0 0 20px rgba(220, 20, 60, 0.15)",
    "0 0 32px rgba(220, 20, 60, 0.35)",
    "0 0 20px rgba(220, 20, 60, 0.15)",
  ],
};
