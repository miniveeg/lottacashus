import { useRef, type ReactNode, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { fadeUpVariants } from "../../lib/motion";

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "article" | "li";
};

// `motion[as]` is a union of distinct `ForwardRefComponent` types
// (motion.div, motion.section, …) whose ref types differ (HTMLDivElement,
// HTMLSectionElement, …). To reuse a single `useRef<HTMLElement | null>`
// across all supported tags without an `any` escape hatch, we cast
// `motion[as]` to a permissive `ForwardRefExoticComponent` shape parameterised
// by `HTMLElement`. The cast is sound because every supported tag's
// underlying element extends `HTMLElement`, and we control which `as` value
// maps to which motion component.
type MotionTagComponent = ForwardRefExoticComponent<
  {
    className?: string;
    initial?: string | false;
    animate?: string;
    variants?: Variants;
    custom?: number;
    children?: ReactNode;
  } & RefAttributes<HTMLElement>
>;

export function ScrollReveal({ children, className, delay = 0, as = "div" }: ScrollRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  // Cards used to start at opacity 0 via useInView({ margin: "-8% 0px" }).
  // Overflow parents (`.app-shell` hidden + `.app-shell__main` scroll)
  // meant the observer often never fired, so Home / Originals tables
  // stayed invisible until a scroll that never came. Visible by default;
  // reduced-motion still skips the fade entirely.
  const reduceMotion = useReducedMotion();
  const MotionTag = motion[as] as unknown as MotionTagComponent;

  if (reduceMotion) {
    // Skip the opacity/translate animation entirely. framer-motion's default
    // reduced-motion handling would still apply the `y: 28` initial offset
    // from `fadeUpVariants.hidden`, causing a visible jump when the element
    // snaps into place; rendering a plain motion tag with no motion props
    // keeps the element stable and visible from the start.
    return (
      <MotionTag ref={ref} className={className}>
        {children}
      </MotionTag>
    );
  }

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial={false}
      animate="visible"
      variants={fadeUpVariants}
      custom={delay}
    >
      {children}
    </MotionTag>
  );
}
