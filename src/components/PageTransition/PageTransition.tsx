import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  minorPageTransitionVariants,
  pageTransitionVariants,
} from "../../lib/motion";

const SECTIONS: Record<string, string> = {
  "/": "home",
  "/originals": "originals",
  "/keno": "originals",
  "/mines": "originals",
  "/limbo": "originals",
  "/roulette": "originals",
  "/blackjack": "originals",
  "/crash": "originals",
  "/case-battles": "battles",
  "/deposit": "wallet",
  "/withdraw": "wallet",
  "/settings": "settings",
  "/profile": "settings",
  "/leaderboard": "promotions",
  "/login": "auth",
  "/signup": "auth",
  "/forgot-password": "auth",
  "/promotions": "promotions",
  "/help": "help",
  "/admin": "admin",
};

function getSection(path: string): string {
  if (SECTIONS[path]) return SECTIONS[path]!;
  for (const [prefix, section] of Object.entries(SECTIONS)) {
    if (prefix !== "/" && path.startsWith(prefix)) return section;
  }
  return "other";
}

type TransitionKind = "initial" | "major" | "minor" | "same";

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
    const fromSection = getSection(prevPath.current ?? "");
    const toSection = getSection(location.pathname);
    kind = fromSection === toSection ? "minor" : "major";
  }

  useEffect(() => {
    prevPath.current = location.pathname;
    isFirst.current = false;
  }, [location.pathname]);

  const variants =
    kind === "minor" || kind === "same"
      ? minorPageTransitionVariants
      : pageTransitionVariants;

  if (reduceMotion) {
    return <div className="lc-page-transition">{children}</div>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        className="lc-page-transition"
        initial={kind === "same" ? false : "initial"}
        animate="animate"
        exit="exit"
        variants={variants}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
