#!/usr/bin/env node
// Build helper: write a per-format package.json into each output directory
// so Node, bundlers, AND TypeScript itself interpret each .js file with
// the correct module type.
//
// Why this is needed:
//   The root shared-types/package.json deliberately has NO `"type"` field
//   so the package's primary identity stays CJS (the historical default
//   that all backend Lambdas relied on). That decision means Node treats
//   every `.js` it loads from this package as CJS unless something
//   overrides it for the dist/esm/ subtree.
//
//   The standard dual-package recipe is to drop a tiny package.json into
//   each output directory that overrides `"type"` for files in that
//   subtree:
//     dist/cjs/package.json -> {"type":"commonjs"}
//     dist/esm/package.json -> {"type":"module"}
//
//   PR #203 R4 also moved this from a *post*-build helper to a *pre*-build
//   helper. Reason: the ESM tsc pass uses `moduleResolution: node16`,
//   which consults the nearest enclosing package.json at compile time to
//   decide whether each .ts file is ESM or CJS. If dist/esm/package.json
//   does not yet exist when tsc runs, node16 walks up to the parent
//   shared-types/package.json (CJS-by-default), and tsc silently emits
//   CJS into dist/esm/. Pre-creating both stub package.json files before
//   either tsc invocation keeps node16 honest.
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
  // mkdir -p semantics: tolerate either fresh build or rebuild.
  fs.mkdirSync(targetDir, { recursive: true });
  const pkgPath = path.join(targetDir, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify({ type }, null, 2) + '\n');
  // eslint-disable-next-line no-console -- intentional build-time notice
  console.log(`[write-format-package-jsons] Wrote ${pkgPath} ({"type":"${type}"})`);
}
