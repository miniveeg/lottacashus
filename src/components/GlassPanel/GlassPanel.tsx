import type { HTMLAttributes, ReactNode } from "react";
import "./GlassPanel.css";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Add a subtle crimson glow border. Use for hero panels (home hero, etc.). */
  glow?: boolean;
  /** Visual padding scale. */
  padding?: "sm" | "md" | "lg";
  /** Use the crimson-tinted glass variant (matches the home hero treatment). */
  variant?: "default" | "crimson";
}

/**
 * Canonical glass surface for the LottaCash design system.
 *
 * WHY THIS EXISTS: every page used to hand-roll its own
 * `background: rgba(...); backdrop-filter: blur(...)` recipe, and none of
 * them had a fallback for browsers/GPUs that don't support `backdrop-filter`.
 * On unsupported browsers, the panel would render as a near-invisible veil
 * over low-contrast text. This component centralizes the recipe AND the
 * `@supports not (backdrop-filter)` fallback so every glass surface degrades
 * gracefully. (Audit issue #1.1 / #2.4.)
 *
 * USAGE: prefer `<GlassPanel>` over hand-rolled glass CSS. If a page needs a
 * slightly different recipe, parameterize this component rather than
 * re-implementing the pattern.
 */
export function GlassPanel({
  children,
  className,
  glow = false,
  padding = "md",
  variant = "default",
  ...rest
}: GlassPanelProps) {
  const cls = [
    "glass-panel",
    `glass-panel--${padding}`,
    glow && "glass-panel--glow",
    variant === "crimson" && "glass-panel--crimson",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
