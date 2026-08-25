# Hustronix × HSOG — what happened, how the OS performed, and where it breaks

**Date:** 14 August 2026  
**Audience:** product / eng / evaluators  
**Primary evidence:**
- Day-taste (adversarial): `data/hsog-day-taste-scorecard.json`, [`hsog-day-taste-report.md`](./hsog-day-taste-report.md)
- Spandan UI seed: `data/hsog-seed-spandan.json`
- Break notes: [`hsog-break-report.md`](./hsog-break-report.md), [`hsog-day-taste-break-report.md`](./hsog-day-taste-break-report.md)
- Engine: `apps/api/src/integrations/hsog/daySim.ts`

---

## 1. Executive summary

We replayed ~4 months of the HSOG “Hustronix Systems” enterprise corpus through Hustronix’s **real** signal, decision, and execution pathways — not by painting mock UI JSON.

| Run | Tenant | Mode | Overall grade |
|---|---|---|---|
| `npm run hsog:day-taste -- --through-day 132` | isolated `hsog_days` | Chronology + **break probes** | **A 92/100** |
| `npm run hsog:seed-spandan` | login user **spandan** | Chronology + **finalizeExecuted** (no breaks) | **A 95/100** |

**Honest claim (use this):**  
Historical organizational events can be replayed through the same mechanisms Hustronix uses to turn commits into ledgered work. Labeled scenario events in the corpus fire a harness map; that map then calls production mutations. The OS does **not** yet open-endedly “notice” company crises from raw Slack alone.

**Do not claim:** “Hustronix autonomously ran a real company for four months.”

---

## 2. What exactly happened

### 2.1 Corpus (HSOG)

Fixture: `D:\hsog\orgforge\benchmarks\hustronix-enterprise\fixtures\os_ingest.json`

| Asset | Approx. size |
|---|---:|
| Start date | 2026-02-02 |
| Event window | days 18–132 (~4 months of story time) |
| Event days simulated | **50** (quiet days skipped) |
| Scenarios | 8 |
| People / customers / projects | 102 / 32 / 4 (+ company brain entities) |
| Artifacts | ~118 (Slack, Jira, GitHub, Gmail, CRM, meetings, Confluence, SIEM, HRIS, finance) |

Scenarios include: NexusAI launch slip, Acme churn, SEV1 security, SignalGrid outage, Q3 forecast miss, hiring freeze, SentryLine deal flags, FlowOps quality regression.

### 2.2 Two different runs (do not confuse them)

```text
┌─────────────────────────────────────────────────────────────┐
│  A. Day-taste (grade the OS under stress)                   │
│     tenant: hsog_days · breaks ON · no finalize             │
│     purpose: find breaks, score resilience                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  B. Seed Spandan (product UI demo)                          │
│     tenant: spandan · breaks OFF · finalizeExecuted ON      │
│     + wipe · org owner · seeded Teams dependencies          │
│     purpose: coherent quarter on every tab                  │
└─────────────────────────────────────────────────────────────┘
```

Both share the same day loop in `runDayTaste()`.

### 2.3 Day loop (what each tick does)

For each event day ≤ 132:

1. **Ingest that day’s artifacts** through provider transforms → `ingestExternal()` → `external_signals`  
   (`integration_runtime = hsog`, idempotent `hsog:{artifact_id}`).
2. **Heuristic enrich** (LLM off via `HUSTRONIX_INTEL_NO_LLM=1` for stable taste).
3. **If `event_type` ∈ decision triggers** (hardcoded set):  
   draft vow from `PLAYBOOKS[scenario]` → `mutationCommitDecision` → link signals → start executions.
4. **If progress trigger:** `mutationTransitionExecution` ACTIVE → DONE where allowed.
5. **Else:** evidence-only (signal lands; no auto-decision).
6. **Day-taste only:** adversarial `attemptBreaks()` (capacity bomb, duplicate vow, corpus kill, cross-tenant, …).
7. **Seed only (after all days):** `finalizeExecutedLook()` + seed org dependencies + set Spandan owner.

### 2.4 What is “Hustronix itself” vs scaffolding

