// Dual-package boundary contract tests (PR #203 R4 item 1).
//
// These tests guard the ESM + CJS dual-package contract from drift. The
// migration in R3 made `@lfmt/shared-types` shippable as both formats via
// the `exports` map; R4 fixed a Critical where the ESM build emitted
// extensionless imports that failed Node-native resolution. Without
// regression coverage, either of those wins could silently regress.
//
// Strategy: spawn FRESH Node processes (not in-process require/import)
// because Jest itself runs under ts-jest and would resolve from src/ via
// the `paths`/transform pipeline — bypassing the dist/ output entirely.
// Spawning child processes forces resolution through the actual published
// `exports` map exactly as a downstream consumer would experience it.
//
// Coverage:
//   1. dist/cjs/index.js exists and is a CommonJS module.
//   2. dist/esm/index.js exists and is a true ESM module (real `import`/
//      `export` syntax, not transpiled `require`/`exports`).
//   3. The `exports` map in package.json points at file paths that
//      actually exist on disk.
//   4. Node CJS `require()` resolves the package and exposes the key
//      named exports (constants AND functions).
//   5. Node-native ESM dynamic `import()` resolves the package and
//      exposes the SAME key named exports — this is the regression guard
//      for the R4 Critical (extensionless imports failing
//      ERR_MODULE_NOT_FOUND under Node-native ESM).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Resolve the package root (shared-types/) relative to this test file:
//   __dirname = .../shared-types/src/__tests__
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const PKG_JSON_PATH = path.join(PKG_ROOT, 'package.json');
const CJS_ENTRY = path.join(PKG_ROOT, 'dist', 'cjs', 'index.js');
const ESM_ENTRY = path.join(PKG_ROOT, 'dist', 'esm', 'index.js');

// Sample of named exports the test asserts both formats expose. Picked
// to span: type definition (TranslationJobStatus → erased; not testable
// at runtime), VALUE constants (CHUNKING_ERROR_STATUSES,
// TRANSLATION_TERMINAL_STATUSES, ATTESTATION_VERSION, FILE_VALIDATION),
// and a runtime utility object (ValidationUtils).
const REQUIRED_EXPORTS = [
  'CHUNKING_ERROR_STATUSES',
  'TRANSLATION_TERMINAL_STATUSES',
  'ATTESTATION_VERSION',
  'FILE_VALIDATION',
  'ValidationUtils',
];

