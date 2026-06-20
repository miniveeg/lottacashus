import { forwardRef, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { springTransition } from "../../lib/motion";
import { cn } from "../../lib/cn";

/**
 * MotionLink — "Obsidian Gold" link-as-button.
 *
 * Same visual surface as MotionButton (gold gradient primary, subtle
 * border secondary, transparent ghost). Motion: clean scale hover
 * (1.02, no y-translate) + tiny tap scale-down. Respects
 * prefers-reduced-motion.
 */
type MotionLinkProps = LinkProps & {
  variant?: "primary" | "secondary" | "ghost";
  glow?: boolean;
  children?: ReactNode;
  className?: string;
};

const variantClass: Record<NonNullable<MotionLinkProps["variant"]>, string> = {
  primary: "lc-motion-btn--primary",
  secondary: "lc-motion-btn--secondary",
  ghost: "lc-motion-btn--ghost",
};

// `motion.create(Link)` returns a component whose props blend framer-motion
// and react-router types. The two libraries disagree on `onDrag` typing
// (framer-motion uses PanInfo, react-router uses the DOM DragEvent), so we
// cast through `any` to satisfy TS while preserving runtime behaviour.
const MotionRouterLink = motion.create(Link) as unknown as React.FC<any>;

export const MotionLink = forwardRef<HTMLAnchorElement, MotionLinkProps>(
  function MotionLink({ variant = "primary", glow = false, className, children, ...props }, ref) {
    const reduceMotion = useReducedMotion();

    return (
      <MotionRouterLink
        ref={ref}
        className={cn(
          "lc-motion-btn",
          variantClass[variant],
          glow && "lc-motion-btn--glow",
          className,
        )}
        whileHover={reduceMotion ? undefined : { scale: 1.02 }}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        transition={springTransition}
        {...props}
      >
        <span className="lc-motion-btn__shine" aria-hidden="true" />
        {children}
      </MotionRouterLink>
    );
  },
);

export type { MotionLinkProps };
