// Copies the pathway engine (TS → plain ES module) and the diagnostic pathway JSONs into the mockup1 prototype, which
// has no bundler. Run after changing src/engine.ts or mockup1/seed/pathways/diagnostic/*.json:  npm run export:mockup
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url)); // mockup1/
const out = `${root}components/onco-dx-pathway`;
mkdirSync(out, { recursive: true });

const { code } = transformSync(readFileSync(`${root}pathway-viewer/src/engine.ts`, "utf8"), { loader: "ts", format: "esm", target: "es2020" });
writeFileSync(`${out}/engine.js`, `// GENERATED from pathway-viewer/src/engine.ts by \`npm run export:mockup\` – do not edit here.\n${code}`);

const src = `${root}seed/pathways/diagnostic`;
for (const f of readdirSync(src).filter((x) => x.endsWith(".json"))) copyFileSync(`${src}/${f}`, `${root}data/dx-pathway-${f}`);
console.log(`engine.js → ${out}; pathways → mockup1/data/dx-pathway-*.json`);
