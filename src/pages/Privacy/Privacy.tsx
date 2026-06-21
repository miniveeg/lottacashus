import { PRIVACY_POLICY } from "../../content/legal";
import "../Help/Help.css";

export function Privacy() {
  return (
    <div className="help lc-page lc-page--narrow">
      <header className="lc-page__header help__header">
        <h1 className="lc-page__title help__title">Privacy Policy</h1>
        <p className="lc-page__subtitle help__subtitle">
          How we collect, use, and protect your information.
        </p>
      </header>

      <section className="help__panel help__panel--tos" role="tabpanel">
        <div className="help__tos">
          {PRIVACY_POLICY.split("\n\n").map((block) => {
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
