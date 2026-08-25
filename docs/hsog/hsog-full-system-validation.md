# Full-system HSOG validation plan

**Goal:** test the whole Hustronix system with HSOG — without mistaking harness/scaffold for intelligence.

**Runner:** `npm run hsog:full-system` → `ops/scripts/hsog-full-system.ts`  
**Outputs:** `data/hsog-full-system-scorecard.json`, [`hsog-full-system-report.md`](./hsog-full-system-report.md)  
**Related:** [`hsog-complete-performance-report.md`](./hsog-complete-performance-report.md)

## Twelve layers

1. Ingestion → 2. Signals → 3. Intelligence → 4. Decisions → 5. Execution → 6. Governance → 7. Evidence → 8. Retrieval → 9. Organization → 10. Analytics → 11. Chat → 12. End-to-end

## Three tests

| Test | What | Tag expectation |
|---|---|---|
| **A Replay** | Chronology through day 132, labeled triggers → playbooks → real mutations, **no** breaks, **no** finalize | Mix 🟢 product + 🟡 harness |
| **B Adversarial** | Same chronology + day-sim break probes + extra invalid mutation probes | Mostly 🟢 product governance |
| **C Blind** | Evidence-only ingest; strip `hsog_scenario_id` / `event_type` from meta; **no** trigger map | 🔴 detection if decisions stay 0 |

## Tags (mandatory on every row)

| Tag | Meaning |
|---|---|
| 🟢 product | Real pathway |
| 🟡 harness | Corpus/script assisted |
| 🟠 scaffold | Demo seed / finalize |
| 🔴 unimplemented | Missing capability |

## Rules

1. **Do not change the system to make the test pass** before capturing the first scorecard.
2. Separate Spandan demo seed (`hsog:seed-spandan`) from A/B/C grades.
3. Fix failures, then **re-run the same command** for before/after.

## Commands

```powershell
npm run hsog:full-system
npm run hsog:full-system -- --skip-a --skip-b   # blind only (faster)
npm run hsog:day-taste -- --through-day 132     # legacy A+B combined baseline
npm run hsog:seed-spandan                       # demo scaffold — not a grade
```

## Customer-path suite (preferred intelligence test)

For the scientific blind benchmark — dual corpus, production transforms, no playbooks, no finalize — use:

[`hsog-customer-path-validation.md`](./hsog-customer-path-validation.md)

```powershell
npm run hsog:export-blind
npm run hsog:customer-path                 # chrono
npm run hsog:customer-path:all             # chrono+stream+sources+isolated+noise+…
```
