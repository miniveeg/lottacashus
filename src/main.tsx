import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App";
import "./styles/global.css";
// Loading.css is imported here (not via the Loading component) so the
// `.lc-loading` / `.lc-loading__pulse` classes remain globally available
// to every page that uses `<div className="lc-loading">` directly —
// preserving backward compat with the previous global.css location.
import "./components/Loading/Loading.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* `reducedMotion="user"` makes every framer-motion animation in the
        tree respect the OS-level `prefers-reduced-motion` setting without
        each component needing its own `useReducedMotion()` guard. Pages and
        components can still override locally if they need to. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>
);
