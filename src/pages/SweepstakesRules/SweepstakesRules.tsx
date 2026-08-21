import { SWEEPSTAKES_RULES } from "../../content/legal";
import { LegalDocument } from "../../components/LegalDocument/LegalDocument";
import { PageLayout } from "../../components/PageLayout/PageLayout";
import { Seo } from "../../components/Seo/Seo";
import "../Privacy/Privacy.css";

export function SweepstakesRules() {
  return (
    <PageLayout
      variant="narrow"
      className="legal-page"
      title="Sweepstakes Rules"
      subtitle="Official rules for participation and prize redemption."
    >
      <Seo
        title="Sweepstakes Rules"
        path="/sweepstakes"
        description="Official LottaCash rules: eligibility, free entry, prizes, odds, and redemption terms."
      />

      <section className="lc-panel legal-page__panel" aria-label="Sweepstakes Rules text">
        <LegalDocument
          content={SWEEPSTAKES_RULES}
          ariaLabel="Sweepstakes Rules text"
          id="sweepstakes-rules-body"
        />
      </section>
    </PageLayout>
  );
}
