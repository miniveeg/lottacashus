import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { FAQ_ITEMS, TERMS_OF_SERVICE } from "../../content/help";
import { LegalDocument } from "../../components/LegalDocument/LegalDocument";
import { Seo } from "../../components/Seo/Seo";
import "./Help.css";

type Tab = "faq" | "tos";

export function Help() {
  const [tab, setTab] = useState<Tab>("faq");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [query, setQuery] = useState("");

  // FAQPage structured data — emitted as JSON-LD so search engines can render
  // the questions as rich results. Built once from the canonical FAQ content.
  const faqJsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    }),
    [],
  );

  // Filter FAQ items by the search query (matches question OR answer).
  const filteredFaq = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_ITEMS.map((item, originalIndex) => ({ item, originalIndex }));
    return FAQ_ITEMS
      .map((item, originalIndex) => ({ item, originalIndex }))
      .filter(({ item }) =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
      );
  }, [query]);

  return (
    <div className="help lc-page lc-page--narrow">
      <Seo
        title="Help & FAQ"
        description="Answers to common LottaCash questions and the Terms of Service that govern your use of the platform."
        path="/help"
        jsonLd={faqJsonLd}
      />
      <header className="lc-page__header help__header">
        <h1 className="lc-page__title help__title">Help &amp; FAQ</h1>
        <p className="lc-page__subtitle help__subtitle">
          Answers to common questions and the terms that govern your use of LottaCash.
        </p>
      </header>

      <div className="help__tabs" role="tablist" aria-label="Help sections">
        <button
          type="button"
          role="tab"
          id="help-tab-faq"
          aria-selected={tab === "faq"}
          aria-controls="help-panel-faq"
          tabIndex={tab === "faq" ? 0 : -1}
          className={`help__tab${tab === "faq" ? " help__tab--active" : ""}`}
          onClick={() => setTab("faq")}
        >
          FAQ
        </button>
        <button
          type="button"
          role="tab"
          id="help-tab-tos"
          aria-selected={tab === "tos"}
          aria-controls="help-panel-tos"
          tabIndex={tab === "tos" ? 0 : -1}
          className={`help__tab${tab === "tos" ? " help__tab--active" : ""}`}
          onClick={() => setTab("tos")}
        >
          Terms
        </button>
      </div>

      {tab === "faq" && (
        <section
          className="help__panel"
          id="help-panel-faq"
          role="tabpanel"
          aria-labelledby="help-tab-faq"
        >
          <div className="help__search" role="search">
            <Search size={16} aria-hidden="true" className="help__search-icon" />
            <input
              type="search"
              className="help__search-input"
              placeholder="Search questions…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpenFaq(null);
              }}
              aria-label="Search FAQ"
            />
            {query && (
              <button
                type="button"
                className="help__search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {filteredFaq.length === 0 ? (
            <div className="help__faq-empty">
              <p>No questions match &ldquo;{query}&rdquo;.</p>
              <button
                type="button"
                className="help__faq-empty-btn"
                onClick={() => setQuery("")}
              >
                Clear search
              </button>
            </div>
          ) : (
            <ul className="help__faq-list">
              {filteredFaq.map(({ item, originalIndex }) => {
                const isOpen = openFaq === originalIndex;
                const buttonId = `help-faq-q-${originalIndex}`;
                const panelId = `help-faq-a-${originalIndex}`;
                return (
                  <li key={item.question} className="help__faq-item">
                    <button
                      type="button"
                      id={buttonId}
                      className="help__faq-question"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenFaq(isOpen ? null : originalIndex)}
                    >
                      <span>{item.question}</span>
                      <span className="help__faq-chevron" aria-hidden="true">
                        {isOpen ? "−" : "+"}
                      </span>
                    </button>
                    {isOpen && (
                      <div
                        id={panelId}
                        className="help__faq-answer"
                        role="region"
                        aria-labelledby={buttonId}
                      >
                        {item.answer}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="help__contact">
            Still need help? Email{" "}
            <a href="mailto:support@lottacash.us">support@lottacash.us</a>
          </p>
        </section>
      )}

      {tab === "tos" && (
        <section
          className="help__panel help__panel--tos"
          id="help-panel-tos"
          role="tabpanel"
          aria-labelledby="help-tab-tos"
        >
          <LegalDocument content={TERMS_OF_SERVICE} ariaLabel="Terms of Service" />
        </section>
      )}
    </div>
  );
}
