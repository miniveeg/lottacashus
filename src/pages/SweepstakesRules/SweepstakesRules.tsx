import { SWEEPSTAKES_RULES } from "../../content/legal";
import "../Help/Help.css";

export function SweepstakesRules() {
  return (
    <div className="help lc-page lc-page--narrow">
      <header className="lc-page__header help__header">
        <h1 className="lc-page__title help__title">Sweepstakes Rules</h1>
        <p className="lc-page__subtitle help__subtitle">
          Official rules for sweepstakes participation and prize redemption.
        </p>
      </header>

      <section className="help__panel help__panel--tos" role="tabpanel">
        <div className="help__tos">
          {SWEEPSTAKES_RULES.split("\n\n").map((block) => {
            const trimmed = block.trim();
            if (!trimmed) return null;
            if (/^\d+\.\s/.test(trimmed)) {
              const dot = trimmed.indexOf(" ");
              const heading = trimmed.slice(0, dot);
              const body = trimmed.slice(dot + 1);
              return (
                <div key={heading} className="help__tos-block">
                  <h3 className="help__tos-heading">{heading}</h3>
                  <p>{body}</p>
                </div>
              );
            }
            return (
              <p key={trimmed.slice(0, 24)} className="help__tos-meta">
                {trimmed}
              </p>
            );
          })}
        </div>
      </section>
    </div>
  );
}
