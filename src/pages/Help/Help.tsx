import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ChevronDown,
  LifeBuoy,
  Mail,
  ShieldCheck,
  FileText,
  Coins,
  Scale,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { FAQ_ITEMS, TERMS_OF_SERVICE } from "../../content/help";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Help.css";

type Tab = "faq" | "tos";

type FaqCategory = {
  label: string;
  items: { item: (typeof FAQ_ITEMS)[number]; index: number }[];
};

function categorize(
  items: { item: (typeof FAQ_ITEMS)[number]; index: number }[],
): FaqCategory[] {
  const buckets: Record<string, { item: (typeof FAQ_ITEMS)[number]; index: number }[]> = {
    Basics: [],
    Account: [],
    "Wallet & payouts": [],
    "Games & fairness": [],
    Other: [],
  };

  const bucketFor = (q: string, a: string): keyof typeof buckets => {
    const text = (q + " " + a).toLowerCase();
    if (/account|signup|sign up|password|discord|username/.test(text)) return "Account";
    if (/deposit|withdraw|redemption|redeem|wallet|balance|sc|sweeps|paypal|crypto|currency/.test(text))
      return "Wallet & payouts";
    if (/game|keno|mines|limbo|roulette|blackjack|crash|slots|case|provably|fair|originals/.test(text))
      return "Games & fairness";
    if (/lottacash|what is|who can|support|eligibility/.test(text)) return "Basics";
    return "Other";
  };

  for (const item of items) {
    buckets[bucketFor(item.item.question, item.item.answer)].push(item);
  }

  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, items: list }));
}

const RAIL_LINKS = [
  { to: "/privacy", label: "Privacy Policy", icon: ShieldCheck },
  { to: "/sweepstakes", label: "Sweepstakes Rules", icon: Scale },
  { to: "/free-entry", label: "Free Entry (mail-in SC)", icon: Coins },
];

