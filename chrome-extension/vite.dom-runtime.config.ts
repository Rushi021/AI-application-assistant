import { defineConfig } from "vite";
import { resolve } from "path";

// DOM runtime is injected separately by the sidepanel test harness.
// It must also be built as a single IIFE entry for chrome.scripting.executeScript.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        "dom-runtime": resolve(__dirname, "src/content/dom-runtime.ts"),
      },
      output: {
        format: "iife",
        entryFileNames: "content/dom-runtime.js",
        chunkFileNames: "content/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
