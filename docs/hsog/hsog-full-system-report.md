# HSOG full-system validation

Generated: 2026-08-17T16:48:08.844Z  
Through day: **132** · Bundle: `D:\hsog\orgforge\benchmarks\hustronix-enterprise\fixtures\os_ingest.json`

## Tag legend

| Tag | Meaning |
|---|---|
| 🟢 product | Real Hustronix pathway |
| 🟡 harness | Scripted/corpus-assisted (triggers, playbooks, keywords) |
| 🟠 scaffold | Demo seed / finalize / wipe helpers |
| 🔴 unimplemented | Capability not present or not measured yet |

## Scorecard

| Layer | Test | Result | Verdict | Tag | Notes |
|---|---|---|---|---|---|
| 1. Ingestion | A replay artifacts | 117 signals · 50 event days · day_fidelity 100 | PASS | 🟢 product | bundle artifacts≈118 |
| 2. Signals | A integrity (killed=0) | killed 0 · states {"LINKED":38,"UNVERIFIED":79} | PASS | 🟢 product |  |
| 2. Signals | A dedup (replay wipe) | wipe clears hsog dedup then re-ingest | PASS | 🟡 harness | validated by clean second-run design, not double-ingest in this pass |
| 3. Intelligence | A detection | 19/19 trigger→commit (100%) | PASS | 🟡 harness | labeled event_type → PLAYBOOKS — not blind detection |
| 4. Decisions | A draft→commit | {"ACTIVE":8,"DRAFT":1} | PASS | 🟢 product | mutations real; trigger harness |
| 5. Execution | A lifecycle | {"DONE":17} | PASS | 🟢 product | capacity may BLOCK — that is product behavior |
| 7. Evidence | A signal linking | 38 LINKED | PASS | 🟡 harness | linkFreshSignals called on commit |
| 8. Retrieval | A factual Q&A | B 3.33/4 · 6/6 | PASS | 🟢 product |  |
| 9. Organization | A teams/people | 112 people · 9 teams · 80 deps | PASS | 🟢 product |  |
| 10. Analytics | A ledger↔metrics | sql exec 17/17 done vs ax 17/17; decisions sql~9 ax made 9 | PASS | 🟢 product |  |
| 12. End-to-end | A grade | A 95/100 | PASS | 🟡 harness | OS holds under chronological load; remaining gaps are retrieval/fact depth. |
| 6. Governance | B day-sim break probes | 50/50 | PASS | 🟢 product | capacity, tenant, corpus kill, duplicate vow, NO-list |
| 6. Governance | B extra probes | 3/3 | PASS | 🟢 product | invalid_task_transition:ok, corpus_kill_blocked:ok, duplicate_active_vow:ok |
| 12. End-to-end | B grade with breaks | A 93/100 | PASS | 🟡 harness |  |
| 1. Ingestion | C blind ingest | 117 inserted · 1 dup · 0 err · 50 days | PASS | 🟢 product |  |
| 2. Signals | C corpus survival | killed 0 | PASS | 🟢 product |  |
| 3. Intelligence | C evidence keyword coverage | 8/8 scenarios have ≥40% keyword presence | PASS | 🟡 harness | NOT product detection — proves corpus text in signals |
| 3. Intelligence | C blind situation detection | 1/8 situations (product_launch_slip) · detect created=0 linked=0 | PARTIAL | 🟢 product | situation_detect from signal content — no event_type→playbook map |
| 4. Decisions | C autonomous draft/commit | 1 decisions | PARTIAL | 🟢 product |  |
| 7. Evidence | C linking without harness | 0 related_decision · 0 LINKED | FAIL | 🟢 product | DRAFT situations attach via related_decision_id; LINKED materializes on commit |
| 8. Retrieval | C Q&A from evidence-only ledger | 6/6 pass · avg 3.17/4 | PASS | 🟢 product | improves when situation drafts + links exist |
| 9. Organization | C inferred dependencies | 80 deps · 102 people | PASS | 🟢 product | inferred from situation patterns → org_dependencies |
| 11. Chat | ask → investigate → decide → execute | not exercised in this harness | N/A | 🔴 unimplemented | os-ui Ask / WS agent is partial; no HSOG chat rubric wired |
| Scaffold | hsog:seed-spandan finalizeExecuted | demo polish only — excluded from A/B/C grades | N/A | 🟠 scaffold | bulk DONE + leave 1 ACTIVE/vow + seeded deps |

## Interpretation

- **Test A (Replay)** measures whether the production ledgers absorb a multi-month chronology when the harness fires labeled triggers.
- **Test B (Adversarial)** measures whether governance refuses corruption under load.
- **Test C (Blind)** is the honest intelligence test: evidence only, scenario labels stripped from meta, **no** event_type→playbook map. If decisions stay at 0, Hustronix is **not** yet detecting HSOG situations autonomously.

Do not treat Spandan `finalizeExecuted` or seeded Teams dependencies as intelligence results.

## Reproduce

```powershell
npm run hsog:full-system
npm run hsog:full-system -- --through-day 132
npm run hsog:full-system -- --skip-a --skip-b   # blind only
```
