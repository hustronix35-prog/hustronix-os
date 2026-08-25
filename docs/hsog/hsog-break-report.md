# Hustronix OS — where it breaks, and how to fix it

**Date:** 13 August 2026  
**Patched (same day):** P0-1 `received_at` grace · P0-2 multi-ACTIVE + NO-list conflict classes · P0-3 roster hours → capacity · P1-1 source enum + Confluence≠Notion · P1-2 canonical `hsog:{id}` · P1-3/`ingestMeeting` one transcript row · P1-4 drop grader type aliases · P1-5 ingest-then-link + high-risk hold · P1-7 envelope runtime · P1-8 CLI auditor hook · P2-4 agent tools → mutation gateway. **Still open:** P1-6 sim isolation, embeddings/LLM eval.  
**Evidence:** HSOG enterprise corpus + heavy company-flow (`npm run hsog:heavy`) + taste ingest on `spandan`  
**Scorecard:** [`data/hsog-heavy-scorecard.json`](../../data/hsog-heavy-scorecard.json)  
**Related:** [`hsog-ingest.md`](./hsog-ingest.md) · [`architecture-enforcement.md`](../architecture-enforcement.md) · [`nango-to-signals-architecture.md`](../nango-to-signals-architecture.md) · [`database-consistency-and-context.md`](../database-consistency-and-context.md)

---

## 1. Executive summary

The Decision OS **does ingest** Slack, Jira, GitHub, Gmail, CRM, Confluence, meetings, SIEM/PagerDuty, HRIS, and finance through `ingestExternal()`. Transform errors in the heavy run: **0**. Parallel execution burst: **17/17 ACTIVE**, **8 DONE**. HSOG eval: **B (2.83/4), 6/6 passed**.

That is **not** “production-ready company flow.” Several invariants collide with how real companies actually operate. The worst is not ingest — it is **enforcement treating historical event time as ingest time**, plus **one-ACTIVE-decision**, **capacity 3.0**, **MANUAL dumping**, and **retrieval that cites artifacts but does not recover facts**.

| Layer | Verdict | Headline break |
|---|---|---|
| Provider transforms | Pass | 0 errors across Slack Events, Nango Slack, Jira, GitHub, Gmail, HubSpot, Notion, meetings |
| Ledger write | Pass | Idempotent `external_id`; FTS populated |
| Auditor / grace | **Fail (P0)** | `detected_at` in Feb–Jun 2026 → grace already expired → mass `KILLED` |
| Multi-decision company | **Fail (P0)** | At most one `ACTIVE` decision per org |
| Capacity / parallel work | **Fail unless patched** | Default load cap 3.0; real sprint needs bump or BLOCKED |
| Source taxonomy | **Fail (P1)** | CRM + meetings + SIEM + HRIS + finance → `MANUAL` (82/158 rows) |
| Intelligence / retrieval | **Partial (P1)** | Types 75–100%, facts 33–75%; no embeddings without OpenAI key |
| Taste tenant (`spandan`) | **Stuck** | 17 executions still `PENDING`; only 1 ACTIVE decision |
| Sim isolation | **Fail (P1)** | HSOG writes the same SQLite as real users; no sim tenant gate |
| Agent vs auditor | **Known debt** | Coordinator tools still mutate ledger directly |

---

## 2. What we actually ran

| Run | Tenant | Path | Result |
|---|---|---|---|
| `npm run hsog:ingest -- --user spandan` | `spandan` | HSOG `artifactMap` → `ingestExternal` | 118 signals, 8 decisions (1 ACTIVE), 17 PENDING tasks |
| `npm run hsog:heavy` | `hsog_flow` | **Production transforms** → `ingestExternal` + Nango Slack adapter + meeting heuristic + parallel `transitionExecutionState` | 158 enriched signals, 17 ACTIVE / 8 DONE, grade B |

HSOG fixture: 102 people, 32 customers, 8 scenarios, 53 events, 118 artifacts. Ground truth: `benchmarks/hustronix-enterprise/evaluation/questions.yaml` + `causal_graph_ground_truth.json`.

---

## 3. What does *not* break

Keep these. Do not “fix” them into a second ledger.

