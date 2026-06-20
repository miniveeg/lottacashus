import { motion } from "framer-motion";
import { Compass } from "lucide-react";
import { MotionLink } from "../../components/ui/MotionLink";
import { ORIGINALS_PATH } from "../../content/originals";
import "./NotFound.css";

export function NotFound() {
  return (
    <div className="not-found-page">
      <motion.div
        className="not-found-page__glow"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        className="not-found-page__card"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="not-found-page__code"
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          404
        </motion.div>

        <span className="not-found-page__eyebrow">
          <Compass size={11} strokeWidth={2.4} />
          Lost in the lobby
        </span>

        <h1 className="not-found-page__title">Page not found</h1>

        <p className="not-found-page__text">
          That link doesn&rsquo;t exist or may have moved. Head back home or jump straight into
          the house originals.
        </p>

        <div className="not-found-page__actions">
          <MotionLink to="/" variant="primary" glow className="not-found-btn--gold">
            Back to home
          </MotionLink>
          <MotionLink to={ORIGINALS_PATH} variant="secondary" className="not-found-btn--outline">
            Browse originals
          </MotionLink>
        </div>
      </motion.div>
    </div>
  );
}
