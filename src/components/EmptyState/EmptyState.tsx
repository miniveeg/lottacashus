import type { ReactNode } from "react";
import { PackageX } from "lucide-react";
import "./EmptyState.css";

interface EmptyStateProps {
  /** Optional icon. Defaults to a PackageX icon. Pass a Lucide component. */
  icon?: ReactNode;
  /** Main heading, e.g. "No open battles". */
  title: string;
  /** Descriptive body text explaining the state and what to do next. */
  body?: string;
  /** Optional CTA (button or link) rendered below the body. */
  action?: ReactNode;
  /** Extra className for the container. */
  className?: string;
}

/**
 * Canonical empty-state component for list pages.
 *
 * WHY THIS EXISTS: the audit (#3.5) noted that Case Battles Hub, Leaderboard,
 * Deposit, Withdraw, Admin, and Profile each invent their own empty-state
 * treatment — different icons, different layouts, different class names.
 * This component provides one shared pattern so empty states are visually
 * consistent across the site.
 *
 * USAGE: prefer `<EmptyState>` over hand-rolled `<div className="...empty">`.
 * If a page needs a custom icon, pass it via the `icon` prop.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: EmptyStateProps) {
  const cls = ["lc-empty-state", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="status">
      <div className="lc-empty-state__icon" aria-hidden>
        {icon ?? <PackageX size={32} strokeWidth={1.5} />}
      </div>
      <p className="lc-empty-state__title">{title}</p>
      {body && <p className="lc-empty-state__body">{body}</p>}
      {action && <div className="lc-empty-state__action">{action}</div>}
    </div>
  );
}
