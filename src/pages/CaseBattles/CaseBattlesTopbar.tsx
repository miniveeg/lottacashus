import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type CaseBattlesTopbarProps = {
  backTo: string;
  backLabel: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function CaseBattlesTopbar({
  backTo,
  backLabel,
  title,
  subtitle,
  actions,
}: CaseBattlesTopbarProps) {
  return (
    <header className="cb-page__topbar">
      <Link to={backTo} className="cb-page__back">
        <span className="cb-page__back-icon" aria-hidden>
          ←
        </span>
        <span className="cb-page__back-label">{backLabel}</span>
      </Link>
      <div className="cb-page__topbar-center">
        <p className="cb-page__eyebrow">Case Battles</p>
        <h1 className="cb-page__title">{title}</h1>
        {subtitle && <p className="cb-page__subtitle">{subtitle}</p>}
      </div>
      {actions ? <div className="cb-page__topbar-end">{actions}</div> : null}
    </header>
  );
}
