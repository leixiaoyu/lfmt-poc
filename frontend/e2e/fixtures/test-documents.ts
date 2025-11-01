/**
 * Test Document Fixtures for E2E Tests
 *
 * These match the backend integration test fixtures to ensure consistency.
 * See: backend/functions/__tests__/integration/fixtures/test-documents.ts
 */

export const TEST_DOCUMENTS = {
  /**
   * Minimal document - 1 chunk (~200 words)
   * Fast translation for quick E2E tests (30-60 seconds)
   */
  MINIMAL: {
    name: 'minimal-test.txt',
    content: `The Art of Translation

Translation is more than just converting words from one language to another.
It requires understanding context, cultural nuances, and the intended meaning
behind the text. A skilled translator must capture not only the literal meaning
but also the tone, style, and emotional impact of the original work.

In today's globalized world, translation services have become increasingly important.
They enable communication across language barriers, facilitate international business,
and make literature and knowledge accessible to people worldwide.

The challenge of translation lies in preserving the essence of the original while
making it natural and fluent in the target language. This delicate balance is what
separates good translation from great translation.`,
    estimatedChunks: 1,
    estimatedTime: '30-60 seconds',
  },

  /**
   * Small document - 2-3 chunks (~500 words)
   * Moderate translation time for standard E2E tests (1-2 minutes)
   */
  SMALL: {
    name: 'small-test.txt',
    content: `The History of Language Translation

Chapter 1: Ancient Beginnings

The practice of translation dates back thousands of years to ancient civilizations.
The Rosetta Stone, discovered in 1799, stands as one of the most famous examples
of ancient translation work. This granodiorite stele features the same text in
three different scripts: Ancient Egyptian hieroglyphs, Demotic script, and
Ancient Greek.

Throughout history, translation has played a crucial role in the spread of
knowledge, religion, and culture. The translation of religious texts, such as
the Bible and the Quran, has had profound impacts on societies worldwide.
These translations made sacred texts accessible to people who did not speak
the original languages.

Chapter 2: The Evolution of Translation

During the Middle Ages, translation was primarily carried out by monks and
scholars in monasteries. They painstakingly copied and translated manuscripts
by hand, preserving knowledge from ancient civilizations and making it
accessible to new generations.

The invention of the printing press in the 15th century revolutionized
translation work. Books could be produced in larger quantities, and
translations became more widespread. This technological advancement
facilitated the Renaissance and the Scientific Revolution by making
knowledge more accessible across Europe.

Chapter 3: Modern Translation

In the 20th century, translation became a recognized profession with
established standards and training programs. The founding of organizations
like the International Federation of Translators in 1953 helped to
professionalize the field and establish quality standards.

Today, translation is undergoing another revolution with the advent of
machine translation and artificial intelligence. While human translators
remain essential for capturing nuance and cultural context, AI tools are
becoming increasingly sophisticated and useful for preliminary translations
and understanding foreign language texts.

The future of translation lies in the collaboration between human expertise
and machine efficiency, combining the best of both approaches to break down
language barriers more effectively than ever before.`,
    estimatedChunks: 3,
    estimatedTime: '1-2 minutes',
  },
};

/**
 * Get test document by size
 */
export function getTestDocument(size: 'MINIMAL' | 'SMALL') {
  return TEST_DOCUMENTS[size];
}

/**
 * Create a File object from test document content
 * For use with Playwright's file upload functionality
 */
export function createTestFile(size: 'MINIMAL' | 'SMALL'): File {
  const doc = TEST_DOCUMENTS[size];
  const blob = new Blob([doc.content], { type: 'text/plain' });
  return new File([blob], doc.name, { type: 'text/plain' });
}

/**
 * Write test document to filesystem for Playwright upload
 * Returns file path
 */
export function getTestFilePath(size: 'MINIMAL' | 'SMALL'): string {
  // For Playwright, we'll create temporary files on disk
  // This is handled by the test setup
  return `./e2e/fixtures/${TEST_DOCUMENTS[size].name}`;
}

/**
 * Get word count for test document
 */
export function getDocumentWordCount(size: 'MINIMAL' | 'SMALL'): number {
  const content = TEST_DOCUMENTS[size].content;
  return content.trim().split(/\s+/).length;
}
