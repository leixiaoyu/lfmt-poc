/**
 * Unit tests for the ePub + PDF format converters (issue #28).
 *
 * Coverage split:
 *   - PDF path: exercised end-to-end against a real PDFKit pipeline (pure
 *     CJS, transforms cleanly under ts-jest). We assert on the magic bytes
 *     and pagination behaviour.
 *   - ePub path: `@lesjoursfr/html-to-epub` ships as native ESM and the
 *     existing ts-jest preset (CJS) cannot load it without a heavier
 *     transformIgnorePatterns + ESM-jest config change. We mock the
 *     `EPub` class and assert on the call shape — chapter splitting,
 *     metadata, and the DoS-guard upper bounds. End-to-end ePub binary
 *     output is intentionally validated only in the deployed Lambda
 *     (integration coverage), per OMC R1 self-review (item: test-tier
 *     trade-off).
 */

// The mock MUST be declared before the converters under test are imported.
// jest.mock is hoisted automatically; the factory writes a synthetic EPub
// class that records the constructor args and emits a valid ZIP file when
// render() runs (so the downstream readFile + Buffer assertions work).
jest.mock('@lesjoursfr/html-to-epub', () => {
  const mockConstructor = jest.fn();
  class FakeEPub {
    private outputPath: string;
    private options: Record<string, unknown>;
    constructor(options: Record<string, unknown>, outputPath: string) {
      mockConstructor(options, outputPath);
      this.options = options;
      this.outputPath = outputPath;
    }
    async render(): Promise<{ result: string }> {
      // Write a minimal ZIP signature so the downstream readFile + Buffer
      // checks behave as if a real ePub was produced. The body is the
      // standard 'PK\x05\x06' empty-ZIP end-of-central-directory record.
      // Inject 'application/epub+zip' near the start to satisfy the
      // mimetype-byte assertion.
      const epubMime = Buffer.from('application/epub+zip');
      const eocd = Buffer.from([
        0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      // Sentinel `<script` MUST NOT appear — assert by NOT including it.
      const body = Buffer.concat([
        Buffer.from([0x50, 0x4b]), // PK signature
        epubMime,
        // Echo back the chapter HTML (without the literal script tag if
        // markdown-it correctly escaped it) so the XSS test can assert.
        ...(this.options.content as { data: string }[]).map((c) => Buffer.from(c.data)),
        eocd,
      ]);
      const fs = await import('fs');
      await fs.promises.writeFile(this.outputPath, body);
      return { result: 'ok' };
    }
  }
  return { EPub: FakeEPub, __mockConstructor: mockConstructor };
});

import { convertMarkdownToEpub, convertMarkdownToPdf } from './formatConverters';
import * as epubModule from '@lesjoursfr/html-to-epub';

// The mock factory exports `__mockConstructor` (a Jest spy) alongside the
// real `EPub` named export. Cast through `unknown` because the official
// type declarations don't include the spy.
const { __mockConstructor: mockEpubConstructor } = epubModule as unknown as {
  __mockConstructor: jest.Mock;
};

// Heading-flood / DoS guard — keep in sync with formatConverters.ts.
const MAX_EPUB_CHAPTERS = 500;

beforeEach(() => {
  mockEpubConstructor.mockClear();
});

describe('convertMarkdownToPdf', () => {
  it('produces a non-empty Buffer with a valid PDF signature', async () => {
    const buffer = await convertMarkdownToPdf({
      title: 'Test Book',
      author: 'Translator',
      markdown: '# Chapter One\n\nHello world.\n\n## Section\n\nSome body text.',
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    // PDF magic header — every PDF starts with `%PDF-`.
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    // PDF EOF marker — exists somewhere in the trailing bytes.
    expect(buffer.includes(Buffer.from('%%EOF'))).toBe(true);
  });

  it('handles an empty markdown body without crashing', async () => {
    const buffer = await convertMarkdownToPdf({
      title: 'Empty',
      author: 'Translator',
      markdown: '',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('handles a malformed-source heading-flood without OOM', async () => {
    // 2000 H1 lines — well past MAX_EPUB_CHAPTERS — verifies the PDF
    // path is also resilient (it uses a different code path than the
    // ePub chapter splitter but should still produce valid output).
    const markdown = Array.from({ length: 2000 }, (_, i) => `# Chapter ${i}`).join('\n');
    const buffer = await convertMarkdownToPdf({
      title: 'Heading Flood',
      author: 'Translator',
      markdown,
    });
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
  }, 30_000);
});

describe('convertMarkdownToEpub', () => {
  it('produces a Buffer matching the ZIP signature emitted by the underlying library', async () => {
    const buffer = await convertMarkdownToEpub({
      title: 'Test Book',
      author: 'Translator',
      markdown: '# Chapter One\n\nHello world.\n\n# Chapter Two\n\nMore text.',
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(20);
    // The mock writes a 'PK' header; real lib does the same.
    expect(buffer.slice(0, 2).toString()).toBe('PK');
    expect(buffer.includes(Buffer.from('application/epub+zip'))).toBe(true);
  });

  it('forwards the expected metadata + chapter shape to the ePub library', async () => {
    await convertMarkdownToEpub({
      title: 'Test Book',
      author: 'Translator',
      language: 'es',
      markdown: '# One\n\nA.\n\n# Two\n\nB.',
    });

    expect(mockEpubConstructor).toHaveBeenCalledTimes(1);
    const [options, outputPath] = mockEpubConstructor.mock.calls[0];
    expect(options).toMatchObject({
      title: 'Test Book',
      author: 'Translator',
      lang: 'es',
      verbose: false,
    });
    expect(typeof options.description).toBe('string');
    expect(options.description.length).toBeGreaterThan(0);
    expect(Array.isArray(options.content)).toBe(true);
    // Two H1 headings → two chapters (the synthetic Introduction is
    // filtered when no content precedes the first H1).
    expect(options.content).toHaveLength(2);
    expect(options.content[0].title).toBe('One');
    expect(options.content[1].title).toBe('Two');
    // Output path lives under Lambda's writable /tmp.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os') as { tmpdir: () => string };
    expect(outputPath.startsWith(os.tmpdir())).toBe(true);
  });

  it('synthesises an Introduction chapter when content precedes the first H1', async () => {
    await convertMarkdownToEpub({
      title: 'With Intro',
      author: 'Translator',
      markdown: 'Foreword text here.\n\n# First Real Chapter\n\nBody.',
    });
    const [options] = mockEpubConstructor.mock.calls[0];
    expect(options.content[0].title).toBe('Introduction');
    expect(options.content[1].title).toBe('First Real Chapter');
  });

  it('falls back to a single chapter when no headings are present', async () => {
    await convertMarkdownToEpub({
      title: 'No Headings',
      author: 'Translator',
      markdown: 'Just a plain paragraph.\n\nAnother paragraph.',
    });
    const [options] = mockEpubConstructor.mock.calls[0];
    expect(options.content).toHaveLength(1);
    expect(options.content[0].title).toBe('Introduction');
  });

  it('caps chapter count at MAX_EPUB_CHAPTERS under heading-flood input', async () => {
    const headings = MAX_EPUB_CHAPTERS + 200;
    const markdown = Array.from(
      { length: headings },
      (_, i) => `# Chapter ${i}\n\nBody ${i}.`
    ).join('\n\n');

    await convertMarkdownToEpub({
      title: 'Heading Flood',
      author: 'Translator',
      markdown,
    });

    const [options] = mockEpubConstructor.mock.calls[0];
    // The first chapter is the synthetic Introduction (empty in this
    // case so it gets filtered) so we expect exactly MAX_EPUB_CHAPTERS.
    expect(options.content.length).toBeLessThanOrEqual(MAX_EPUB_CHAPTERS);
    // And strictly more than e.g. 100 — confirms the cap activated
    // rather than the splitter silently dropping everything.
    expect(options.content.length).toBeGreaterThan(100);
  });

  it('truncates excessively long chapter titles', async () => {
    const longTitle = 'X'.repeat(5000);
    const markdown = `# ${longTitle}\n\nBody.`;

    await convertMarkdownToEpub({
      title: 'Long Title',
      author: 'Translator',
      markdown,
    });
    const [options] = mockEpubConstructor.mock.calls[0];
    // 200-character cap + ellipsis = 201 chars max.
    expect(options.content[0].title.length).toBeLessThanOrEqual(201);
    expect(options.content[0].title.endsWith('…')).toBe(true);
  });

  it('escapes raw HTML in source body (no <script> passthrough)', async () => {
    // markdown-it html: false means raw `<script>` is escaped to
    // `&lt;script&gt;` BEFORE reaching the ePub library.
    const markdown = '# Innocent Chapter\n\n<script>alert(1)</script>\n\nOrdinary text.';
    await convertMarkdownToEpub({
      title: 'XSS Test',
      author: 'Translator',
      markdown,
    });
    const [options] = mockEpubConstructor.mock.calls[0];
    const html = options.content.map((c: { data: string }) => c.data).join('');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script');
  });
});
