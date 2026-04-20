# Demo Content Plan - Phase 10

**Created**: 2025-12-21
**Purpose**: Prepare demo materials for investor presentations and alpha user testing

---

## Test Document Selection

Based on Project Gutenberg analysis, we'll use the following documents for demo:

### 1. Small Document (~65K words)

**Book**: "The Adventures of Sherlock Holmes" by Arthur Conan Doyle

- **Project Gutenberg ID**: [1661](https://www.gutenberg.org/ebooks/1661)
- **Estimated Word Count**: ~70,000 words (actual file: 107,562)
- **Download**: https://www.gutenberg.org/files/1661/1661-0.txt
- **Translation Target**: Spanish
- **Expected Processing Time (free tier)**: ~140 chunks at 5 RPM ≈ 28 min of chunk processing; 25 RPD means this book needs **~6 days of staggered runs** OR paid-tier for single-session execution
- **Chapter-level live demo**: "A Scandal in Bohemia" (~12K words, ~5 chunks) completes in ~60s — fits free tier trivially
- **Estimated Cost (paid-tier fallback)**: $0.05-0.07

### 2. Medium Document (~100K words)

**Book**: "Pride and Prejudice" by Jane Austen

- **Project Gutenberg ID**: [1342](https://www.gutenberg.org/ebooks/1342)
- **Estimated Word Count**: 127,633 words ([source](https://www.readinglength.com/book/B4ym2lv))
- **Download**: https://www.gutenberg.org/files/1342/1342-0.txt
- **Translation Target**: French
- **Expected Processing Time (free tier)**: ~170 chunks at 5 RPM ≈ 34 min of chunk processing; **~7 days of staggered runs** within 25 RPD OR paid-tier for single-session
- **Chapter-level live demo**: Chapter 1 (~800 words, 1 chunk) completes in ~12s
- **Estimated Cost (paid-tier fallback)**: $0.05-0.08

### 3. Large Document (~400K words)

**Book**: "War and Peace" by Leo Tolstoy

- **Project Gutenberg ID**: [2600](https://www.gutenberg.org/ebooks/2600)
- **Estimated Word Count**: 587,287 words ([source](https://wordcounter.net/blog/2016/10/28/102640_how-many-words-is-war-and-peace.html)); actual file 566,338
- **Download**: https://www.gutenberg.org/files/2600/2600-0.txt
- **Translation Target**: German
- **Expected Processing Time (free tier)**: ~755 chunks at 5 RPM ≈ 2.5 hours of chunk processing; **~30 days of staggered runs** within 25 RPD — **paid-tier required for single-session demo**
- **Chapter-level live demo**: Book 1 Chapter 1 (~2K words, 1 chunk) completes in ~12s
- **Estimated Cost (paid-tier fallback)**: $0.08-0.15

### Alternative: Medium-Large Document (~250K words)

**Book**: "Moby Dick" by Herman Melville

- **Project Gutenberg ID**: [2701](https://www.gutenberg.org/ebooks/2701)
- **Estimated Word Count**: ~210,000 words
- **Download**: https://www.gutenberg.org/files/2701/2701-0.txt
- **Translation Target**: Italian
- **Expected Processing Time (free tier)**: ~280 chunks; staggered ~12 days within 25 RPD OR paid-tier for single-session
- **Estimated Cost (paid-tier fallback)**: $0.05-0.07

---

## Demo Strategy — Two Tracks

The free-tier Gemini rate limits (5 RPM / 250K TPM / **25 RPD**) force a split between what can be shown live and what must be pre-captured:

### Track A — Live during pitch (fits free tier trivially)

- Upload **one chapter** from any of the three books live
- ~1-5 Gemini requests per chapter
- Completes in **<2 minutes**
- Zero risk of hitting the 25 RPD ceiling mid-demo
- Examples: Sherlock "A Scandal in Bohemia" (~5 chunks), P&P Ch1 (1 chunk), W&P Bk1 Ch1 (1 chunk)

### Track B — Pre-recorded showcase (full books)

- Full-book translations staggered across **5-6 days each** within the 25 RPD ceiling
  - Sherlock Holmes full (~140 chunks) → ~6 days staggered
  - Pride & Prejudice full (~170 chunks) → ~7 days staggered
  - War & Peace full (~755 chunks) → ~30 days staggered (or paid-tier for single-session)
- Capture screenshots at key milestones (upload, 25%, 50%, 75%, completion)
- Produce time-compressed video of full-book translation as demo fallback
- Pre-load completed jobs into the demo user's history so the "already translated" view is realistic

### Cost Clarification

- **Free tier** = $0 (sufficient for all Track A demo traffic and staggered Track B captures)
- **Paid-tier fallback** = Gemini 2.5 Flash pricing: $0.075/1M input tokens + $0.30/1M output tokens
  - Per book: ~$0.05-0.15
  - All 3 books at paid tier: **$0.15-$0.22 total**
- Even under worst-case paid usage, demo prep is financially trivial — the constraint is rate-limiting, not cost.

---

## Demo User Account

**Email**: `demo@lfmt-poc.dev`
**Password**: (Will be created during setup)
**Purpose**: Clean account for investor demos and screenshots

**Pre-loaded Content**:

- 3-4 completed translations (showcasing different languages)
- Translation history showing successful jobs
- Varied document sizes to demonstrate scalability

---

## Translation Quality Metrics to Capture

For each demo translation, we'll document:

### 1. Performance Metrics

- Total processing time (actual vs estimated)
- Chunks processed / total chunks
- Average chunk processing time
- Rate limiting delays (if any)

### 2. Cost Metrics

- Gemini API tokens used (input + output)
- Estimated cost per translation
- Cost per 1000 words
- Total cost for demo set

### 3. Quality Metrics

- Translation coherence score (manual evaluation)
- Context preservation between chunks
- Semantic accuracy (spot-check key passages)
- Formatting preservation (paragraphs, chapters)

### 4. Technical Metrics

- Step Functions execution time
- Lambda cold start impact
- S3 upload/download times
- DynamoDB query latency

---

## Demo Workflow

### Phase 1: Document Preparation (Day 1)

1. Download test documents from Project Gutenberg
2. Clean up Project Gutenberg headers/footers
3. Validate UTF-8 encoding
4. Count exact word counts using `wc -w`

### Phase 2: Translation Execution (Day 1-2)

1. Create demo user account in dev environment
2. Upload and translate small document (Sherlock Holmes)
3. Monitor progress and capture metrics
4. Upload and translate medium document (Pride and Prejudice)
5. Upload and translate large document (War and Peace) - overnight run
6. Upload optional medium-large document (Moby Dick)

### Phase 3: Results Documentation (Day 2-3)

1. Screenshot translation history page
2. Download translated documents
3. Spot-check translation quality (5-10 passages per document)
4. Create metrics summary table
5. Document any issues encountered

### Phase 4: Demo Documentation (Day 3-4)

1. Create investor pitch deck slides
2. Write demo script with talking points
3. Prepare FAQ document
4. Create key differentiators document

---

## Success Criteria

- ✅ All 3 documents translate successfully (>90% chunks processed)
- ✅ Processing times within 150% of estimates
- ✅ Total demo translation cost <$0.50
- ✅ Translation quality verified as coherent
- ✅ No permanent processing failures
- ✅ Demo materials ready for presentation

---

## Timeline

**Day 1 (Today)**: Document preparation and small/medium translations
**Day 2**: Large document translation (overnight) + results analysis
**Day 3**: Demo documentation creation
**Day 4**: Final review and polish

**Target Completion**: 2025-12-24 (3 days from now)

---

## References

- [Project Gutenberg Top 100](https://www.gutenberg.org/browse/scores/top)
- [Word Count Analysis](https://www.anycount.com/word-count-of-books/word-count-of-top-100-books/)
- [War and Peace Word Count](https://wordcounter.net/blog/2016/10/28/102640_how-many-words-is-war-and-peace.html)
- PROGRESS.md - Phase 10 requirements
