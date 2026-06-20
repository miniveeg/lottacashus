import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import "./PageTransition.css";

type TransitionKind = "initial" | "major" | "minor" | "same";

/* Clean fade — opacity only. No transform, no blur. 250ms standard.
   Reduced motion renders the children with no wrapper animation. */
const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
};

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const prevPath = useRef<string | null>(null);
  const isFirst = useRef(true);
  const reduceMotion = useReducedMotion();

  let kind: TransitionKind;

  if (isFirst.current) {
    kind = "initial";
  } else if (prevPath.current === location.pathname) {
    kind = "same";
  } else {
    kind = "major";
  }

  useEffect(() => {
    prevPath.current = location.pathname;
    isFirst.current = false;
  }, [location.pathname]);

  if (reduceMotion) {
    return <div className="lc-page-transition">{children}</div>;
  }

  /* Same-route revisit: no animation, just render children in a stable
     wrapper so the layout doesn't shift. */
  if (kind === "same") {
    return <div className="lc-page-transition">{children}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className="lc-page-transition"
        initial="initial"
        animate="animate"
        exit="exit"
        variants={fadeVariants}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
