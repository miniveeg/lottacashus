import { forwardRef } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { motion } from "framer-motion";
import { springTransition } from "../../lib/motion";
import { cn } from "../../lib/cn";

type MotionLinkProps = LinkProps & {
  variant?: "primary" | "secondary" | "ghost";
  glow?: boolean;
};

const variantClass: Record<NonNullable<MotionLinkProps["variant"]>, string> = {
  primary: "lc-motion-btn--primary",
  secondary: "lc-motion-btn--secondary",
  ghost: "lc-motion-btn--ghost",
};

const MotionRouterLink = motion.create(Link);

export const MotionLink = forwardRef<HTMLAnchorElement, MotionLinkProps>(
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

export type { MotionLinkProps };