| Step | Who decides | Mechanism |
|---|---|---|
| Signal rows appear | Product | Real ingest seam |
| Chronology | Harness | Day iterator over corpus |
| “Something needs a decision” | Harness | `event_type` ∈ `DECISION_TRIGGERS` |
| Vow text + task list | Harness playbook | `PLAYBOOKS` in `ingestHsog.ts` |
| Persist draft/commit/tasks | Product | `mutationCreateDraftDecision` / `mutationCommitDecision` |
| Task ACTIVE/DONE | Product (+ harness reasons) | `mutationTransitionExecution` |
| Link signal ↔ task | Product API, harness selects IDs | `mutationLinkSignal` |
| Auditor / capacity / tenant | Product | Live rules |
| Wipe ledger | Scaffolding | Seed CLI |
| Disable breaks | Scaffolding | `breaks: false` |
| Bulk DONE + leave 1 ACTIVE/vow | Scaffolding | `finalizeExecuted` |
| Teams dependency edges | Scaffolding | `createOrgDependency` |
| Spandan = owner | Scaffolding | settings |

**Critical nuance:** detection is **corpus/sim-scripted**. Persistence and enforcement are **product**.

### 2.5 Decision / progress trigger vocabulary

**Commit / activate triggers:**  
`launch_gate_failed`, `incident_declared`, `renewal_risk_detected`, `hiring_freeze_started`, `security_alert_triggered`, `customer_escalation_opened`, `deployment_failed`, `audit_evidence_missing`

**Progress triggers:**  
`roadmap_review`, `exception_approved`, `deployment_started`, `forecast_review`, `risk_accepted`, `scope_changed`

Everything else is ingested as evidence only until a trigger day arrives.

---

## 3. How Hustronix performed

### 3.1 Day-taste (breaks ON) — grade **A 92/100**

| Component | Score | Meaning |
|---|---:|---|
| Day fidelity | 100 | 50/50 event days ingested |
| Decision timing | 100 | 19/19 trigger → commit |
| Break resilience | 100 | **50/50** probes passed |
| Corpus survival | 100 | **0** HSOG signals wrongly KILLED |
| Retrieval accuracy | 83 | Rubric **B · 3.33/4 · 6/6 pass** |
| Execution motion | 48 | Many tasks correctly **BLOCKED** by capacity |

End state on taste tenant (pre-finalize): roughly **8 ACTIVE vows**; executions mix of ACTIVE / BLOCKED / DONE / PENDING (capacity gating visible).

**Verdict from scorecard:** *OS holds under chronological load; remaining gaps are retrieval/fact depth.*

### 3.2 Spandan seed (breaks OFF + finalize) — grade **A 95/100**

Same chronology, no adversarial probes, then finalize.

| Ledger | Count |
|---|---:|
| Signals LINKED | 38 |
| Signals UNVERIFIED | 79 |
| Decisions ACTIVE | 8 |
| Decisions DRAFT | 1 |
| Executions DONE | 9 |
| Executions ACTIVE | 8 |
| Notifications | ~38 |
| Org people / teams / deps | ~112 / 9 / 6 |
| Customer entities | 32 |

Execution motion component rose to **100** after finalize (demo-normalized), which is why overall is 95 vs 92.

### 3.3 Retrieval / Q&A (both runs)

Graded from **live ledger snippets**, not a coordinator LLM chat:

| Question | Score /4 | Pass |
|---|---:|:---:|
| Q-NEXUS-001 (launch / evidence trails) | 3 | ✓ |
| Q-ACME-001 (renewal risk) | 3 | ✓ |
| Q-SEC-001 (SEV1 / audit) | 4 | ✓ |
| Q-OUTAGE-001 (ingestion / partitioning) | 3 | ✓ |
| Q-FORECAST-001 | 3 | ✓ |
| Q-FREEZE-001 | 4 | ✓ |

Weakest area: **fact coverage** on outage (0.5) — artifacts present, some ground-truth facts not recovered in prose.

### 3.4 UI surfaces after seed

Live API data (not mock) for Spandan when logged in:

| Surface | Backed by |
|---|---|
| Home / Signals / Evidence | `external_signals` + accuracy API |
| Decide | decision ledger (8 ACTIVE + drafts) |
| Execute / Tasks | execution ledger (DONE + ACTIVE) |
| Alerts | notifications from commit/playbook alerts |
| Teams | org intelligence + roster + seeded deps |
| Analytics | `/api/analytics/summary` over ledger |
| Brain people/customers/projects/docs/meetings | entities + signals + roster |

---

## 4. Breaking points

Organized as: **found → root cause → status**.

