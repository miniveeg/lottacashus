import { SWEEPSTAKES_RULES } from "../../content/legal";
import { LegalDocument } from "../../components/LegalDocument/LegalDocument";
import { Seo } from "../../components/Seo/Seo";
import "../Privacy/Privacy.css";

export function SweepstakesRules() {
  return (
    <div className="legal-page lc-page lc-page--narrow">
      <Seo
        title="Sweepstakes Rules"
        path="/sweepstakes"
        description="Official LottaCash sweepstakes rules: eligibility, free entry by mail, prizes, odds, and redemption terms."
      />
      <header className="lc-page__header legal-page__header">
        <h1 className="lc-page__title">Sweepstakes Rules</h1>
        <p className="lc-page__subtitle">
          Official rules for sweepstakes participation and prize redemption.
        </p>
      </header>

      <section className="lc-panel legal-page__panel" aria-label="Sweepstakes Rules text">
        <LegalDocument
          content={SWEEPSTAKES_RULES}
          ariaLabel="Sweepstakes Rules text"
          id="sweepstakes-rules-body"
        />
      </section>
    </div>
  );
}
