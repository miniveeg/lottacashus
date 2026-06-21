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
          Terms of Service
        </button>
      </div>

      {tab === "faq" && (
        <section
          className="help__panel"
          id="help-panel-faq"
          role="tabpanel"
          aria-labelledby="help-tab-faq"
        >
          <ul className="help__faq-list">
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openFaq === index;
              const buttonId = `help-faq-q-${index}`;
              const panelId = `help-faq-a-${index}`;
              return (
                <li key={item.question} className="help__faq-item">
                  <button
                    type="button"
                    id={buttonId}
                    className="help__faq-question"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
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
          <div className="help__tos">
            {TERMS_OF_SERVICE.split("\n\n").map((block, i) => {
              const trimmed = block.trim();
              if (!trimmed) return null;
              if (/^\d+\.\s/.test(trimmed)) {
                // Split on first newline so the heading is the full "N. Title"
                // and the body is the section text that follows.
                const dot = trimmed.indexOf("\n");
                if (dot === -1) {
                  return (
                    <div key={trimmed} className="help__tos-block">
                      <h3 className="help__tos-heading">{trimmed}</h3>
                    </div>
                  );
                }
                const heading = trimmed.slice(0, dot).trim();
                const body = trimmed.slice(dot + 1).trim();
                return (
                  <div key={heading} className="help__tos-block">
                    <h3 className="help__tos-heading">{heading}</h3>
                    <p>{body}</p>
                  </div>
                );
              }
              return (
                <p key={`meta-${i}`} className="help__tos-meta">
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
