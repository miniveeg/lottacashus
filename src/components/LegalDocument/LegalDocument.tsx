import "./LegalDocument.css";

interface LegalDocumentProps {
  /** Full text block in the canonical "1. Heading\n\nBody" format used by
   *  `src/content/legal.ts` and the TOS section of `src/content/help.ts`. */
  content: string;
  /** If true, automatically split sections by blank lines (L4). Most legal
   *  pages use this; pages that already structure their content can pass
   *  explicit paragraphs instead. */
  parseSections?: boolean;
  /** Optional pre-parsed sections, used when a page wants custom parsing. */
  sections?: LegalSection[];
  /** ARIA label describing this document (defaults to "Document text"). */
  ariaLabel?: string;
  /** Optional id for the outer container. */
  id?: string;
}

export interface LegalSection {
  /** Optional section heading (e.g. "1. Eligibility"). */
  heading?: string;
  /** Body paragraphs for this section. */
  body?: string;
}

/**
 * Canonical long-form legal / ToS renderer.
 *
 * Audit finding (Tier 4): Privacy, SweepstakesRules, ResponsibleGaming,
 * and the TOS tab of Help all used the same "split on \n\n → render
 * numbered headings + body paragraphs" template — three near-identical
 * `if (/^\d+\.\s/.test(trimmed)) { … }` blocks, all importing
 * `../Help/Help.css`. This component produces the same DOM from one place,
 * so any format change ships from one site.
 *
 * Usage:
 *   <LegalDocument content={PRIVACY_POLICY} />
 *   <LegalDocument content={SWEEPSTAKES_RULES} ariaLabel="Sweepstakes rules" />
 */
export function LegalDocument({
  content,
  parseSections = true,
  sections,
  ariaLabel = "Document text",
  id,
}: LegalDocumentProps) {
  // Caller opted-in to explicit sections — render those verbatim.
  if (sections) {
    return (
      <div className="legal-doc" id={id} aria-label={ariaLabel}>
        {renderSections(sections)}
      </div>
    );
  }

  if (!parseSections) {
    return (
      <div className="legal-doc" id={id} aria-label={ariaLabel}>
        {content.split("\n\n").map((p, i) => (
          <p key={i} className="legal-doc__paragraph">
            {p.trim()}
          </p>
        ))}
      </div>
    );
  }

  // Default: section splitting mirrors the existing per-page template —
  // any block that starts with "N. " is treated as a heading + body,
  // everything else is a meta paragraph (introductions, footers, etc).
  const parsed: LegalSection[] = [];
  for (const block of content.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^\d+\.\s/.test(trimmed)) {
      const dot = trimmed.indexOf("\n");
      if (dot === -1) {
        parsed.push({ heading: trimmed });
      } else {
        parsed.push({
          heading: trimmed.slice(0, dot).trim(),
          body: trimmed.slice(dot + 1).trim(),
        });
      }
    } else {
      parsed.push({ body: trimmed });
    }
  }

  return (
    <div className="legal-doc" id={id} aria-label={ariaLabel}>
      {renderSections(parsed)}
    </div>
  );
}

function renderSections(sections: LegalSection[]) {
  return sections.map((section, i) => {
    if (!section.heading) {
      return (
        <p key={`meta-${i}`} className="legal-doc__meta">
          {section.body}
        </p>
      );
    }
    return (
      <div key={section.heading} className="legal-doc__block">
        <h3 className="legal-doc__heading">{section.heading}</h3>
        {section.body && <p className="legal-doc__paragraph">{section.body}</p>}
      </div>
    );
  });
}
