import { RESPONSIBLE_GAMING } from "../../content/legal";
import { LegalDocument } from "../../components/LegalDocument/LegalDocument";
import { Seo } from "../../components/Seo/Seo";
import "../Privacy/Privacy.css";

export function ResponsibleGaming() {
  return (
    <div className="legal-page lc-page lc-page--narrow">
      <Seo
        title="Responsible Gaming"
        path="/responsible-gaming"
        description="Tools, limits, and self-exclusion options for staying in control of your gambling activity."
      />
      <header className="lc-page__header legal-page__header">
        <h1 className="lc-page__title">Responsible Gaming</h1>
        <p className="lc-page__subtitle">
          Tools and resources to help you stay in control.
        </p>
      </header>

      <section className="lc-panel legal-page__panel" aria-label="Responsible Gaming text">
        <LegalDocument
          content={RESPONSIBLE_GAMING}
          ariaLabel="Responsible Gaming text"
          id="responsible-gaming-body"
        />
      </section>
    </div>
  );
}
