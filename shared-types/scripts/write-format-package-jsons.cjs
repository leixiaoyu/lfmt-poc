#!/usr/bin/env node
// Post-build helper: write a per-format package.json into each output
// directory so Node and bundlers interpret the .js files with the correct
// module type.
//
// Why this is needed:
//   The root shared-types/package.json deliberately has NO `"type"` field,
//   which means Node treats every `.js` it loads from this package as CJS
//   (the default). That's correct for `dist/cjs/*.js` but WRONG for
//   `dist/esm/*.js` — Rollup/Vite would happily import them as ESM, but
//   Node (when a Lambda dynamic-imports the package via the ESM condition)
//   would reject the `import` syntax.
//
// The fix is the standard dual-package recipe: drop a tiny package.json
// into each output directory that overrides `type` for files in that
// subtree:
//   dist/cjs/package.json -> {"type":"commonjs"}
//   dist/esm/package.json -> {"type":"module"}
//
// This file is intentionally a `.cjs` so it runs identically on Node 22
// regardless of any future `"type":"module"` change to the parent
// package.json. Keep it tiny — KISS.
const fs = require('node:fs');
const path = require('node:path');

const distRoot = path.resolve(__dirname, '..', 'dist');

const formats = [
  { dir: 'cjs', type: 'commonjs' },
  { dir: 'esm', type: 'module' },
];

for (const { dir, type } of formats) {
  const targetDir = path.join(distRoot, dir);
  if (!fs.existsSync(targetDir)) {
    // The matching tsc invocation must have failed upstream — fail loud
    // here too rather than silently producing a half-built dual package.
    throw new Error(
      `[write-format-package-jsons] Expected build output at ${targetDir} but it does not exist. ` +
        `Run \`npm run build\` (which invokes both tsc passes) before this script.`
    );
  }
  const pkgPath = path.join(targetDir, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify({ type }, null, 2) + '\n');
  // eslint-disable-next-line no-console -- intentional build-time notice
  console.log(`[write-format-package-jsons] Wrote ${pkgPath} ({"type":"${type}"})`);
}
