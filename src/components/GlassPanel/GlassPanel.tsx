import type { ReactNode } from "react";
import "./GlassPanel.css";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  padding?: "sm" | "md" | "lg";
}

export function GlassPanel({
  children,
  className,
  glow = false,
  padding = "md",
}: GlassPanelProps) {
  const cls = [
    "glass-panel",
    `glass-panel--${padding}`,
    glow && "glass-panel--glow",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={cls}>{children}</div>;
}
