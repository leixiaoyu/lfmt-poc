/**
 * Format Converters — issue #28.
 *
 * Pure-function conversion helpers that turn the assembled translated
 * Markdown document into ePub or PDF bytes. Owned by the
 * downloadTranslation Lambda (and consumed only there).
 *
 * Design decisions:
 *
 * 1. **Pure functions, no I/O.** Each converter takes the source text +
 *    metadata and returns a `Buffer`. The download handler owns S3 reads
 *    and writes; this module is therefore trivially unit-testable without
 *    AWS mocks.
 *
 * 2. **Chapter heuristic — Markdown H1 headings.** The translated source
 *    is plain text where the only structural marker we can rely on is the
 *    blank-line paragraph separator that translateChunk.ts produces. To
 *    give the ePub real chapters we treat any line that starts with a
 *    single `#` (Markdown H1) as a chapter break. Text before the first
 *    H1 lives in a synthetic "Introduction" chapter so we never lose
 *    content. If no H1 is present the entire document becomes one chapter
 *    — readable on every e-reader.
 *
 * 3. **No external network / disk for ePub.** `@lesjoursfr/html-to-epub`
 *    can fetch remote images; the source documents we produce have no
 *    embedded images, but the library still tries to write to a temp
 *    file path by default. We always provide an explicit `tempDir` so
 *    Lambda's writable `/tmp` is used (the only writable FS inside a
 *    Lambda container).
 *
 * 4. **PDF typography.** PDFKit's default Helvetica handles Latin
 *    scripts cleanly. For CJK / non-Latin targets we deliberately do NOT
 *    embed extra fonts in v1: bundling a CJK font (~15 MB) would balloon
 *    the Lambda zip past the 50 MB direct-upload limit, and the casual
 *    reader use-case is satisfied by glyph fallback. Documented as
 *    out-of-scope in the PR body and the OMC R1 self-review.
 *
 * 5. **Pagination is implicit.** PDFKit auto-paginates when content
 *    overflows the page bottom. We use Letter size with 1-inch margins
 *    (good for desktop reading) and a 12 pt body font.
 *
 * 6. **Heading-flood DoS guard.** A malicious actor could craft a
 *    translation full of millions of `# ` heading lines. We cap the
 *    chapter count at MAX_EPUB_CHAPTERS — beyond that, additional `#`
 *    lines are folded into the body text of the previous chapter so the
 *    ePub generator can't be coerced into unbounded TOC growth. See
 *    OMC R1 self-review for the full red-team analysis.
 */

import { EPub } from '@lesjoursfr/html-to-epub';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import MarkdownIt = require('markdown-it');
// eslint-disable-next-line @typescript-eslint/no-var-requires
import PDFDocument = require('pdfkit');
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Upper bound on the number of ePub chapters generated from one document.
 *
 * Rationale: a translated 400 K-word document has on the order of 30–100
 * natural chapters. 500 is two orders of magnitude headroom and gives a
 * deterministic ceiling on the TOC tree the ePub generator must build.
 * Beyond this point we concatenate further `# ` lines into the previous
 * chapter body — content is never lost, only the chapter structure
 * collapses.
 */
const MAX_EPUB_CHAPTERS = 500;

/**
 * Maximum length of any single chapter title, in characters.
 *
 * Prevents pathological inputs (e.g. a 1 MB title injected as a `# ...`
 * line) from being interpolated into the ePub spine. 200 is comfortably
 * above any natural book chapter title.
 */
const MAX_CHAPTER_TITLE_LEN = 200;

/**
 * Inputs for the converters. `title` and `author` populate the ePub
 * metadata block (and the PDF cover line). `markdown` is the fully
 * assembled translation as a single string.
 */
export interface FormatConversionInput {
  /** Job filename (without extension) — surfaces in ePub metadata + PDF header. */
  title: string;
  /**
   * Display author for the ePub <dc:creator> tag and the PDF cover line.
   * For LFMT POC this is always "Translated by LFMT" — there is no
   * end-user author metadata in scope.
   */
  author: string;
  /**
   * Optional language code (BCP 47) — surfaces in ePub <dc:language>.
   * Falls back to 'en' which is the conservative default for e-readers
   * that key off this tag for hyphenation rules.
   */
  language?: string;
  /** The assembled translated Markdown / plain-text body. */
  markdown: string;
}

interface Chapter {
  title: string;
  /** HTML body for this chapter (already sanitised via markdown-it). */
  html: string;
}

/**
 * Split a Markdown body into chapters keyed on `# ` (H1) lines.
 *
 * Lines starting with `# ` (single hash + space, the canonical Markdown
 * H1 marker) begin a new chapter. Everything before the first H1 lands
 * in a synthetic "Introduction" chapter so no content is lost when the
 * source has prose before its first heading (common in translated novels
 * — preface / dedication / colophon).
 *
 * The `MAX_EPUB_CHAPTERS` ceiling caps the number of distinct chapters.
 * Excess H1 lines are folded inline so the generator can never be coerced
 * into an unbounded TOC tree.
 */
