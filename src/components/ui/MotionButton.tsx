import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { springTransition } from "../../lib/motion";
import { cn } from "../../lib/cn";

type MotionButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "ghost";
  glow?: boolean;
  children: ReactNode;
  className?: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "form" | "formAction" | "formMethod" | "formEncType" | "formTarget" | "name" | "value" | "type">;

const variantClass: Record<NonNullable<MotionButtonProps["variant"]>, string> = {
  primary: "lc-motion-btn--primary",
  secondary: "lc-motion-btn--secondary",
  ghost: "lc-motion-btn--ghost",
};

export const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  function MotionButton({ variant = "primary", glow = false, className, children, ...props }, ref) {
    return (
      <motion.button
        ref={ref}
        className={cn("lc-motion-btn", variantClass[variant], glow && "lc-motion-btn--glow", className)}
        whileHover={{ scale: 1.03, y: -2 }}
        whileTap={{ scale: 0.97, y: 0 }}
        transition={springTransition}
        {...props}
      >
        <span className="lc-motion-btn__shine" aria-hidden="true" />
        {children}
      </motion.button>
    );
  }
);
