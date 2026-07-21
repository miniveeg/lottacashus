import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js is inherently large even with selective imports; it is lazy-
    // loaded only on the home page, so a 1.1 MB chunk is acceptable.
    chunkSizeWarningLimit: 1200,
    // Drop ONLY `debugger` in production. We intentionally do NOT drop
    // `console.*` — `console.error` and `console.warn` are essential for
    // triaging live issues, and stripping them would kill post-deploy
    // debuggability. The `console.log`/`info`/`debug` noise that survives
    // is acceptable relative to that trade-off (audit: keeps ~1-3KB but
    // preserves observability).
    // See: https://esbuild.github.io/api/#drop
    esbuild: {
      drop: ["debugger"],
    },
    // Lower the asset-inlining threshold: anything >= 2KB is served as its
    // own file (HTTP/2 multiplexing makes the extra request free). This stops
    // medium-sized PNGs/SVGs from being Base64-encoded into JS bundles, which
    // inflates them ~33% and delays asset parsing on the GPU.
    assetsInlineLimit: 2048,
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
