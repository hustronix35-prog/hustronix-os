# Hustronix OS — Operating Loop QA Report

**Run:** `qaol_2026-08-17T16-40-35-407Z_a2e976e6`  
**Generated:** 2026-08-17T16:42:30.426Z  
**Evaluator stance:** adversarial. Product code was not modified to improve scores. HSOG remains a test system; Hustronix OS is the system under test.

## Executive verdict

**Is Hustronix currently a functioning Decision Intelligence & Execution OS?**

### PARTIALLY

Hustronix **can** run a governed loop when a situation is already decision-ready (Talk → causal validation → ACTIVE tasks → operator COMPLETED → structured outcome → bounded learning). Ledger, capacity, completion eligibility, reversal follow-through, and tenant isolation are real enforcement, not dashboards.

It is **not** yet something a founder can trust on messy company data tomorrow, because situation identity and production time are still evaluator-shaped:

- Catalog situations are `UNIQUE(user_id, pattern_id)` — one churn story per tenant, so two customers contaminate.
- Pattern readiness uses `sim_day`, which live ingest does not set — so production `ingestExternal` typically cannot satisfy `minDistinctDays`.
- Opening a catalog situation still depends on HSOG-flavored keywords (`acme`, `health score`, `nexusai`), not raw operational language.
- Entity resolution is a lexicon plus regex, not identity/anaphora.
- Task status is not a real state machine except for ACTIVE gates.

Those are not scoring nits. They are where the claimed loop **breaks** for a real company.

**Totals:** 88/101 checks passed (13 failed).

## Component scorecard

| Area | Tests | Passed | Failed | Grade |
|---|---:|---:|---:|---|
| Ingestion | 11 | 9 | 2 | C |
| Situation intelligence | 10 | 5 | 5 | D |
| Evidence | 4 | 3 | 1 | C |
| Temporal reasoning | 6 | 5 | 1 | C |
| Contradiction | 2 | 1 | 1 | D |
| Readiness | 3 | 3 | 0 | A |
| Talk | 4 | 4 | 0 | A |
| Governance | 3 | 3 | 0 | A |
| Execution | 9 | 9 | 0 | A |
| Capacity | 5 | 5 | 0 | A |
| Dependencies | 2 | 1 | 1 | D |
| Teams | 2 | 1 | 1 | D |
| Outcomes | 7 | 7 | 0 | A |
| Learning | 9 | 9 | 0 | A |
| De-escalation | 3 | 3 | 0 | A |
| Open-world | 2 | 2 | 0 | A |
| Noise resistance | 2 | 2 | 0 | A |
| Security | 5 | 5 | 0 | A |
| Reliability | 9 | 8 | 1 | B |
| Home / Attention | 2 | 2 | 0 | A |
| Product loop | 1 | 1 | 0 | A |

## Architecture actually verified

Inspected implementation (not docs):

| Layer | What exists |
|---|---|
| Ingest | `ingestExternal` → `external_signals`; buckets SLACK/JIRA/GITHUB/CRM/GMAIL/…; dedup `external_event_dedup(source, external_id, tenant_key)` |
| Intelligence | Pattern engine + emergent + optional open-world; stages AWARENESS→FORMING→ELEVATED→DECISION_READY→DECIDED/RESOLVED |
| Decision | DRAFT from situation at READY; v3 causal validation on commit if IR present |
| Execution | Ledger PENDING/ACTIVE/DONE/BLOCKED/KILLED; hours capacity; task JSON deps |
| Outcome | `successful/failed/partial/inconclusive`; one row per decision |
| Learning | `readiness_priors` from outcomes; MIN_LEARNING_SAMPLES=5; caps evΔ≤2 dayΔ≤2 floorΔ≤0.03; never bypasses gateOk |
| Interface | Talk `/chat`, Home `/`, Decide `/decide`, Execute `/execute`, Teams `/team` |

## What actually breaks?

### ingest-email-bucket — email provider is first-class mail, not MANUAL

- **Test:** Ingestion / ingest-email-bucket
- **Expected:** GMAIL (or a dedicated EMAIL bucket)
- **Actual:** MANUAL
- **Reproduction:** ingest-email-bucket
- **Root cause:** SOURCE_BUCKETS maps provider 'email' to MANUAL; only gmail → GMAIL.
- **Severity:** P3
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Map email → GMAIL or add EMAIL bucket; do not silently collapse mail to MANUAL.

### ingest-noid-duplicates — Missing externalId does not create duplicate logical evidence

