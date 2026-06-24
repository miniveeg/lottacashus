import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Audit-only config: disables HMR (the websocket upgrade through the Caddy
// gateway crashes the dev server) and binds explicitly to 127.0.0.1:3000 so
// the gateway's default route serves the app to the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    hmr: false,
    // Don't auto-open a browser in the sandbox.
    open: false,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    // three.js is only needed on the home page (ObsidianScene). Without this
    // filter, Vite's modulePreload leaks the 1.07MB three chunk onto EVERY
    // page via AtmosphericLayer's static import of the lazy ObsidianScene.
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((d) => !d.includes("three")),
    },
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          supabase: ["@supabase/supabase-js"],
          "framer-motion": ["framer-motion"],
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "lucide-react": ["lucide-react"],
        },
      },
    },
  },
});
