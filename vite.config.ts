import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js is inherently large even with selective imports; it is lazy-
    // loaded only on the home page, so a 1.1 MB chunk is acceptable.
    chunkSizeWarningLimit: 1200,
    // three.js is only needed on the home page (ObsidianScene). Without this
    // filter, Vite's modulePreload leaks the 1.07MB three chunk onto EVERY
    // page via AtmosphericLayer's static import of the lazy ObsidianScene.
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((d) => !d.includes("three")),
    },
    rollupOptions: {
      output: {
        // Split large vendor dependencies into their own chunks so the main
        // bundle stays small and the browser can cache each vendor independently.
        manualChunks: {
          // 3D scene — only needed on the home page.
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          // Supabase client + realtime.
          supabase: ["@supabase/supabase-js"],
          // Animation primitives.
          "framer-motion": ["framer-motion"],
          // Router + React core.
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          // Icon set.
          "lucide-react": ["lucide-react"],
        },
      },
    },
  },
});
