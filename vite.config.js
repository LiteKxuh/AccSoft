import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Strip the `crossorigin` attribute Vite injects into the built index.html.
// Electron loads dist/index.html via the file:// protocol where every file is
// treated as an opaque origin; `crossorigin` then triggers a CORS check that
// fails and the script never executes (renderer renders blank).
const stripCrossorigin = {
  name: "hotelops:strip-crossorigin",
  enforce: "post",
  transformIndexHtml(html) {
    return html.replace(/\s+crossorigin(="[^"]*")?/g, "");
  },
};

export default defineConfig({
  plugins: [react(), stripCrossorigin],
  // Relative base so the production build works from file:// when loaded by Electron
  base: "./",
  server: {
    port: 5173,
    open: false,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    emptyOutDir: true,
  },
});
