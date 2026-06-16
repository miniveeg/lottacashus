import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Level.css";

type Props = {
  level: ReactNode;
  size?: "sm" | "md" | "lg";
  asButton?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "aria-expanded" | "aria-label">;

export function LevelBadge({
  level,
  size = "sm",
  asButton = false,
  onClick,
  title,
  className = "",
  "aria-expanded": ariaExpanded,
  "aria-label": ariaLabel,
}: Props) {
  const classes = `level-badge level-badge--${size}${asButton ? " level-badge--clickable" : ""} ${className}`.trim();

  if (asButton) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        title={title}
        aria-expanded={ariaExpanded}
        aria-label={ariaLabel}
      >
        {level}
      </button>
    );
  }

  return (
    <span className={classes} title={title}>
      {level}
    </span>
  );
}
