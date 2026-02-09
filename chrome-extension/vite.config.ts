import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-extension-files",
      closeBundle() {
        // Copy manifest.json to dist
        copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(__dirname, "dist/manifest.json")
        );
        // Copy icons
        const iconsDir = resolve(__dirname, "dist/icons");
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        const srcIcons = resolve(__dirname, "public/icons");
        if (existsSync(srcIcons)) {
          for (const size of ["icon-16.png", "icon-48.png", "icon-128.png"]) {
            const src = resolve(srcIcons, size);
            if (existsSync(src)) copyFileSync(src, resolve(iconsDir, size));
          }
        }
        // Copy content.css
        const contentCss = resolve(__dirname, "src/content/content.css");
        if (existsSync(contentCss)) {
          const destDir = resolve(__dirname, "dist/content");
          if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
          copyFileSync(contentCss, resolve(destDir, "content.css"));
        }
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/autofill.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "service-worker") return "background/service-worker.js";
          if (chunkInfo.name === "content") return "content/content.js";
          return "sidepanel/[name]-[hash].js";
        },
        chunkFileNames: "sidepanel/chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "sidepanel/[name]-[hash].[ext]";
          }
          return "assets/[name]-[hash].[ext]";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