- **Test:** Ingestion / ingest-noid
- **Expected:** content-identical artifacts without externalId still collapse
- **Actual:** rows=2
- **Reproduction:** ingest-noid
- **Root cause:** tryInsertExternalEventId is skipped when externalId is absent; identical content inserts forever.
- **Severity:** P2
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Optional content-hash dedup per tenant when provider id is missing.

### sit-raw-becomes-ready — Raw multi-day evidence becomes DECISION_READY without catalog names

- **Test:** Situation intelligence / sit-raw-ready
- **Expected:** DECISION_READY after day 18 raw operational language
- **Actual:** no customer_churn_risk situation
- **Reproduction:** Ingest RAW_CHURN day-by-day with simDay; inspect situations.pattern_id
- **Root cause:** customer_churn_risk minHits keywords include acme/health score/churn; raw 'account health' and 'complaints' do not open the pattern.
- **Severity:** P1
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Do not require HSOG entity names. Bind on operational facets (support volume, health, renewal, sponsor, competitor) without a customer lexicon.

### sit-live-no-simday-ready — Production ingest (no simDay) can still become DECISION_READY

- **Test:** Situation intelligence / sit-live-nosim
- **Expected:** gateOk true without evaluator sim_day
- **Actual:** FORMING evidence=6 readyScore=0.774
- **Reproduction:** Ingest LEX_CHURN then runSituationDetection(userId) with no simDay
- **Root cause:** distinct_days only counts situation_evidence.sim_day > 0; live detect writes sim_day null so days=1 and READY_GATES.minDistinctDays≥2 never pass.
- **Severity:** P1
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Derive distinct days from detected_at (event time), not evaluator sim_day.

### ent-nexus-aliases — NexusAI / Nexus / the launch / v2 bind

- **Test:** Situation intelligence / ent-nexus
- **Expected:** product aliases including launch/v2
- **Actual:** [{"t":"NexusAI launch is yellow","ents":["NexusAI"]},{"t":"Nexus GA slipped","ents":[]},{"t":"the launch is at risk","ents":[]},{"t":"the release moved","ents":[]},{"t":"v2 is late","ents":[]}]
- **Reproduction:** ent-nexus
- **Root cause:** Nexus alone and 'the launch'/'v2' are not aliases of NexusAI.
- **Severity:** P3
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Do not patch intelligence to chase this score. Fix only if classified REAL_BUG.

### ent-acme-collision — Acme customer vs Acme internal project stay separate

- **Test:** Situation intelligence / ent-collide
- **Expected:** unrelated entities are not merged because names overlap
- **Actual:** sits=customer_churn_risk:Customer renewal / churn risk evidence=2
- **Reproduction:** ent-collide
- **Root cause:** extractEntities maps all Acme* to one key; UNIQUE(user_id, pattern_id) forces one churn situation per tenant.
- **Severity:** P1
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Situation identity should be (tenant, pattern, primary entity), not (tenant, pattern).

### evidence-not-northstar — Same-pattern other customer must NOT automatically attach

- **Test:** Evidence / evidence-other-customer
- **Expected:** Northstar not on Acme churn
- **Actual:** n=1
- **Reproduction:** evidence-other-customer
- **Root cause:** One customer_churn_risk situation per tenant absorbs any matching keywords.
- **Severity:** P1
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Do not patch intelligence to chase this score. Fix only if classified REAL_BUG.

### contra-neg-to-pos — Trajectory can move from worsening toward improving after corrective evidence

- **Test:** Contradiction / contra-flip
- **Expected:** IMPROVING or RESOLVED after restore language
- **Actual:** before=WORSENING/DECIDED after=WORSENING/DECIDED
- **Reproduction:** contra-flip
- **Root cause:** Once a situation is DECIDED, later restore language did not flip trajectory off WORSENING. The engine can lock DECIDED and ignore improving evidence.
- **Severity:** P2
- **Product bug / QA bug / limitation:** REAL_BUG
- **Recommended fix:** Recompute trajectory from recent evidence even after DECIDED; allow IMPROVING/RESOLVED when restore language arrives.

### tmp-recurring-not-false-resolved — Problem → fixed → returns does not stay silently RESOLVED

- **Test:** Temporal reasoning / tmp-recurring
- **Expected:** reopened / WORSENING / DECIDED — not RESOLVED
- **Actual:** RESOLVED/WORSENING
- **Reproduction:** tmp-recurring
- **Root cause:** Recurring outage left stage=RESOLVED while trajectory=WORSENING. The engine does not reopen resolved situations when the problem returns.
- **Severity:** P1
- **Product bug / QA bug / limitation:** REAL_BUG
- **Recommended fix:** Never persist RESOLVED+WORSENING. New worsening evidence after RESOLVED must reopen (ELEVATED/FORMING).

