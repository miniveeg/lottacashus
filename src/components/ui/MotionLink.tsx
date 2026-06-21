import { forwardRef, memo, type ForwardRefExoticComponent, type ReactNode, type RefAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { motion, type MotionProps } from "framer-motion";
import { springTransition } from "../../lib/motion";
import { cn } from "../../lib/cn";

// framer-motion's `MotionProps` and react-router's `LinkProps` both define
// several event handlers with incompatible payloads: the drag handlers
// (PanInfo vs. DOM DragEvent) and the CSS animation handlers
// (AnimationDefinition vs. DOM AnimationEvent). Omit the conflicting keys
// from both sides so the intersection typechecks without an `any` escape
// hatch. Runtime behaviour is unaffected — `<a>` elements never emit drag
// events unless the caller explicitly wires them up, and framer-motion's
// animation callbacks fire from its own rAF loop, not from the DOM
// `animationstart` event.
type ConflictKeys =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

type MotionLinkProps = Omit<LinkProps, ConflictKeys> & {
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

// `motion.create(Link)` returns a ForwardRefComponent whose prop type is the
// intersection of `MotionProps & LinkProps`. We re-cast it through `unknown`
// to the same intersection with the conflicting handlers omitted — this
// preserves type safety for `to`, `replace`, `state`, etc. while staying
// assignable from the underlying framer-motion component.
type MotionRouterLinkType = ForwardRefExoticComponent<
  Omit<LinkProps & MotionProps, ConflictKeys> & RefAttributes<HTMLAnchorElement>
>;

const MotionRouterLink = motion.create(Link) as unknown as MotionRouterLinkType;

const MotionLinkBase = forwardRef<HTMLAnchorElement, MotionLinkProps>(
  function MotionLink({ variant = "primary", glow = false, className, children, ...props }, ref) {
    return (
      <MotionRouterLink
        ref={ref}
        className={cn("lc-motion-btn", variantClass[variant], glow && "lc-motion-btn--glow", className)}
        whileHover={{ scale: 1.03, y: -2 }}
        whileTap={{ scale: 0.97, y: 0 }}
        transition={springTransition}
        {...props}
      >
        <span className="lc-motion-btn__shine" aria-hidden="true" />
        {children}
      </MotionRouterLink>
    );
  }
);

export const MotionLink = memo(MotionLinkBase);
MotionLink.displayName = "MotionLink";

export type { MotionLinkProps };