- Single ingest seam: `ingestExternal()` / `ingestExternalBatch()`.
- Idempotency via `(source, external_id)`.
- Slack Events + Nango Slack both land `source = SLACK`.
- Jira / GitHub / Gmail buckets are correct when those transforms run.
- Decision fingerprint is now **org-scoped** (legacy global hash only matches same tenant).
- Auditor capacity + shadow-work rules are deterministic (they are *too* aggressive on replay, not undefined).
- Signals do not auto-create `ACTIVE` decisions (product invariant).

---

## 4. Break catalog

Each item: **symptom → root cause → evidence → fixes** (immediate / correct / alternative).

### P0-1 — Auditor mass-kills backdated HSOG (and any historical replay)

**Symptom.** After API restart or cron (`*/5`), almost every UNVERIFIED HSOG signal becomes `KILLED`. Home/Alerts look empty. Owners get `failed_executions` + reputation damage.

**Root cause.** Grace is `datetime(detected_at, '+2h'|'+6h'|'+12h')` compared to `CURRENT_TIMESTAMP` ([`auditor.ts`](../../apps/api/src/auditor.ts) `evaluateShadowWork`). HSOG sets `detected_at` to **sim time** (2026-02-02 + day). Today is 2026-08-13. Every replayed event is already months past grace.

`detected_at` is used as both **when it happened in the world** and **when the grace clock starts**. Those are different clocks.

**Evidence.** Heavy-flow `detectedAt: simOccurredAt("2026-02-02", event.day)`. Slack grace = +2 hours from February → expired. Taste tenant `spandan` still has 118 UNVERIFIED/GRACE rows until auditor runs.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | **Correct:** add `received_at` (ingest wall clock). Grace uses `received_at`. `detected_at` stays event time for UI/timeline. | Matches Nango envelope (`occurredAt` vs `receivedAt`). Real + replay both work. | Schema + auditor + UI “when” column. |
| B | Immediate: HSOG ingest sets `detected_at = now`, stores sim time in `ingest_meta.occurred_at`. | One-line ingest change. | Dashboards show “just now” for a Feb launch slip. |
| C | Auditor: if `ingest_meta.integration_runtime` in (`hsog`,`hsog-provider`) **or** `replay=1`, skip kill / use `received_at`. | Isolates sim. | Special-case; production backfill still broken. |
| D | Grace = `max(detected_at, ingested_at) + window`. | Helps late-arriving webhooks too. | Still need an ingest timestamp column. |

**Do A.** B is a stopgap so taste UI survives tonight. Never use C as the long-term design.

---

### P0-2 — One ACTIVE decision per organization

**Symptom.** A real company has concurrent strategic bets (launch hold + Acme save + SEV1 + freeze). Hustronix allows **one** `ACTIVE` vow. Commit #2 throws `CONFLICT`.

**Root cause.** [`database.ts`](../../apps/api/src/database.ts) `transitionDecisionState` → `findOtherActiveDecision(orgId)`. Product rule from enforcement doc. HSOG has **8 linked scenarios**; only Nexus can be ACTIVE.

**Evidence.** `spandan`: 1 ACTIVE + 7 DRAFT. Heavy flow: only first scenario committed.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | **Correct for “OS”:** allow N ACTIVE with **conflict classes** (same owner / same customer / same NO-list → block; orthogonal → allow). | Matches real orgs. | Needs conflict matrix + UI. |
| B | Keep 1 ACTIVE **strategic** decision; everything else is ACTIVE **execution** under that vow, or `UNDER_REVIEW`. | Smaller change. | HSOG scenarios are not all children of one vow. |
| C | Sim-only: `HSOG_MULTI_ACTIVE=1` bypass for sim tenants. | Unblocks eval. | Diverges from production semantics — don’t grade “company flow” on a bypass. |

**Do A for product, B as interim UX** (“portfolio: one north-star + satellite DRAFT/UNDER_REVIEW with live tasks”). Do not silently bypass in production.

---

### P0-3 — Default capacity cannot run a company sprint

**Symptom.** Without `owner_reputation.reputation_modifier = 5`, parallel `ACTIVE` tasks `BLOCKED` (`capacity_exceeded`). Default capacity = `3.0 * modifier` ([`getOwnerCapacity`](../../apps/api/src/database.ts)).

