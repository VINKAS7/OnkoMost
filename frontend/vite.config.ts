import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The EBI anatomogram (MDT body map) loads its SVGs and icons with webpack-only dynamic requires
// (require("./svg/" + species + ".svg")). Rewrite them to plain relative URLs, which the component resolves against
// its `atlasUrl` prop; scripts/copy-anatomogram-assets.mjs copies the files to public/anatomogram/ on npm install.
const ANATOMOGRAM = /anatomogram[\\/]lib[\\/](AnatomogramSvg|Switcher)\.js$/;
const patch = (code: string) =>
  code.replace(/require\("\.\/svg\//g, '("anatomogram/svg/').replace(/require\("\.\/img\//g, '("anatomogram/img/');
const anatomogramAssets = (): Plugin => ({
  name: "anatomogram-assets",
  enforce: "pre",
  transform: (code, id) => (ANATOMOGRAM.test(id) ? { code: patch(code), map: null } : null),
});

export default defineConfig({
  plugins: [anatomogramAssets(), react()],
  // the anatomogram lists React 16 as a dependency; make it use the app's React 18
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [{
        name: "anatomogram-assets",
        setup(build) {
          build.onLoad({ filter: ANATOMOGRAM }, (args) => ({ contents: patch(readFileSync(args.path, "utf8")), loader: "js" }));
        },
      }],
    },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
});
