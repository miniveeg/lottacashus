import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";

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

/* Local variants — intentionally avoid `filter: blur()` because blurring
   the entire page wrapper on every route change triggers a full-content
   repaint on the GPU and is the main source of jank during navigation.
   Opacity + a small translate is perceptually equivalent and far cheaper.
   M12 (UI/UX audit): durations shortened — major 0.32s→0.2s, minor 0.22s→0.14s.
   The prior durations felt sluggish on repeated navigation (e.g. clicking
   through game tabs). The new values are still smooth but feel instant. */
const majorVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: [0.4, 0, 0.2, 1] } },
};

const minorVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.14, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -2, transition: { duration: 0.1, ease: [0.4, 0, 0.2, 1] } },
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
    const fromSection = getSection(prevPath.current ?? "");
    const toSection = getSection(location.pathname);
    kind = fromSection === toSection ? "minor" : "major";
  }

  useEffect(() => {
    prevPath.current = location.pathname;
    isFirst.current = false;
  }, [location.pathname]);

  const variants =
    kind === "minor" || kind === "same" ? minorVariants : majorVariants;

  if (reduceMotion) {
    return <div className="lc-page-transition">{children}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
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
