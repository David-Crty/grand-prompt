// Regenerates packages/ui/tokens.gen.css and packages/ui/src/tokens.gen.ts from packages/ui/tokens.json.
// Run after changing tokens.json: `make tokens` (the ui tests fail while the generated files are stale).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TokenFile, toCss, toTs } from "../packages/ui/src/tokens.js";

const dir = join(import.meta.dirname, "../packages/ui");
const tokens = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf8")) as TokenFile;
writeFileSync(
  join(dir, "tokens.gen.css"),
  toCss(tokens, (file) => `./${file}`),
);
writeFileSync(join(dir, "src/tokens.gen.ts"), toTs(tokens));
console.log("wrote packages/ui/tokens.gen.css and packages/ui/src/tokens.gen.ts");
