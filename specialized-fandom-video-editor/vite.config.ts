import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // Everything is inlined into one HTML file, so the app has to work from any
  // subpath — a GitHub Pages project site, a CDN, a USB stick, anywhere.
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  server: {
    host: true,
    // The Arena preview is served from a per-session hostname, so any host is
    // allowed in dev — the server is bound to the sandbox, not the internet.
    allowedHosts: true,
  },
  preview: { host: true, allowedHosts: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
