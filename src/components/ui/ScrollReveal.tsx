import { useRef, type ReactNode } from "react";
import { motion, useInView } from "framer-motion";
import { fadeUpVariants } from "../../lib/motion";

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "article" | "li";
};

export function ScrollReveal({ children, className, delay = 0, as = "div" }: ScrollRevealProps) {
  // Use `any` for the ref because framer-motion's `motion[as]` produces a
  // union of distinct element-specific ref types (HTMLDivElement, HTMLLIElement, etc.)
  // that TypeScript cannot reconcile with a single `HTMLElement` ref.
  const ref = useRef<any>(null);
  const inView = useInView(ref, { once: true, margin: "-8% 0px" });
  const MotionTag = motion[as];

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={fadeUpVariants}
      custom={delay}
    >
      {children}
    </MotionTag>
  );
}
