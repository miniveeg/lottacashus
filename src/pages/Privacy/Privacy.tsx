import { PRIVACY_POLICY } from "../../content/legal";
import { LegalDocument } from "../../components/LegalDocument/LegalDocument";
import { Seo } from "../../components/Seo/Seo";
import "./Privacy.css";

export function Privacy() {
  return (
    <div className="legal-page lc-page lc-page--narrow">
      <Seo
        title="Privacy Policy"
        path="/privacy"
        description="How LottaCash collects, uses, and protects your personal information, including GDPR and CCPA rights."
      />
      <header className="lc-page__header legal-page__header">
        <h1 className="lc-page__title">Privacy Policy</h1>
        <p className="lc-page__subtitle">
          How we collect, use, and protect your information.
        </p>
      </header>

      <section className="lc-panel legal-page__panel" aria-label="Privacy Policy text">
        <LegalDocument
          content={PRIVACY_POLICY}
          ariaLabel="Privacy Policy text"
          id="privacy-policy-body"
        />
      </section>
    </div>
  );
}
