import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";
// Loading.css is imported here (not via the Loading component) so the
// `.lc-loading` / `.lc-loading__pulse` classes remain globally available
// to every page that uses `<div className="lc-loading">` directly —
// preserving backward compat with the previous global.css location.
import "./components/Loading/Loading.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