**Evidence.** Heavy flow only got 17/17 ACTIVE **after** bumping modifier to 5.0. Taste `spandan` still has **17 PENDING** — Execute never started.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | Per-owner capacity from roster hours (`team_roster.capacity` → weight budget). | Real company: 40h/week ≠ 3 abstract units. | Need weight↔hours mapping. |
| B | Start taste/HSOG by transitioning a few tasks ACTIVE (script flag `--start-sprint`). | Unblocks Execute UI today. | Still fake capacity. |
| C | Keep 3.0 but show BLOCKED as a **feature** in demo (“auditor stopped overload”). | Honest. | UI looks “broken” if unexplained. |
| D | EIE advisory capacity already exists — **do not** replace auditor with it. Use it as tooltip only ([enforcement §10](../architecture-enforcement.md)). | Already built. | Easy to accidentally enforce on beliefs. |

**Do B tonight + C copy in UI. Do A for v1 company realism.**

---

### P1-1 — CRM / meetings / SIEM / HRIS / finance collapse to `MANUAL`

**Symptom.** Dashboards show a giant MANUAL bucket. Heavy flow: **82/158** signals `source=MANUAL`. Taste `spandan`: **42 MANUAL**. Operators cannot filter “CRM vs incident vs HRIS”.

**Root cause.** `SOURCE_BUCKETS` + SQLite CHECK only allow `SLACK|GITHUB|JIRA|MICROSOFT|GOOGLE|GMAIL|NOTION|LINEAR|MANUAL`. `hubspot`, `meeting`, `crm` → MANUAL. Confluence is forced into **NOTION** (wrong product).

**Evidence.** [`ingestRouter.ts`](../../apps/api/src/integrations/ingestRouter.ts); schema CHECK in [`database.ts`](../../apps/api/src/database.ts) `rebuildExternalSignalsForExpandedSourceEnum`.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | Expand enum: `CRM`, `MEETING`, `INCIDENT`, `HRIS`, `FINANCE`, `PAGERDUTY` (or one `OPS` + subtype). Reuse existing rebuild migration pattern. | Dashboards tell the truth. | Migration + UI filters. |
| B | Keep MANUAL, require `source_subtype` in every UI group-by. | No migration. | Easy to forget; Home still looks wrong. |
| C | Map Confluence to MANUAL/`confluence.page` until a real Confluence connector exists — **stop calling it NOTION**. | Honest. | One-line + UI label. |

**Do C immediately. Do A before any customer demo of “multi-system OS”.**

---

### P1-2 — Dual ingest paths on the same tenant

**Symptom.** `hsog:ingest` (artifactMap) and `hsog:heavy` (real transforms) use **different `external_id`s**. Running both on `spandan` **doubles** signals (118 + another 150+). Dedup does not help.

**Root cause.** Taste path: `hsog:{artifact_id}`. Provider path: `hsog-slack-…`, `hsog-jira-…`, Gmail message id, Nango `record.id`, meeting `hsog-meet-…-i`.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | One canonical external id: `hsog:{artifact_id}` for **all** HSOG paths (pass through transforms as deliveryId / gmail id / nango id). | Re-runs are idempotent. | Must thread id through every transform ctx. |
| B | Heavy flow **only** on isolated `hsog_flow` tenant (current). Taste **only** `spandan`. Document hard. | Zero code. | Humans will still mix them. |
| C | Delete artifactMap path; only provider transforms. | One way to ingest. | Slightly more code for simple seeds. |

**Do A + B.** Keep artifactMap for unit tests only.

---

### P1-3 — Meeting heuristic explodes 1 transcript → 5 signals

**Symptom.** 10 meeting artifacts → **50** meeting rows. Retrieval is flooded with “We will treat this…”, “blocked by incomplete meeting transcript…”, “Priya and Elena disagree…”. Fact coverage on freeze/forecast drops.

**Root cause.** [`extractHeuristic`](../../apps/api/src/intelligence/meetingIngestion.ts) emits every matching sentence. Heavy flow **injects** five template sentences so the heuristic fires — that template is not company speech.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | One `meeting.transcript` signal + optional extracted items as **child meta**, not extra ledger rows. | Ledger stays evidence-shaped. | Auto-linker loses extra rows. |
| B | Cap heuristic fan-out (e.g. 2 items) + require ≥0.7 confidence. | Small diff. | Still synthetic. |
| C | Real `ingestMeeting()` with LLM only when `HSOG_MEETING_LLM=1`. | Tests the real meeting path. | Cost + nondeterminism. |
| D | Put scenario facts **inside** the transcript text (“GRC exception aligns with audit…”) so retrieval can score freeze/forecast. | Raises fact coverage without LLM. | Still synthetic prose. |

**Do A for production meetings. Do D in HSOG corpus so eval is fair.**

