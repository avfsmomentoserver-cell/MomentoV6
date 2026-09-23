import path from "path";

import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";

/**
 * Source-bundle pipeline (v6): on every production build, regenerate the
 * step-by-step walkthrough, refresh the in-app docs module, and zip the full
 * platform source into public/downloads — so the Command Center's Download
 * Source button can never drift from the code it ships.
 */
function momentoSourceBundle(): Plugin {
  return {
    name: "momento-source-bundle",
    apply: "build",
    buildStart() {
      try {
        execFileSync("node", ["scripts/build-source-bundle.mjs"], { stdio: "inherit", cwd: __dirname });
        execFileSync("node", ["scripts/generate-docs.mjs"], { stdio: "inherit", cwd: __dirname });
      } catch (e) {
        // bundling is a delivery convenience — never break the app build over it
        console.warn("source-bundle step skipped:", e instanceof Error ? e.message : String(e));
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Proxy API calls to the local wrangler dev server during development
    proxy: mode === "development"
      ? {
          "/api": {
            target: "http://localhost:8000",
            changeOrigin: true,
          },
        }
      : undefined,
    hmr: {
      overlay: false,
    },
  },
  plugins: [momentoSourceBundle(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
