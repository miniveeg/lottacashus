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
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-8% 0px" });
  const Component = motion[as];

  return (
    <Component
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={fadeUpVariants}
      custom={delay}
    >
      {children}
    </Component>
  );
}