---

### P1-4 — Retrieval cites types, not facts (grade B ceiling)

**Symptom.** Artifact type coverage 75–100%. Fact coverage: Nexus 75%, SEV1 67%, Acme/outage 50%, forecast/freeze **33%**. Average 2.83/4.

**Root cause.** Answers are concatenated ledger snippets. HSOG summaries (“CFO proposes hiring freeze”) do not contain rubric phrases (“GRC analyst exception aligns with audit and renewal risk”). No coordinator LLM. No embeddings (`OPENAI_API_KEY` missing → FTS only). Grader also **inflates** types (`executive_meeting`, `postmortem` aliases) — type score is optimistic.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | Eval path: `runAgent` / Ask composer with **required citations**, then `hustronix_scorer.py`. | Grades the real product, not a snippet concat. | Needs LLM + cost. |
| B | Enrich artifacts with causal `statement` from `causal_graph` into `ingest_meta` **without** putting GT in `content` (hidden labels). Retriever may use meta for scoring only. | Fairer eval. | Must not leak GT into user-visible chat. |
| C | Set `OPENAI_API_KEY` for embeddings; keep detector heuristic. | Hybrid search quality. | Cost. |
| D | Remove type aliases from grader; score only native artifact types. | Honest type_score. | Freeze/forecast may fail type gate. |
| E | Improve HSOG artifact **bodies** (PRD / CRM note / finance memo) so facts are recoverable without leaking answers. | Correct sim. | Authoring work in hsog. |

**Do D + E for a honest B→A path. Do A when you want to grade “complete software” including chat.**

---

### P1-5 — Auto-link barely fires; unlinked signals die

**Symptom.** Intelligence enriches (158) but most stay `UNVERIFIED`. Auto-linker needs active executions + embeddings + fused score ≥ 0.55 ([`autoLinker.ts`](../../apps/api/src/intelligence/autoLinker.ts)). Cost-gate skips embed when no active executions. Then P0-1 kills them.

**Chain.** Ingest → no ACTIVE tasks yet → no embed → no auto-link → grace expires → `KILLED`.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | Order: create/activate decision + tasks **before** signal ingest (or reprocess after sprint start). | Uses existing pipeline. | Script order only. |
| B | Lower auto-apply threshold for `integration_runtime=hsog` / high `op_classification`. | More LINKED. | False links. |
| C | Explicit `mutationLinkSignal` for scenario→task (taste ingest already does ~4 per scenario). | Deterministic. | Not “how Nango works”. |
| D | Don’t kill until link **or** human ack if signal is `risk=high` / `op_classification=incident`. | Protects SEV1. | Policy change. |

**Do A + D.** C is fine for demos.

---

### P1-6 — Sim data is not isolated

**Symptom.** HSOG and `hsog_flow` live in the same `hustronix.db` as `spandan`. PRD required `organizations.metadata_json.simulation=true` and `/api/hsog/*` + `HSOG_ENABLED`. Not implemented.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | Dedicated SQLite file `SQLITE_PATH=./data/hustronix-hsog.db` for heavy/taste. | Hard isolation. | Two processes / env switch. |
| B | Sim org flag; every mutator `assertSimulationTenant`. | Matches PRD. | More auth surface. |
| C | Keep `hsog_flow` user; never ingest HSOG into founder account. | Process only. | Easy to violate. |

**Do C now. Do A before sharing a laptop demo. Do B if HSOG becomes a product surface.**

---

### P1-7 — `envelopeToIngestRecord` hardcodes `integration_runtime: "nango"`

**Symptom.** Any non-Nango envelope looks like Nango in `ingest_meta`. HSOG Nango-slack stamp has to patch meta after the fact.

**Fix.** `integration_runtime: env.metadata?.runtime ?? "nango"` (one field on `EvidenceEnvelope.metadata`). HSOG/provider sets `hsog-provider`.

---

### P1-8 — CLI ingest does not attach the auditor hook

**Symptom.** `npx tsx ops/scripts/hsog-*.ts` imports `database.ts` but **not** `bootstrap.ts`. `setLedgerAuditorHook` is null. No `onWrite` → no grace init, no `processSignalFireAndForget` until the **API process** cron/evaluateAll sees the rows — then P0-1 fires.

**Fixes**

