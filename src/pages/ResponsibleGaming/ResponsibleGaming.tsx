import { RESPONSIBLE_GAMING } from "../../content/legal";
import { LegalDocument } from "../../components/LegalDocument/LegalDocument";
import { PageLayout } from "../../components/PageLayout/PageLayout";
import { Seo } from "../../components/Seo/Seo";
import "../Privacy/Privacy.css";

export function ResponsibleGaming() {
  return (
    <PageLayout
      variant="narrow"
      className="legal-page"
      title="Responsible Gaming"
      subtitle="Tools and resources to help you stay in control."
    >
      <Seo
        title="Responsible Gaming"
        path="/responsible-gaming"
        description="Tools, limits, and self-exclusion options for staying in control of your gambling activity."
      />

      <section className="lc-panel legal-page__panel" aria-label="Responsible Gaming text">
        <LegalDocument
          content={RESPONSIBLE_GAMING}
          ariaLabel="Responsible Gaming text"
          id="responsible-gaming-body"
        />
      </section>
    </PageLayout>
  );
}
