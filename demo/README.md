# LFMT POC - Demo Materials

This directory contains demonstration materials for investor presentations and alpha user testing.

## Contents

### `/test-documents/` - Test Translation Documents

Downloaded from [Project Gutenberg](https://www.gutenberg.org/) (public domain):

| File | Book | Word Count | Target Language | Est. Time | Est. Cost |
|------|------|------------|-----------------|-----------|-----------|
| `sherlock-holmes.txt` | The Adventures of Sherlock Holmes | 107,562 | Spanish | 30-45 min | $0.02-0.03 |
| `pride-and-prejudice.txt` | Pride and Prejudice | 127,381 | French | 60-90 min | $0.03-0.04 |
| `war-and-peace.txt` | War and Peace | 566,338 | German | 4-6 hours | $0.10-0.15 |

**Total Demo Set Cost**: ~$0.15-0.22 (well within $50/month budget for 1000 translations)

### `/results/` - Translation Results

Contains completed translations and metrics reports (populated after translation runs).

### Demo Content Plan

See [DEMO-CONTENT-PLAN.md](DEMO-CONTENT-PLAN.md) for detailed execution plan and timeline.

## Demo User Account

**Email**: `demo@lfmt-poc.dev`
**Environment**: Dev (https://d39xcun7144jgl.cloudfront.net)
**Purpose**: Pre-loaded with sample translations for investor demos

## Quick Start - Running Demo Translations

### 1. Access Dev Environment
```bash
# Frontend URL
open https://d39xcun7144jgl.cloudfront.net
```

### 2. Create Demo Account
1. Register with `demo@lfmt-poc.dev` (auto-verified in dev)
2. Login with credentials
3. Navigate to "New Translation" page

### 3. Upload Test Document
1. Select test document from `demo/test-documents/`
2. Choose target language (see table above)
3. Accept legal attestation
4. Click "Start Translation"

### 4. Monitor Progress
1. View translation progress on dashboard
2. Download results when complete
3. Document metrics (see DEMO-CONTENT-PLAN.md)

## Metrics Collection

For each translation, capture:

- **Performance**: Processing time, chunks processed, rate limiting
- **Cost**: Gemini API tokens, cost per translation
- **Quality**: Translation coherence, context preservation
- **Technical**: Step Functions time, Lambda performance

Save metrics to `/results/<document-name>-metrics.json`

## Demo Documentation

Demo materials will be created in this directory:

- `INVESTOR-PITCH-DECK.md` - Technical architecture slides
- `DEMO-SCRIPT.md` - Talking points and demonstration flow
- `FAQ.md` - Investor frequently asked questions
- `KEY-DIFFERENTIATORS.md` - Competitive advantages

## Status

- ✅ Test documents downloaded (3 files)
- ⏳ Demo user account creation
- ⏳ Translation execution
- ⏳ Metrics documentation
- ⏳ Demo documentation creation

**Target Completion**: 2025-12-24

---

*For questions or issues, see [PROGRESS.md](../PROGRESS.md) or contact repository owner.*