| # | Fix | Pros | Cons |
|---|---|---|---|
| A | Scripts call the same `setLedgerAuditorHook(auditor.onWrite)` as bootstrap, **or** only ingest via `POST /api/...` on the running API. | One enforcement path. | CLI must not double-hook if API is also open on same DB. |
| B | Keep CLI hook-less; document “start API after ingest, but fix P0-1 first”. | Simple. | Footgun. |

**Do A only after P0-1.** Two processes + one SQLite + auditor kill is worse.

---

### P2-1 — Taste Execute UI is idle

**Symptom.** `spandan` Execute: 17 `PENDING`, 0 `ACTIVE`. Home load % near zero.

**Cause.** Ingest created tasks; nobody called `transitionExecutionState`. One ACTIVE decision does not auto-start work.

**Fix.** `hsog:ingest --start-sprint` → activate ≤ capacity tasks for Imani/Renata/Jordan. Or click Execute in UI (if transitions are exposed).

---

### P2-2 — Decision commit vs epistemic gate

**Symptom.** `mutationCommitDecision` runs `requireCausalValidationForActivation` + `assertEpistemicSupportForCommit` when `decision_reasoning` is non-empty. HSOG drafts skip reasoning → commit works. Real UI commits with v3 reasoning can **fail** after the user clicks Approve.

**Fix.** Surface the epistemic error on `/decide`. Do not strip reasoning to “make commit work.” For HSOG, optionally attach a **valid** v3 stub if you want to test that gate.

---

### P2-3 — Global `fingerprint UNIQUE` still exists

**Symptom.** Org-scoped hash mostly fixes cross-tenant dedup, but the column is still globally UNIQUE. A hash collision across orgs would fail INSERT.

**Fix.** Unique index `(org_id, fingerprint)` when you next migrate `decision_ledger`. Until then, org prefix in the hash is enough.

---

### P2-4 — Agent tools still write the ledger

**Symptom.** [`architecture-enforcement.md`](../architecture-enforcement.md) §3: `log_strategic_decision` / `transition_execution` call DB directly. A chat turn can ACTIVE/BLOCK outside Mission Control.

**Fix.** Tools enqueue intents; only `mutation-*` + auditor commit. Same as PRD. Not HSOG-specific but it **will** break company-flow demos when Ask is wired.

---

### P2-5 — SQLite is not actually concurrent

**Symptom.** `Promise.all` on transitions completed in **3ms** because `better-sqlite3` is synchronous on one connection. “Several executions at a time” did **not** stress lock contention, WAL writer queue, or multi-process ingest.

**Fixes.** (1) Two API workers + one DB (will serialize/fail). (2) Load script with N processes. (3) Accept SQLite = single writer until Postgres cutover. Label the heavy-flow “logical parallelism,” not “storage parallelism.”

---

### P2-6 — Nango Slack meta stamp is best-effort

**Symptom.** After `ingestNangoRecords`, HSOG patches `ingest_meta` via `external_id LIKE %artifactId%`. Fragile if adapter id format changes.

**Fix.** P1-2 canonical `external_id` = `hsog:{artifact_id}` so stamp is an exact lookup. Or pass hsog fields through envelope metadata before ingest.

---

### P2-7 — Gmail allowlist / Slack channel allowlist

**Symptom.** Production Gmail drops off-allowlist domains; Slack denylist/allowlist can drop channels. Heavy flow bypasses both (direct transforms). Real OAuth poll will **look empty** compared to HSOG.

**Fix.** Document required allowlists for a demo workspace. Don’t grade Nango/Gmail poll vs HSOG until allowlists include `@hustronix.io` / sim channels.

---

### P2-8 — Notification spam on re-ingest (mitigated)

**Symptom.** First HSOG ingest + re-run duplicated alerts. Dedup-by-title added; leftover dupes were cleaned.

**Fix.** Keep title dedup. Better: idempotency key `user_id + kind + scenario_id`.

---

### P3 — Smaller cracks

| Break | Fix |
|---|---|
| Confluence ≠ Notion | Relabel subtype `confluence.page`; don’t use NOTION bucket (P1-1 C) |
| `google` calendar vs `gmail` both “Google” in UI | Separate filters: `GMAIL` vs `GOOGLE` already in enum — use them |
| Support tickets share Jira bucket | Fine; keep `source_subtype=support.ticket` |
| HSOG owners are first names (`Imani`) vs Slack `slack:U…` | Roster `slack_id` + owner map for auto-link |
| Cost-saver truncates chat history | Don’t eval org truth from chat; always re-read SQLite |
| `hsog_flow` password in script | Local-only; don’t ship; use API key + `ALLOW_LOOPBACK_AUTH` |
| Grader `passed` threshold is 2/4 | A “pass” is “mostly correct with gaps.” Don’t market as A |
| Brain entity catalogs still fixture-heavy in os-ui | Map `/brain` to `entities` table (already upserted by HSOG) |