function splitMarkdownIntoChapters(markdown: string): Chapter[] {
  const lines = markdown.split('\n');
  const chapters: { title: string; bodyLines: string[] }[] = [
    { title: 'Introduction', bodyLines: [] },
  ];

  for (const line of lines) {
    const headingMatch = /^#\s+(.+)$/.exec(line);
    if (headingMatch && chapters.length < MAX_EPUB_CHAPTERS) {
      // New chapter — start fresh with the heading text as the title.
      const rawTitle = headingMatch[1].trim();
      const title =
        rawTitle.length > MAX_CHAPTER_TITLE_LEN
          ? rawTitle.slice(0, MAX_CHAPTER_TITLE_LEN) + '…'
          : rawTitle;
      chapters.push({ title, bodyLines: [] });
    } else {
      // Either not a heading, or we hit the chapter cap — append to the
      // current chapter body. (Excess headings beyond the cap are still
      // visible as `# ...` lines in the rendered HTML, just not in TOC.)
      chapters[chapters.length - 1].bodyLines.push(line);
    }
  }

  // Drop the synthetic Introduction if it has no content (the common case
  // when the source begins with a heading).
  const filtered = chapters.filter(
    (c, idx) => idx > 0 || c.bodyLines.some((l) => l.trim().length > 0)
  );

  // Render each chapter body through markdown-it once so HTML escaping
  // and link/image normalisation happen consistently across all formats.
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  return filtered.map((c) => ({
    title: c.title,
    html: md.render(c.bodyLines.join('\n')),
  }));
}

/**
 * Convert the assembled translation to an ePub `Buffer`.
 *
 * Uses `@lesjoursfr/html-to-epub` which writes the ePub zip to a
 * filesystem path; we point it at Lambda's writable `/tmp` and then
 * read the file back into a buffer for the caller to upload to S3.
 * We delete the temp file before returning so consecutive invocations
 * in the same warm container don't accumulate stale zips.
 */
export async function convertMarkdownToEpub(input: FormatConversionInput): Promise<Buffer> {
  const chapters = splitMarkdownIntoChapters(input.markdown);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lfmt-epub-'));
  const outputPath = path.join(tempDir, 'translation.epub');

  try {
    const epub = new EPub(
      {
        title: input.title,
        // EpubOptions.description is required by @lesjoursfr/html-to-epub.
        // The casual-reader use case has no curated description, so we
        // synthesise a sensible default keyed off the title.
        description: `Translation of ${input.title}`,
        author: input.author,
        lang: input.language ?? 'en',
        // Disable verbose logging — the library writes to stdout otherwise
        // and pollutes CloudWatch logs.
        verbose: false,
        // Each chapter object: title + html body. The `content` field is
        // mandatory in the library's API; missing chapter titles default
        // to "Chapter N".
        content: chapters.map((c, idx) => ({
          title: c.title || `Chapter ${idx + 1}`,
          data: c.html,
        })),
        // Place generation artefacts in our explicit tmpdir so the library
        // never tries to write to the read-only Lambda root filesystem.
        tempDir,
      },
      outputPath
    );

    // render() returns `{ result: string }` but the side-effect we care
    // about is the file write to `outputPath` — we read that back below.
    await epub.render();
    const buffer = await fs.readFile(outputPath);
    return buffer;
  } finally {
    // Always clean up the tmpdir even on conversion error so warm-container
    // invocations don't accumulate fragments.
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
      // Swallow cleanup errors — the next invocation's mkdtemp creates a
      // fresh path, so a leaked file is at worst an /tmp space-pressure
      // issue (capped at 512 MB by Lambda), not a correctness problem.
    });
  }
}

/**
 * Convert the assembled translation to a PDF `Buffer`.
 *
 * Uses PDFKit's pure-JS pipeline (no native dependencies). Letter page,
 * 1-inch margins, 12 pt body, 18 pt H1, 14 pt H2. Auto-paginates when
 * content overflows; no manual page-break logic required.
 *
 * Implementation note: PDFKit accumulates into a `Buffer[]` and emits
 * `data` events. We resolve the promise on the `end` event with a
 * concatenated buffer — the streaming-builder pattern from the PDFKit
 * docs.
 */
export function convertMarkdownToPdf(input: FormatConversionInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: input.title,
          Author: input.author,
          Creator: 'LFMT POC',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Cover header
      doc
        .fontSize(20)
        .text(input.title, { align: 'center' })
        .moveDown(0.5)
        .fontSize(12)
        .fillColor('#666666')
        .text(input.author, { align: 'center' })
        .fillColor('#000000')
        .moveDown(2);

      // Render the source line-by-line so we can react to `# `/`## ` markers
      // without pulling in a full Markdown→PDF pipeline. The cost of a true
      // styled renderer (custom fonts, inline emphasis) is out of scope for
      // v1 — pragmatic readable output is the goal, not typographic fidelity.
      const lines = input.markdown.split('\n');
      for (const line of lines) {
        const h1 = /^#\s+(.+)$/.exec(line);
        const h2 = /^##\s+(.+)$/.exec(line);

        if (h1) {
          // Force a new page before each chapter so the structure mirrors
          // the ePub. The first H1 still gets its own page — acceptable.
          doc.addPage();
          doc.fontSize(18).text(h1[1].trim(), { align: 'left' }).moveDown(1);
        } else if (h2) {
          doc.fontSize(14).text(h2[1].trim(), { align: 'left' }).moveDown(0.5);
        } else if (line.trim().length === 0) {
          // Blank line → paragraph break.
          doc.moveDown(0.5);
        } else {
          doc.fontSize(12).text(line, { align: 'justify' });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
