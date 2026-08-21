import type { ReactNode } from "react";
import "./PageLayout.css";

/**
 * Canonical page shell used by every route under AppShell.
 *
 * AppShell already provides:
 *   - Topbar (balance, auth, notifications)
 *   - Sidebar (nav + chat)
 *   - Footer
 *   - Atmosphere / guest banner / page transitions
 *
 * PageLayout standardizes what goes *inside* `<main>`:
 *   - Consistent horizontal/vertical padding
 *   - Width variants (default | narrow | medium | game | auth)
 *   - Optional page header (title + subtitle + eyebrow)
 *   - Content region for the page body
 *
 * See `/_example` for the reference implementation every page should follow.
 */

export type PageLayoutVariant = "default" | "narrow" | "medium" | "game" | "auth" | "wide";

export type PageLayoutProps = {
  children: ReactNode;
  /** Width / spacing preset. Defaults to "default". */
  variant?: PageLayoutVariant;
  /** Optional page title shown in the standard header. */
  title?: string;
  /** Optional subtitle under the title. */
  subtitle?: string;
  /** Optional small eyebrow/label above the title. */
  eyebrow?: string;
  /** Extra class names on the outer page wrapper. */
  className?: string;
  /** Override the automatic header when you need custom header markup. */
  header?: ReactNode;
  /** Hide the standard header even if title is set. */
  hideHeader?: boolean;
};

const VARIANT_CLASS: Record<PageLayoutVariant, string> = {
  default: "lc-page",
  narrow: "lc-page lc-page--narrow",
  medium: "lc-page lc-page--medium",
  wide: "lc-page lc-page--wide",
  game: "lc-game-page",
  auth: "lc-page lc-page--auth",
};

export function PageLayout({
  children,
  variant = "default",
  title,
  subtitle,
  eyebrow,
  className = "",
  header,
  hideHeader = false,
}: PageLayoutProps) {
  const showHeader = !hideHeader && (header != null || title != null);

  const classes = [VARIANT_CLASS[variant], "lc-page-layout", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {showHeader &&
        (header ?? (
          <header className="lc-page__header">
            {eyebrow ? <p className="lc-page__eyebrow">{eyebrow}</p> : null}
            {title ? <h1 className="lc-page__title">{title}</h1> : null}
            {subtitle ? <p className="lc-page__subtitle">{subtitle}</p> : null}
          </header>
        ))}
      <div className="lc-page-layout__body">{children}</div>
    </div>
  );
}
