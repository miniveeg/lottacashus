import { useState } from "react";
import { FAQ_ITEMS, TERMS_OF_SERVICE } from "../../content/help";
import "./Help.css";

type Tab = "faq" | "tos";

export function Help() {
  const [tab, setTab] = useState<Tab>("faq");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="help lc-page lc-page--narrow">
      <header className="lc-page__header help__header">
        <h1 className="lc-page__title help__title">Help & Legal</h1>
        <p className="lc-page__subtitle help__subtitle">
          Answers to common questions and the terms that govern your use of LottaCash.
        </p>
      </header>

      <div className="help__tabs" role="tablist" aria-label="Help sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "faq"}
          className={`help__tab${tab === "faq" ? " help__tab--active" : ""}`}
          onClick={() => setTab("faq")}
        >
          FAQ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tos"}
          className={`help__tab${tab === "tos" ? " help__tab--active" : ""}`}
          onClick={() => setTab("tos")}
        >
          Terms of Service
        </button>
      </div>

      {tab === "faq" && (
        <section className="help__panel" role="tabpanel" aria-label="FAQ">
          <ul className="help__faq-list">
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openFaq === index;
              return (
                <li key={item.question} className="help__faq-item">
                  <button
                    type="button"
                    className="help__faq-question"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                  >
                    <span>{item.question}</span>
                    <span className="help__faq-chevron" aria-hidden="true">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && <div className="help__faq-answer">{item.answer}</div>}
                </li>
              );
            })}
          </ul>
          <p className="help__contact">
            Still need help? Email{" "}
            <a href="mailto:support@lottacash.us">support@lottacash.us</a>
          </p>
        </section>
      )}

      {tab === "tos" && (
        <section className="help__panel help__panel--tos" role="tabpanel" aria-label="Terms of Service">
          <div className="help__tos">
            {TERMS_OF_SERVICE.split("\n\n").map((block) => {
              const trimmed = block.trim();
              if (!trimmed) return null;
              if (/^\d+\.\s/.test(trimmed)) {
                const dot = trimmed.indexOf(" ");
                const heading = trimmed.slice(0, dot);
                const body = trimmed.slice(dot + 1);
                return (
                  <div key={heading} className="help__tos-block">
                    <h3 className="help__tos-heading">{heading}</h3>
                    <p>{body}</p>
                  </div>
                );
              }
              return (
                <p key={trimmed.slice(0, 24)} className="help__tos-meta">
                  {trimmed}
                </p>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
