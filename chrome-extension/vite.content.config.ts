import { defineConfig } from "vite";
import { resolve } from "path";

// Content script must be IIFE — Chrome content scripts cannot use ES module syntax.
// Run after main build: npm run build:content (or build runs this second).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/autofill.ts"),
      },
      output: {
        format: "iife",
        entryFileNames: "content/content.js",
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
