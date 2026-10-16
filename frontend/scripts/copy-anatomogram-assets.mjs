// Copies the anatomogram's human SVGs and view-switcher icons into public/anatomogram/,
// where the patched library code (see vite.config.ts) loads them from.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "node_modules", "@ebi-gene-expression-group", "anatomogram", "lib");
const out = join(root, "public", "anatomogram");

if (!existsSync(lib)) {
  console.error("anatomogram package not installed yet - run npm install");
  process.exit(1);
}

for (const [dir, keep] of [
  ["svg", (f) => f.startsWith("homo_sapiens.")],
  ["img", (f) => /^(male|female|brain)\./.test(f)],
]) {
  mkdirSync(join(out, dir), { recursive: true });
  for (const f of readdirSync(join(lib, dir)).filter(keep)) cpSync(join(lib, dir, f), join(out, dir, f));
}
console.log("anatomogram assets copied to public/anatomogram");