### 4.1 P0 — fixed (must stay fixed)

#### B1. Auditor mass-killed HSOG corpus

- **Symptom:** After grace window, hundreds of UNVERIFIED HSOG rows → `KILLED`; UI looks empty.
- **Cause:** Grace clock used event `detected_at` (Feb–Jun sim time) as if it were ingest wall time.
- **Fix:** Grace uses `received_at`; corpus/runtime `hsog*` held in GRACE; `mutationKillSignal` rejects corpus kill; DB restore path for wrongly killed HSOG.
- **Proof:** day-taste corpus_survival 100; break `corpus_manual_kill_blocked` / `auditor_should_not_kill_corpus` pass.

#### B2. One ACTIVE decision blocked company portfolio

- **Symptom:** Second scenario commit → CONFLICT; taste stuck with 1 ACTIVE + many DRAFT.
- **Cause:** Global one-ACTIVE rule.
- **Fix:** Multiple ACTIVE allowed when NO-lists do not conflict; same-vow duplicate ACTIVE still rejected.
- **Proof:** 8 ACTIVE vows on Spandan; break `double_active_same_vow` rejects duplicate.

#### B3. Default capacity crushed parallel sprint

- **Symptom:** Tasks stay PENDING/BLOCKED (`capacity_exceeded`); Execute looks dead.
- **Cause:** Default owner capacity ≈ 3 abstract units; playbooks activate many owners/tasks.
- **Fix (taste/seed):** bump owner capacity / sprint start; capacity bomb probe expects reject-or-block per owner.
- **Remaining product work:** roster hours → real capacity (still open as company realism).

#### B4. Re-run wipe left dedup → empty second runs

- **Symptom:** Second day-taste/seed inserted 0 signals.
- **Cause:** `external_event_dedup` retained `hsog:%` keys after ledger wipe.
- **Fix:** wipe clears `hsog:%` / `hsog-%` / tenant_key hsog*.

#### B5. Forecast / freeze retrieval missed facts

- **Symptom:** Rubric failed or weak on forecast & freeze questions.
- **Cause:** Thin/missing recoverable prose; wrong artifact type aliases in grader.
- **Fix:** `evidenceProseForEvent` + native types in rubric; scores recovered to 6/6 pass.

### 4.2 Break probes (day-taste) — what we attack

Each event day runs one probe by `day % 7`:

| Probe | Intent | Expected |
|---|---|---|
| `commit_overlapping_no_list` | Conflicting NO-lists on commit | reject |
| `transition_unknown_task` | Bogus task id | reject |
| `cross_tenant_transition` | Mutate another tenant’s task | reject |
| `corpus_manual_kill_blocked` | Kill HSOG evidence | reject |
| `capacity_bomb_activate` | Over-activate owners | reject / block |
| `auditor_should_not_kill_corpus` | Auditor pass must not mass-kill | no delta kill |
| `double_active_same_vow` | Second ACTIVE identical vow | reject |

**Result:** 50/50 passed on the graded day-taste run.

### 4.3 Still open / partial (honest remaining breaks)

| ID | Break | Why it still matters |
|---|---|---|
| R1 | **No open-ended situation detection** | Triggers are labeled corpus events + playbook map, not free-form signal intelligence. |
| R2 | **Retrieval fact depth** | Types often 75–100%; facts often 50–75%; embeddings/LLM eval not the default taste path. |
| R3 | **Capacity model still abstract** | Demo bumps capacity; production roster→hours mapping incomplete. |
| R4 | **`finalizeExecuted` demo polish** | Bulk DONE + reopen one ACTIVE is scaffolding — do not present as autonomous close-out. |
| R5 | **Seeded Teams dependencies** | Cross-team edges inserted after sim; not all inferred by intelligence. |
| R6 | **Sim shares SQLite** | HSOG can land in real user DB if you seed the login account (intentional for Spandan demo; isolate for pure eval). |
| R7 | **Source taxonomy debt** | Some channels still land as MANUAL + subtype (Confluence, etc.); taxonomy cleanup ongoing. |
| R8 | **UI / ops friction** | Stale Next on :3000 caused Internal Server Error; ops must keep one clean os-ui + API pair. |

### 4.4 Timeline of “we broke it → we fixed it”

