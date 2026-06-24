import { PRIVACY_POLICY } from "../../content/legal";
import { Seo } from "../../components/Seo/Seo";
import "../Help/Help.css";

export function Privacy() {
  return (
    <div className="help lc-page lc-page--narrow">
      <Seo
        title="Privacy Policy"
        path="/privacy"
        description="How LottaCash collects, uses, and protects your personal information, including GDPR and CCPA rights."
      />
      <header className="lc-page__header help__header">
        <h1 className="lc-page__title help__title">Privacy Policy</h1>
        <p className="lc-page__subtitle help__subtitle">
          How we collect, use, and protect your information.
        </p>
      </header>

      <section className="help__panel help__panel--tos" aria-label="Privacy Policy text">
        <div className="help__tos">
          {PRIVACY_POLICY.split("\n\n").map((block, i) => {
            const trimmed = block.trim();
            if (!trimmed) return null;
            if (/^\d+\.\s/.test(trimmed)) {
              // Split on first newline so the heading is the full "N. Title"
              // and the body is the section text that follows.
              const dot = trimmed.indexOf("\n");
              if (dot === -1) {
                return (
                  <div key={trimmed} className="help__tos-block">
                    <h3 className="help__tos-heading">{trimmed}</h3>
                  </div>
                );
              }
              const heading = trimmed.slice(0, dot).trim();
              const body = trimmed.slice(dot + 1).trim();
              return (
                <div key={heading} className="help__tos-block">
                  <h3 className="help__tos-heading">{heading}</h3>
                  <p>{body}</p>
                </div>
              );
            }
            return (
              <p key={`meta-${i}`} className="help__tos-meta">
                {trimmed}
              </p>
            );
          })}
        </div>
      </section>
    </div>
  );
}