describe('Dual-package boundary contract (PR #203 R4)', () => {
  // Sanity: run `npm run build` first if dist/ is missing or stale. We do
  // NOT spawn the build here — it's expensive and the assumption is that
  // `npm test` is preceded by `npm run build` (the standard workflow).
  // This describe-level guard fails fast with a useful message instead of
  // letting the per-test child-process spawns produce confusing errors.
  beforeAll(() => {
    if (!fs.existsSync(CJS_ENTRY) || !fs.existsSync(ESM_ENTRY)) {
      throw new Error(
        `Dual-package contract tests require a built dist/. Run \`npm run build\` `
          + `before \`npm test\`. Missing entries:\n`
          + `  CJS: ${CJS_ENTRY} ${fs.existsSync(CJS_ENTRY) ? '✓' : '✗'}\n`
          + `  ESM: ${ESM_ENTRY} ${fs.existsSync(ESM_ENTRY) ? '✓' : '✗'}`
      );
    }
  });

  describe('package.json exports map', () => {
    test('every path referenced in the exports map exists on disk', () => {
      // Parse the published package.json (NOT a re-imported copy — we
      // want the actual file on disk that npm/Node would consult).
      const pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8')) as {
        exports?: Record<string, string | Record<string, string>>;
      };
      expect(pkg.exports).toBeDefined();

      // Walk the exports map collecting every leaf string value (path).
      const collectPaths = (obj: unknown): string[] => {
        if (typeof obj === 'string') return [obj];
        if (obj && typeof obj === 'object') {
          return Object.values(obj).flatMap(collectPaths);
        }
        return [];
      };
      const referencedPaths = collectPaths(pkg.exports);
      expect(referencedPaths.length).toBeGreaterThan(0);

      for (const relPath of referencedPaths) {
        // exports paths are spec'd to start with './' relative to the
        // package root.
        expect(relPath.startsWith('./')).toBe(true);
        const absPath = path.resolve(PKG_ROOT, relPath);
        if (!fs.existsSync(absPath)) {
          throw new Error(
            `package.json exports map references non-existent path: ${relPath} `
              + `(resolved to ${absPath})`
          );
        }
      }
    });

    test('exports map declares both `import` and `require` conditions', () => {
      const pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8')) as {
        exports?: { '.'?: Record<string, string> };
      };
      const rootExport = pkg.exports?.['.'];
      expect(rootExport).toBeDefined();
      // Type narrowing — these conditions are the dual-package contract.
      expect(rootExport).toHaveProperty('import');
      expect(rootExport).toHaveProperty('require');
      expect(rootExport).toHaveProperty('types');
    });
  });

  describe('CommonJS consumer', () => {
    test('Node `require()` resolves dist/cjs/index.js and exposes named exports', () => {
      // Spawn a fresh CJS Node process. Print a JSON envelope so we can
      // assert structurally without parsing console formatting. Uses
      // execFileSync so any non-zero exit code throws and the test fails
      // with the actual stderr attached.
      const probe = `
        const m = require(${JSON.stringify(CJS_ENTRY)});
        const keys = Object.keys(m);
        const missing = ${JSON.stringify(REQUIRED_EXPORTS)}.filter(k => !(k in m));
        process.stdout.write(JSON.stringify({ keyCount: keys.length, missing }));
      `;
      const stdout = execFileSync(process.execPath, ['--eval', probe], {
        encoding: 'utf8',
      });
      const result = JSON.parse(stdout) as { keyCount: number; missing: string[] };
      expect(result.missing).toEqual([]);
      expect(result.keyCount).toBeGreaterThanOrEqual(REQUIRED_EXPORTS.length);
    });

    test('dist/cjs has {"type":"commonjs"} package.json stub', () => {
      const stubPath = path.join(PKG_ROOT, 'dist', 'cjs', 'package.json');
      expect(fs.existsSync(stubPath)).toBe(true);
      const stub = JSON.parse(fs.readFileSync(stubPath, 'utf8')) as { type?: string };
      expect(stub.type).toBe('commonjs');
    });
  });

  describe('ESM consumer (regression guard for R4 Critical)', () => {
    test('Node-native dynamic `import()` resolves dist/esm/index.js and exposes named exports', () => {
      // Spawn a fresh ESM Node process. `--input-type=module` makes
      // `--eval` parse as ESM so we can use top-level await + import().
      // If the R4 Critical regresses (extensionless relative imports
      // re-introduced into the ESM build), this spawn will exit non-zero
      // with ERR_MODULE_NOT_FOUND and the test will fail loudly with the
      // exact missing module path in stderr.
      const probe = `
        const m = await import(${JSON.stringify(ESM_ENTRY)});
        const keys = Object.keys(m);
        const missing = ${JSON.stringify(REQUIRED_EXPORTS)}.filter(k => !(k in m));
        process.stdout.write(JSON.stringify({ keyCount: keys.length, missing }));
      `;
      const stdout = execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', probe],
        { encoding: 'utf8' }
      );
      const result = JSON.parse(stdout) as { keyCount: number; missing: string[] };
      expect(result.missing).toEqual([]);
      expect(result.keyCount).toBeGreaterThanOrEqual(REQUIRED_EXPORTS.length);
    });

    test('dist/esm has {"type":"module"} package.json stub', () => {
      const stubPath = path.join(PKG_ROOT, 'dist', 'esm', 'package.json');
      expect(fs.existsSync(stubPath)).toBe(true);
      const stub = JSON.parse(fs.readFileSync(stubPath, 'utf8')) as { type?: string };
      expect(stub.type).toBe('module');
    });

    test('dist/esm/index.js uses real ESM syntax (not transpiled require/exports)', () => {
      // Defence in depth: even if the contract test above passes (which
      // requires Node-native runtime resolution), we ALSO assert at the
      // source level that the file uses ESM syntax. This catches the
      // failure mode where someone's tsc config silently emits CJS into
      // dist/esm/ but the import call happens to succeed via interop —
      // which would still violate the "ESM consumer gets ESM" contract
      // and break Vite/Rollup's named-export static analysis (the
      // original PR #202 → #204 problem).
      const content = fs.readFileSync(ESM_ENTRY, 'utf8');
      // Real ESM: top-level `export ` statements appear; transpiled CJS
      // would use `exports.X = ...` with no top-level `export` keyword.
      const hasTopLevelExport = /^export\s+/m.test(content);
      const hasCjsExports = /^\s*exports\./m.test(content);
      expect(hasTopLevelExport).toBe(true);
      expect(hasCjsExports).toBe(false);
    });
  });
});
