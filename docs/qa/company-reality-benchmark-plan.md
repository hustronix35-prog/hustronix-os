# Company Reality Benchmark — execution plan

Architecture is **frozen**. No new intelligence features until this benchmark passes.

## Regression gate (run first)

```bash
npm run test:production-readiness
npm run test:operating-loop
npm run test:org-intelligence
```

## Blind benchmark

```bash
npm run benchmark:company-reality
npm run benchmark:company-reality -- --size 1200
npm run benchmark:company-reality -- --scale 5000   # stress timing only
```

Pipeline:

```text
Raw artifacts (500–2,000)
  ↓ ingestExternal() — real detected_at, no simDay
  ↓ runSituationDetection() — no simDay, no openWorld flag
  ↓ evaluate vs offline ground truth
```

Outputs:

- `docs/qa/company-reality-benchmark-report.md`
- `data/company-reality-benchmark-scorecard.json`

## Failure classification

| Class | Meaning | Action |
|-------|---------|--------|
| **BUG** | Product correctness failure (e.g. entity leak) | Fix |
| **LIMITATION** | Genuinely ambiguous language | Document; may not fix |
| **EXPECTED** | Correct withholding (single vague message) | None |
| **UX** | Intelligence OK but founder can't understand why | Fix product surface |

## Metrics

| Metric | Question |
|--------|----------|
| Discovery | Did it notice the problem? |
| Entity isolation | Did Acme evidence stay off Northstar? |
| Evidence | Did it attach the right signals? |
| Temporal | Did progression use real dates? |
| Contradiction | Did conflicting evidence delay READY? |
| Readiness | READY at the appropriate point? |
| False-ready | Unnecessary decisions? |
| De-escalation | Recognized resolution? |
| Reopening | Recurring problems reopened? |

## After benchmark

1. Fix **BUG** items only (no architecture rewrites).
2. Re-run full benchmark until 0 BUGs.
3. Founder Journey (fresh tenant, zero explanation).
4. Design partners (3–5 companies, observe-only week 1).

Milestone: messy operational feed → correct separate situations → withhold when appropriate → govern → execute → measure → learn.
