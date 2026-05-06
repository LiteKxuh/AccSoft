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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("xlsx")) return "xlsx";
          if (id.includes("jspdf") || id.includes("html2canvas") || id.includes("dompurify") || id.includes("purify")) return "pdf";
          if (id.includes("lucide-react")) return "icons";
          // Bundle React + everything else with the main app to avoid circular
          // chunk warnings from vite — manual chunking can deadlock when small
          // common deps cycle between split groups.
          return undefined;
        },
      },
    },
  },
});
