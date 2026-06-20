import { motion } from "framer-motion";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { SWEEPSTAKES_RULES } from "../../content/legal";
import "../Help/Help.css";

export function SweepstakesRules() {
  return (
    <div className="help lc-page lc-page--narrow">
      <motion.header
        className="lc-page__header help__header"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
        }}
      >
        <motion.span
          className="lc-page__eyebrow"
          variants={{
            hidden: { opacity: 0, y: 14 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          Legal
        </motion.span>
        <motion.h1
          className="lc-page__title"
          variants={{
            hidden: { opacity: 0, y: 14 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          Sweepstakes Rules
        </motion.h1>
        <motion.p
          className="lc-page__subtitle"
          variants={{
            hidden: { opacity: 0, y: 14 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          Official rules for sweepstakes participation and prize redemption. No purchase necessary.
        </motion.p>
      </motion.header>

      <ScrollReveal className="help__panel help__panel--tos" as="section">
        <article className="help__prose">
          {SWEEPSTAKES_RULES.split("\n\n").map((block) => {
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
    </div>
  );
}
