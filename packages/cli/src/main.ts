#!/usr/bin/env -S npx tsx
import { run } from "./index.js";

try {
  process.exitCode = await run(process.argv.slice(2), (s) => process.stdout.write(s));
} catch (e) {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exitCode = 1;
}
