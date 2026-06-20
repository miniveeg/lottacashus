import { useMemo, useState } from "react";
import { Search, ChevronDown, LifeBuoy, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { FAQ_ITEMS, TERMS_OF_SERVICE } from "../../content/help";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Help.css";

type Tab = "faq" | "tos";

export function Help() {
  const [tab, setTab] = useState<Tab>("faq");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [query, setQuery] = useState("");

  const filteredFaq = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_ITEMS.map((item, i) => ({ ...item, index: i }));
    return FAQ_ITEMS
      .map((item, i) => ({ ...item, index: i }))
      .filter(
        (item) =>
          item.question.toLowerCase().includes(q) ||
          item.answer.toLowerCase().includes(q)
      );
  }, [query]);

  return (
    <div className="help lc-page lc-page--narrow">
      <motion.header
        className="lc-page__header help__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="lc-page__eyebrow" variants={fadeUpVariants}>
          <LifeBuoy size={11} strokeWidth={2.4} />
          Help &amp; Legal
        </motion.span>
        <motion.h1 className="lc-page__title" variants={fadeUpVariants}>
          Help &amp; Legal
        </motion.h1>
        <motion.p className="lc-page__subtitle" variants={fadeUpVariants}>
          Answers to common questions and the terms that govern your use of LottaCash. Can&apos;t
          find what you need? Email us anytime.
        </motion.p>
      </motion.header>

      <div className="help__tabs lc-tabs" role="tablist" aria-label="Help sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "faq"}
          className={`help__tab lc-tab${tab === "faq" ? " lc-tab--active" : ""}`}
          onClick={() => setTab("faq")}
        >
          FAQ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tos"}
          className={`help__tab lc-tab${tab === "tos" ? " lc-tab--active" : ""}`}
          onClick={() => setTab("tos")}
        >
          Terms of Service
        </button>
      </div>

      {tab === "faq" && (
        <section className="help__panel" role="tabpanel" aria-label="FAQ">
          <div className="help__search">
            <Search size={16} strokeWidth={2.2} className="help__search-icon" aria-hidden="true" />
            <input
              type="search"
              className="help__search-input"
              placeholder="Search the FAQ…"
              aria-label="Search frequently asked questions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {filteredFaq.length === 0 ? (
            <div className="help__empty">
              <p className="help__empty-title">No matches for &ldquo;{query}&rdquo;</p>
              <p className="help__empty-text">
                Try a different keyword, or email{" "}
                <a href="mailto:support@lottacash.us">support@lottacash.us</a>.
              </p>
            </div>
          ) : (
            <ul className="help__faq-list">
              {filteredFaq.map((item) => {
                const isOpen = openFaq === item.index;
                return (
                  <li key={item.question} className="help__faq-item">
                    <button
                      type="button"
                      className="help__faq-question"
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaq(isOpen ? null : item.index)}
                    >
                      <span>{item.question}</span>
                      <ChevronDown
                        size={18}
                        strokeWidth={2.2}
                        className={`help__faq-chevron${isOpen ? " help__faq-chevron--open" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          className="help__faq-answer"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <p>{item.answer}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="help__contact">
            <Mail size={18} strokeWidth={2} aria-hidden="true" />
            <p>
              Still need help? Email{" "}
              <a href="mailto:support@lottacash.us">support@lottacash.us</a>
            </p>
          </div>
        </section>
      )}

      {tab === "tos" && (
        <ScrollReveal className="help__panel help__panel--tos" as="section">
          <article className="help__prose">
            {TERMS_OF_SERVICE.split("\n\n").map((block) => {
              const trimmed = block.trim();
              if (!trimmed) return null;
              if (/^\d+\.\s/.test(trimmed)) {
                const dot = trimmed.indexOf(" ");
                const heading = trimmed.slice(0, dot);
                const body = trimmed.slice(dot + 1);
                return (
                  <section key={heading} className="help__prose-section">
                    <h2 className="help__prose-heading">{heading}</h2>
                    <p>{body}</p>
                  </section>
                );
              }
              return (
                <p key={trimmed.slice(0, 24)} className="help__prose-meta">
                  {trimmed}
                </p>
              );
            })}
          </article>
        </ScrollReveal>
      )}
    </div>
  );
}