---

## 5. Accuracy vs real data (honest)

| Question | Score | Facts | Types | What broke |
|---|---:|---:|---:|---|
| Q-NEXUS-001 Why did 2.0 slip? | 3 | 75% | 100% | Renata + Acme overpromise recovered; “only engineering delay” avoided |
| Q-ACME-001 Churn driver? | 3 | 50% | 75% | Latency present; FlowOps connector + sponsor-change under-cited |
| Q-SEC-001 Data exposed? | 3 | 67% | 100% | No-exfil + expired exception partial |
| Q-OUTAGE-001 SignalGrid cause? | 3 | 50% | 100% | Deferred partitioning + muted Kafka not fully in snippets |
| Q-FORECAST-001 Late change? | 3 | **33%** | 100% | Stale CRM green not explicit in CRM payload |
| Q-FREEZE-001 Exceptions? | **2** | **33%** | 100% | GRC/SRE rationale missing in HRIS/finance text; causal bonus 0 |

**Interpretation.** The OS **stores** the right systems. It does **not** yet **explain** multi-hop org truth without an LLM pass or richer artifact bodies. Type retrieval ≠ understanding.

---

## 6. Fix order (do this, not everything)

### Tonight (taste UI survives)

1. **P0-1 B:** HSOG `detected_at = now`, sim time in `ingest_meta.occurred_at`. Re-ingest `spandan` or patch existing rows.  
2. **P2-1:** `--start-sprint` for 4–6 ACTIVE tasks under capacity.  
3. **P1-1 C:** Stop labeling Confluence as Notion.  
4. Do **not** point API auditor at backdated rows until (1) is done.

### This week (honest company flow)

5. **P0-1 A:** `received_at` column + grace on ingest time.  
6. **P1-2 A:** Canonical `hsog:{artifact_id}` on every provider path.  
7. **P0-3 A/B:** Roster-based capacity or explicit demo capacity + UI copy for BLOCKED.  
8. **P1-5 A+D:** Ingest order + don’t kill high-risk unlinked incidents immediately.  
9. **P1-4 D+E:** Honest grader; richer HSOG memos for freeze/forecast.

### Product (real companies)

10. **P0-2 A:** Multi-ACTIVE with conflict classes.  
11. **P1-1 A:** Source enum expansion (`CRM`, `MEETING`, `INCIDENT`, …).  
12. **P1-4 A:** Grade Ask/coordinator with citations, not snippet concat.  
13. **P2-4:** Agent tools → mutation gateway only.  
14. **P1-6 A/B:** Sim DB or sim tenant flag.

---

## 7. Re-verify after fixes

```powershell
# 1. Patch detected_at / received_at, then:
npm run test:hsog-ingest
npm run test:hsog-heavy
npm run hsog:heavy

# 2. Auditor must NOT kill replay:
#    SELECT state, COUNT(*) FROM external_signals WHERE user_id = ? GROUP BY state
#    Expect UNVERIFIED/GRACE/LINKED, not mass KILLED

# 3. Taste
npm run hsog:ingest -- --user spandan --start-sprint
# Home / Decide / Execute / Alerts as spandan
```

Pass bar for “company flow”:

| Gate | Pass |
|---|---|
| Transforms | 0 errors; each of Slack, Jira, GitHub, Gmail, CRM, meeting present |
| Auditor | Replay signals not mass-KILLED after 10 min cron |
| Execute | ≥1 ACTIVE task per critical owner; BLOCKED only when over capacity **and** explained |
| Decide | ≥1 ACTIVE vow; DRAFT satellites visible |
| Eval | Avg ≥ 3.0/4 **without** type-alias inflation; freeze + forecast facts ≥ 0.5 |
| Isolation | Founder tenant ≠ `hsog_flow` rows |

---

## 8. One-line rule

> **Ingest is not the product. Time, capacity, and one-ACTIVE semantics are.**  
> Fix the grace clock and company-shaped decisions before adding more connectors. The LLM cannot rescue a ledger the auditor already killed.