```text
Heavy / early taste
  → mass KILLED signals, 1 ACTIVE vow, PENDING executions, weak retrieval
        │
        ▼
P0/P1 patches (grace, multi-ACTIVE, corpus kill, prose, dedup wipe, …)
        │
        ▼
Day-taste through day 132 + 50 break probes
  → A 92 · 50/50 breaks · 0 corpus kills · 19/19 triggers · B retrieval
        │
        ▼
Seed Spandan (no breaks + finalize + deps)
  → A 95 · UI ledger coherent · executed look for demo
```

---

## 5. Architecture diagram (truthful)

```text
HSOG os_ingest.json
        │  day N events + artifacts
        ▼
provider transforms (Slack/Jira/GitHub/…)
        │
        ▼
ingestExternal()  ───────────────► external_signals
        │
        │  if event_type in DECISION_TRIGGERS
        │         (harness map — not free inference)
        ▼
PLAYBOOKS[scenario] ──► mutationCreateDraftDecision
        │
        ▼
mutationCommitDecision ──► decision_ledger ACTIVE
        │
        ├── mutationLinkSignal ──► signal ↔ task
        ├── mutationTransitionExecution ──► ACTIVE / DONE / BLOCKED
        └── notify() ──► notifications
        │
        ▼  (day-taste only)
attemptBreaks() against auditor / tenant / capacity / kill rules
        │
        ▼  (Spandan seed only)
finalizeExecuted + seed deps + owner settings
        │
        ▼
os-ui tabs read live APIs (mission, decisions, ledger, org, analytics, entities)
```

---

## 6. How to reproduce

```powershell
cd "D:\Hustronix OS"

# Adversarial chronological grade (isolated tenant)
npm run hsog:day-taste -- --through-day 132
# → data/hsog-day-taste-scorecard.json
# → docs/hsog/hsog-day-taste-report.md

# Product login account (~4 months + executed look)
npm run hsog:seed-spandan
# → data/hsog-seed-spandan.json

# API + UI
# API http://127.0.0.1:3005
# UI  http://localhost:3000  (kill stale Next if Internal Server Error)
```

---

## 7. Evaluator language (approved)

**Say:**

> We replayed a four-month company history through Hustronix’s real signal, decision, and execution pathways. When labeled scenario events fired, the harness invoked production mutations (playbook vows and tasks), advanced work through the live execution lifecycle, and linked subsequent signals to that work. Adversarial break probes (50/50) show the auditor and tenant/capacity gates hold under load. For the Spandan product demo we additionally normalized final execution state and seeded some org relationships so every tab shows a coherent quarter.

**Do not say:**

> Hustronix autonomously detected every crisis and closed the quarter without human or harness help.

---

## 8. Bottom line

| Question | Answer |
|---|---|
| Did we only dump JSON into the UI? | **No.** Real ingest + ledger mutations. |
| Did Hustronix invent scenario detection from raw signals? | **No.** Labeled triggers + playbooks. |
| Did the OS’s enforcement matter? | **Yes.** Capacity, tenant isolation, corpus kill refusal, same-vow conflict — proven by break probes. |
| Did demo scaffolding exist? | **Yes.** Wipe, no breaks, finalize, deps, owner. |
| Performance under chronological load? | **A (92 with breaks / 95 seeded).** Weakest: retrieval fact depth + capacity realism. |

The product claim this supports: **Hustronix is a ledgered Decision OS whose real pathways can absorb multi-month organizational replay and refuse illegal mutations — not a chat UI with fixtures.**

---

## 9. Full-system validation (A / B / C)

For the 12-layer scorecard with **product / harness / scaffold / unimplemented** tags, run:

```powershell
npm run hsog:full-system
```

- Plan: [`hsog-full-system-validation.md`](./hsog-full-system-validation.md)
- Latest results: [`hsog-full-system-report.md`](./hsog-full-system-report.md)

**14 Aug 2026 first run:** A **95** · B **92** (50/50 + 3/3 probes) · C blind detection **1/8** (reconciliation DRAFT only).

**After `situation_detect` (same day):** A **90** · B **91** (49/49 + 3/3) · C blind **8/8** · C retrieval **6/6 @ 3.00/4** · inferred deps **10**. See [`hsog-full-system-report.md`](./hsog-full-system-report.md).

**Honest takeaway:** foundation OS held; open-ended detection moved **1/8 → 8/8** via product situation detection (content heuristics → DRAFT + evidence link + team deps), without using the HSOG trigger map in Test C. Governance remained green.