export function Help() {
  const [tab, setTab] = useState<Tab>("faq");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [query, setQuery] = useState("");

  const filteredFaq = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_ITEMS.map((item, i) => ({ item, index: i }));
    return FAQ_ITEMS.map((item, i) => ({ item, index: i })).filter(
      (entry) =>
        entry.item.question.toLowerCase().includes(q) ||
        entry.item.answer.toLowerCase().includes(q),
    );
  }, [query]);

  const categories = useMemo(() => categorize(filteredFaq), [filteredFaq]);

  return (
    <div className="help-page lc-page lc-page--wide">
      {/* ── Header ── */}
      <motion.header
        className="help-page__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="help-page__eyebrow" variants={fadeUpVariants}>
          <LifeBuoy size={12} strokeWidth={2.4} />
          Help &amp; Legal
        </motion.span>
        <motion.h1 className="help-page__title" variants={fadeUpVariants}>
          Help &amp; Legal
        </motion.h1>
        <motion.p className="help-page__subtitle" variants={fadeUpVariants}>
          Answers to common questions and the terms that govern your use of LottaCash.
          Can&rsquo;t find what you need? Email us anytime.
        </motion.p>
      </motion.header>

      {/* ── Tabs (full-width, prominent) ── */}
      <div className="help-tabs" role="tablist" aria-label="Help sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "faq"}
          className={`help-tab${tab === "faq" ? " help-tab--active" : ""}`}
          onClick={() => setTab("faq")}
        >
          FAQ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tos"}
          className={`help-tab${tab === "tos" ? " help-tab--active" : ""}`}
          onClick={() => setTab("tos")}
        >
          Terms of Service
        </button>
      </div>

      {/* ── Two-column layout: main + rail ── */}
      <div className="help-page__layout">
        <div className="help-page__main">
          {/* ── FAQ ── */}
          {tab === "faq" && (
            <section className="help-panel" role="tabpanel" aria-label="FAQ">
              <div className="help-search">
                <Search
                  size={16}
                  strokeWidth={2.2}
                  className="help-search__icon"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  className="help-search__input"
                  placeholder="Search the FAQ…"
                  aria-label="Search frequently asked questions"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {filteredFaq.length === 0 ? (
                <div className="help-empty">
                  <p className="help-empty__title">No matches for &ldquo;{query}&rdquo;</p>
                  <p className="help-empty__text">
                    Try a different keyword, or email{" "}
                    <a href="mailto:support@lottacash.us">support@lottacash.us</a>.
                  </p>
                </div>
              ) : (
                <div className="help-categories">
                  {categories.map((cat) => (
                    <div key={cat.label} className="help-category" id={`cat-${cat.label.replace(/\W+/g, "-").toLowerCase()}`}>
                      <h2 className="help-category__title">
                        <span className="help-category__dot" aria-hidden="true" />
                        {cat.label}
                      </h2>
                      <ul className="help-faq-list">
                        {cat.items.map(({ item, index }) => {
                          const isOpen = openFaq === index;
                          return (
                            <li key={item.question} className="help-faq-item">
                              <button
                                type="button"
                                className="help-faq-question"
                                aria-expanded={isOpen}
                                onClick={() => setOpenFaq(isOpen ? null : index)}
                              >
                                <span>{item.question}</span>
                                <ChevronDown
                                  size={18}
                                  strokeWidth={2.2}
                                  className={`help-faq-chevron${isOpen ? " help-faq-chevron--open" : ""}`}
                                  aria-hidden="true"
                                />
                              </button>
                              <AnimatePresence initial={false}>
                                {isOpen && (
                                  <motion.div
                                    className="help-faq-answer"
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
                    </div>
                  ))}
                </div>
              )}

              <div className="help-contact">
                <Mail size={18} strokeWidth={2} aria-hidden="true" />
                <p>
                  Still need help? Email{" "}
                  <a href="mailto:support@lottacash.us">support@lottacash.us</a>
                </p>
              </div>
            </section>
          )}

          {/* ── Terms of Service ── */}
          {tab === "tos" && (
            <ScrollReveal className="help-panel help-panel--prose" as="section">
              <article className="help-prose">
                {TERMS_OF_SERVICE.split("\n\n").map((block) => {
                  const trimmed = block.trim();
                  if (!trimmed) return null;
                  if (/^\d+\.\s/.test(trimmed)) {
                    const dot = trimmed.indexOf(" ");
                    const heading = trimmed.slice(0, dot);
                    const body = trimmed.slice(dot + 1);
                    const firstLineEnd = body.indexOf("\n");
                    const title =
                      firstLineEnd >= 0 ? body.slice(0, firstLineEnd) : body;
                    const description =
                      firstLineEnd >= 0 ? body.slice(firstLineEnd + 1).trim() : "";
                    return (
                      <section key={heading} className="help-prose__section">
                        <h2 className="help-prose__heading">
                          <span className="help-prose__heading-num" aria-hidden="true">
                            {heading}
                          </span>
                          <span className="help-prose__heading-title">{title}</span>
                        </h2>
                        {description ? (
                          <p className="help-prose__body">{description}</p>
                        ) : null}
                      </section>
                    );
                  }
                  return (
                    <p key={trimmed.slice(0, 24)} className="help-prose__meta">
                      {trimmed}
                    </p>
                  );
                })}
              </article>
              <div className="help-contact">
                <ShieldCheck size={18} strokeWidth={2} aria-hidden="true" />
                <p>
                  Questions about these terms? Email{" "}
                  <a href="mailto:support@lottacash.us">support@lottacash.us</a>
                </p>
              </div>
            </ScrollReveal>
          )}
        </div>

        {/* ── Right rail: related legal + contact ── */}
        <aside className="help-page__rail">
          <ScrollReveal className="help-page__rail-card" as="div">
            <h3 className="help-page__rail-title">
              <FileText size={12} strokeWidth={2.4} />
              Related
            </h3>
            {RAIL_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="help-page__rail-link">
                <link.icon size={14} strokeWidth={2.2} />
                <span>{link.label}</span>
              </Link>
            ))}
          </ScrollReveal>

          <ScrollReveal className="help-page__rail-card" as="div">
            <h3 className="help-page__rail-title">
              <Mail size={12} strokeWidth={2.4} />
              Contact
            </h3>
            <p className="help-page__rail-text">
              Email{" "}
              <a href="mailto:support@lottacash.us">support@lottacash.us</a>{" "}
              for anything not covered here. We usually reply within 24 hours.
            </p>
          </ScrollReveal>
        </aside>
      </div>
    </div>
  );
}