### dep-from-waiter-to-blocker — Inferred waits_on is from=waiter to=blocker

- **Test:** Dependencies / dep-direction
- **Expected:** from=engineering to=security
- **Actual:** [{"fromTeam":"engineering","toTeam":"finance","fromWork":"Waiting: access review before credentials can ship","status":"DELAYED","edgeType":"waits_on","confidence":0.7},{"fromTeam":"security","toTeam":"engineering","fromWork":"Access / credentials dependency","status":"AT_RISK","edgeType":"waits_on","confidence":0.65}]
- **Reproduction:** dep-direction
- **Root cause:** Credential heuristic sets from=security to=engineering with edgeType waits_on — inverted vs convention.
- **Severity:** P2
- **Product bug / QA bug / limitation:** REAL_BUG
- **Recommended fix:** from=waiter (engineering), to=blocker (security) for waits_on.

### teams-talk-agree — Talk and Teams derive the same dependency graph

- **Test:** Teams / teams-same-graph
- **Expected:** Engineering blocked by Security on both surfaces
- **Actual:** talk=Security review blocking Engineering is currently decision-ready. It developed from connected signals across the company. Confidence is 86% and the trajectory is worsening. Involve edges=[{"from":"Engineering","to":"Security","work":"Waiting on review","status":"DELAYED","source":"manual","confidence":null,"evidence":[],"situation_id":null,"edge_type":null},{"from":"QA","to":"Engineering","work":"Waiting on build","status":"AT_RISK","source":"manual","confidence":null,"evidence":[],"situation_id":null,"edge_type":null},{"from":"Product","to":"QA","work":"Waiting on signoff","status":"AT_RISK","source":"manual","confidence":null,"evidence":[],"situation_id":null,"edge_type":null}] bottlenecks=engineering,qa,product,security
- **Reproduction:** teams-same-graph
- **Root cause:** Talk answers from Situation objects. Teams reads org_dependencies. Asking 'Is Engineering blocked by Security?' does not query the same graph Talk-side.
- **Severity:** P3
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Talk feasibility/who-is-blocked should read buildTeamsIntelligence / org_dependencies, not only situation title match.

### multi-customers-not-merged — Acme churn and Northstar churn are not one situation

- **Test:** Situation intelligence / multi-two-customers
- **Expected:** ≥2 churn situations or entity-scoped ids
- **Actual:** n=1 titles=Customer renewal / churn risk
- **Reproduction:** multi-two-customers
- **Root cause:** UNIQUE(user_id, pattern_id) allows one customer_churn_risk row per tenant.
- **Severity:** P1
- **Product bug / QA bug / limitation:** ARCHITECTURAL_GAP
- **Recommended fix:** Key situations by primary entity, not only pattern catalog id.

### recover-learning-not-doubled — Detect restart does not double situation_decide learning_log rows

- **Test:** Reliability / recover-learning-once
- **Expected:** situation_decide count stable
- **Actual:** situation_decide 0→1 total 3
- **Reproduction:** recover-learning-once
- **Root cause:** learning_log upsert is keyed by kind+id; total row growth can be new kinds, not duplicates.
- **Severity:** P3
- **Product bug / QA bug / limitation:** REAL_BUG
- **Recommended fix:** Do not patch intelligence to chase this score. Fix only if classified REAL_BUG.


## Learning verdict

1. Does failure change future readiness? **YES — after 5 successful/failed samples**
2. Does success change future readiness? **YES — tiny floor nudge (-0.01)**
3. Is learning bounded? **YES**
4. Is learning idempotent? **YES**
5. Is learning tenant-isolated? **YES**
6. Is learning pattern-isolated? **YES**
7. Can learning bypass gates? **NO (correct)**
8. Does learning improve the next comparable situation? **YES, by tightening evidence/day gates — not by raising intelligence quality**

A single Situation A → FAILED → Situation B experiment **does not** change readiness. That is the implemented bound (`MIN_LEARNING_SAMPLES = 5`), not a test bug. Calling `learning_log` growth "learning" would be dishonest; this audit only counts prior deltas that change `gatesAllowReady` / score floor.

## Final product verdict

Can Hustronix:

