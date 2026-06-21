import { motion } from "framer-motion";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { PRIVACY_POLICY } from "../../content/legal";
import "../Help/Help.css";

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export function Privacy() {
  return (
    <div className="help-page legal-page lc-page lc-page--narrow">
      <motion.header
        className="help-page__header"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.span className="help-page__eyebrow" variants={fadeUp}>
          Legal
        </motion.span>
        <motion.h1 className="help-page__title" variants={fadeUp}>
          Privacy Policy
        </motion.h1>
        <motion.p className="help-page__subtitle" variants={fadeUp}>
          How we collect, use, and protect your information when you use LottaCash.
        </motion.p>
      </motion.header>

      <ScrollReveal className="help-panel help-panel--prose" as="section">
        <article className="help-prose">
          {PRIVACY_POLICY.split("\n\n").map((block) => {
            const trimmed = block.trim();
            if (!trimmed) return null;
            if (/^\d+\.\s/.test(trimmed)) {
              const dot = trimmed.indexOf(" ");
              const heading = trimmed.slice(0, dot);
              const body = trimmed.slice(dot + 1);
              const firstLineEnd = body.indexOf("\n");
              const title = firstLineEnd >= 0 ? body.slice(0, firstLineEnd) : body;
              const description = firstLineEnd >= 0 ? body.slice(firstLineEnd + 1).trim() : "";
              return (
                <section key={heading} className="help-prose__section">
                  <h2 className="help-prose__heading">
                    <span className="help-prose__heading-num" aria-hidden="true">
                      {heading}
                    </span>
                    <span className="help-prose__heading-title">{title}</span>
                  </h2>
                  {description ? <p className="help-prose__body">{description}</p> : null}
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
      </ScrollReveal>
    </div>
  );
}
