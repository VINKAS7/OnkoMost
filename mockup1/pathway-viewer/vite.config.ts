import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pathway JSONs are read from mockup1/seed/pathways and the repo-root seed/pathways at build time (import.meta.glob),
// so the dev server must be allowed to serve the repo root. The production build is self-contained static files.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, host: true, fs: { allow: [repoRoot] } },
  preview: { port: 5180, host: true },
});