| # | Question | Result |
|---|---|---|
| 1 | Understand what is happening? | **PARTIAL** |
| 2 | Explain why? | **PASS** |
| 3 | Identify who is affected? | **PARTIAL** |
| 4 | Decide what should happen? | **PASS** |
| 5 | Determine whether it can be executed? | **PASS** |
| 6 | Execute through governance? | **PASS** |
| 7 | Measure whether it worked? | **PASS** |
| 8 | Learn from the result? | **PASS** |
| 9 | Apply that learning to the next situation safely? | **PASS** |

If we gave Hustronix a real company's messy operational data tomorrow, a founder could rely on it to **govern and measure decisions that a human already framed**. They could **not** yet rely on it to notice the right problems across customers, on live timestamps, without HSOG-shaped language.

### Top 5 things that are still genuinely broken

1. **Production ingest cannot become DECISION_READY** (P1 ARCHITECTURAL_GAP) — `distinct_days` only counts `situation_evidence.sim_day > 0`. Live `ingestExternal` writes `sim_day = null`, so `READY_GATES.minDistinctDays ≥ 2` never pass. Lexical Acme evidence stayed FORMING (score 0.774). A real company feed does not set evaluator sim days.
2. **One situation per pattern per tenant** (P1 ARCHITECTURAL_GAP) — `UNIQUE(user_id, pattern_id)` merges Acme and Northstar churn, and merges “Acme customer” with “Acme internal project”. Northstar evidence attached to the Acme situation. This is the contamination failure.
3. **Catalog intelligence is still keyword/lexicon, not raw evidence** (P1 ARCHITECTURAL_GAP) — an 18-day complaint/health/renewal/sponsor/competitor story with no `acme` / `health score` tokens opened **zero** `customer_churn_risk` situations. First-keyword is avoided; first-lexicon is not.
4. **Recurring incidents stay RESOLVED while WORSENING** (P1 REAL_BUG) — SignalGrid restored then returned as `RESOLVED/WORSENING`. That state is incoherent. Execution-success vs business-success is enforced on COMPLETED, then undone here.
5. **Dependency inference inverts waits_on for credentials** (P2 REAL_BUG) — “Engineering blocked by Security / waiting on access review” produced `from=security, to=engineering` with `edgeType: waits_on`, opposite the waiter→blocker convention. Talk also does not read this graph.

### Top 5 things that are now genuinely production-ready

1. Causal validation is authoritative: Talk cannot execute a DRAFT without sealing instrumentation and competing hypotheses.
2. Hours capacity is real: 40h − 32h − 16h blocks with an overloaded-by-8h reason.
3. Outcomes distinguish execution success from business failure (WORSENING after DONE tasks → failed, situation stays DECIDED).
4. Readiness learning is bounded, idempotent, tenant/pattern scoped, and cannot bypass gateOk.
5. Cross-tenant complete/reverse/execute are rejected.

## Regression suites in this pass

Adversarial operating-loop harness (this report): **88/101** (13 failed; one of those is a TEST_BUG on first `situation_decide` write).

| Suite | Result |
|---|---|
| `test:operating-loop` | PASS (6/6) |
| `test:wave3-evaluation` | PASS (3/3) |
| `test:wave3-learning` | PASS (10/10) |
| `test:wave3-completion` | PASS (4/4) — run before this harness |
| `test:talk-wave0` | PASS (4/4) |
| `test:os-enforcement` | PASS (8/8) |
| `test:org-intelligence` | PASS (2/2) |
| `test:clarification` | PASS (6/6) |
| `hsog:open-world` | PASS — 7/7 discover, 4/4 ready, 2/2 resolve, 0 false-ready, chat 5/5 |
| `hsog:generalization` | PASS — 4/4 unseen stories, chat 5/5 |
| `hsog:customer-path:intelligence` | PASS — 8/8 HSOG stories DECIDED, evidence hit-rate 0.87, +11.4d avg lead **with simDay chrono** |
| `hsog:talk-complete` | PASS — 11/11 Talk ASK→EXECUTE→COMPLETED; outcome **failed** because trajectory still WORSENING |
| `hsog:full-system` | Mixed — A/B governance PASS (50/50 + 3/3). **Test C blind (no simDay, no playbook): 1/8 situations**, 0 LINKED. Corroborates the live-ingest READY gap. |

HSOG chronological success is **not** a contradiction of this audit. Those suites pass `simDay` into `runSituationDetection`. This QA asked whether the same product works on `ingestExternal` as a company would actually send it. That is where the chain breaks.

Product code was not modified to improve any of the above scores.

## Repeatability

Each scenario used an isolated `qaol_*` tenant, wiped before use. Artifacts: `data/hustronix-operating-loop-qa-scorecard.json` (full checks + before/after snapshots).
