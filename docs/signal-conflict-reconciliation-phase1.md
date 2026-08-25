# Signal Conflict & Reconciliation Engine — Phase 1 Architecture

**Status:** Phase 1 meaning vertical slice (claim-ready ingest + entity aliases + org-state compile + live Decide/Brain)  
**Version:** 1.2  
**Date:** 2026-08-13  
**Product rule:** Extend the existing spine. Do not redesign ingest, auditor, decision ledger, or organizational truth.

**Landed in code**

* Schema: `apps/api/src/reconciliation/schema.ts` (wired from `database.ts`) including `entity_aliases`
* Module: `apps/api/src/reconciliation/*` + claim-ready `ingest_meta` on Slack/GitHub/Jira/Linear/meeting
* Hook: `processSignal` after enrich + temporal (isolated try/catch)
* Org-state compile consumes snapshots + open conflicts + COMMITMENT claims
* APIs: `GET /api/reconciliation/{claims,state,conflicts,decision-required}` (Decide + Brain live)
* Tests: `npm run test:reconciliation` → `reconciliation-phase1.test.ts` + `meaning-vertical-slice.test.ts`

**Phase 1 completion criterion (not “tables exist”)**

Four facts (Slack OAuth blocking launch, Jira PAY-142 Done, GitHub PR #481 merged, meeting “Launch Friday unless OAuth isn’t configured”) must land on **one** feature entity (Payment Integration) with Implementation/Code COMPLETE, Customer Readiness BLOCKED, Launch Readiness AT_RISK, PARTIAL_STATE conflict, multi-source evidence, org-state risks/blockers populated, **no ACTIVE decision**. Friday vs Monday launch dates → DEADLINE conflict → DRAFT only.

---

## 0. Purpose of this document

This is not another conceptual product spec. It is the Phase 1 build contract grounded in the current repository:

* what already exists and must stay
* exact files/functions to touch
* schema + migration plan
* claim / conflict / resolution lifecycle
* `processSignal` integration point
* API + UI contracts
* tests / acceptance criteria
* explicit **what we are NOT changing**

Canonical related docs:

* [`architecture-enforcement.md`](./architecture-enforcement.md) — ledger + auditor invariants
* [`nango-to-signals-architecture.md`](./nango-to-signals-architecture.md) — ingest → `external_signals`
* [`entity-model.md`](./entity-model.md) — Company Brain entities
* [`organization-state.md`](./organization-state.md) — compiled org projection

---

## 1. Architectural stance

### 1.1 Keep the spine

```text
Provider
   ↓
ingestExternal / ingestExternalBatch
   ↓
external_signals          ← IMMUTABLE EVIDENCE LEDGER (unchanged role)
   ↓
auditor.onWrite({ type: "signal" })
   ↓
processSignal             ← EXISTING ORCHESTRATOR (extend, do not fork)
   ├── trust
   ├── detect
   ├── enrich
   ├── temporal (decision_signal only)
   ├── embeddings / linking
   ├── evidence-graph
   ├── EIE hooks (advisory)
   └── organizational truth (narrative / strategic)
```

### 1.2 Add the interpretation layer

```text
processSignal
      ↓  (after enrich + temporal; non-blocking on failure)
reconciliation.runForSignal(signalId)
      ├── claim extraction (heuristic first; optional LLM)
      ├── upsert Claim (first-class)
      ├── attach claim_evidence (signal → claim)
      ├── evidence scoring (deterministic)
      ├── conflict detect / classify / resolve
      ├── update entity_state_snapshots
      ├── optional: execution-risk breadcrumb
      └── open Decision Required → decision_ledger DRAFT (never ACTIVE)
```

### 1.3 Layer separation (non-negotiable)

| Layer | Table / module | Meaning |
|-------|----------------|---------|
| Evidence | `external_signals` | What happened / what was received |
| Interpretation | `claims` + `claim_evidence` | What evidence appears to assert |
| Belief (typed) | `entity_state_snapshots` | What Hustronix currently believes *per entity × dimension* |
| Disagreement | `conflicts` + `conflict_resolutions` | Where evidence disagrees |
| Narrative belief | `organizational_truth_snapshots` | Topic-hash statements from decision signals + ACTIVE decisions |
| Commitment | `decision_ledger` | What humans decide when auto-reconcile is insufficient |
| Enforcement | `auditor` + execution ledger | What work is allowed / blocked |

**Claims are first-class.** Multiple signals may support one claim. Do **not** store claims as enrichment columns on `external_signals`.

---

## 2. Current → target matrix

| Capability | Current implementation | Phase 1 target | Action |
|------------|------------------------|----------------|--------|
| Immutable evidence | `external_signals` via `ingestExternal` | Unchanged | Keep |
| Signal enrich | `intelligence/enrich.ts` → `db.enrichSignal` | Unchanged; may *feed* claim extract | Keep + read |
| Temporal supersession | `resolveTemporalDecisionSignal` (`decision_signal` only) | Keep; may emit claim-level SUPERSEDES later | Keep; do not replace |
| Narrative org truth | `computeOrganizationalTruth` / `organizational_truth_snapshots` | Keep as topic-level narrative layer | **Boundary:** not replaced by snapshots |
| Memory claim gate | `security/claim-validation.ts` → `ai_claim_validations` | Unrelated (memory write gate) | Keep; **different noun** |
| Execution conflicts | `findConflictingExecutions` / `GET /api/operational/conflicts` | Unrelated (task vs NO-list) | Keep |
| Entity graph | `entities`, `evidence-graph`, `wireSignalGraphOnIngest` | Resolve claim `entity_id` against `entities` | Reuse |
| Org state projection | `compileOrganizationState` now reads snapshots + conflicts + COMMITMENT claims | Keep compiling; do not merge into `organizational_truth` | **Done (P1 meaning slice)** |
| Decision commit gate | `transitionDecisionState` / `POST /api/decisions/commit` | Escalation creates DRAFT only; human commits | Keep |
| Multi-dim claim reconcile | **Missing** | Six primitives + pipeline | **Build** |
| Authority matrix | Ad-hoc weights in truth / claim-validation | `source_authority_rules` | **Build** |
| Decision Required queue | Mock Decide UI recommendations | API over open `conflicts` | **Build** |

---

## 3. Boundary: `organizational_truth` vs `entity_state_snapshots`

Inspected: [`apps/api/src/security/organizational-truth.ts`](../apps/api/src/security/organizational-truth.ts).

**What org truth is today**

* Inputs: active `decision_signal` rows + superseded signals + ACTIVE `decision_ledger` vows
* Keying: free-text `intentKey` / `topic_hash` (token bag), **not** entity × dimension
* Output: narrative statements (`active_statement`) with supporting/contradicting evidence refs
* Purpose: “what the company currently believes” in **strategic/narrative** form
* Trigger: `scheduleOrganizationalTruthRecompute` from `processSignal`

**What entity state snapshots are**

* Keying: `(tenant_id, entity_id, dimension)`
* Value: typed state enum (`COMPLETE` | `BLOCKED` | `UNKNOWN` | …) + confidence
* Purpose: **operational reconciliation** of execution-relevant dimensions
* Trigger: reconciliation pipeline after claim upsert

**Phase 1 rule**

| Do | Don't |
|----|-------|
| Keep both | Merge tables |
| Let snapshots be source for operational UI (“Payment Integration readiness”) | Overwrite `organizational_truth_snapshots` from claim pipeline |
| Org-state `risks`/`blockers`/`commitments` compile from snapshots + conflicts | Call `computeOrganizationalTruth` from conflict resolver |
| Continue scheduling org-truth recompute as today | Delete or rename org-truth APIs |

**Naming collision note:** `security/claim-validation.ts` validates **AI memory facts** (`ai_claim_validations`). Reconciliation **Claims** live in new `claims` / `claim_evidence` tables. Code modules must use distinct names:

* Module: `apps/api/src/reconciliation/` (preferred)
* Types: `OrgClaim`, `ClaimEvidenceLink` — never import as if they were `ClaimValidationResult`

---

## 4. Exact files / functions to modify

### 4.1 Touch (Phase 1)

| File | Change |
|------|--------|
| `apps/api/src/database.ts` | Call new schema ensurer; optional thin accessors if pattern fits |
| `apps/api/src/security/v8-schema.ts` **or** new `apps/api/src/reconciliation/schema.ts` | Prefer **new** `ensureReconciliationSchema` invoked from `database.ts` next to V8/V9 (keeps V8 semantic boundary clean) |
| `apps/api/src/intelligence/index.ts` | After enrich + temporal (+ existing truth schedule), call `runReconciliationForSignal(signalId)` fire-and-forget / awaited-best-effort |
| `apps/api/src/server.ts` | New REST routes under `/api/reconciliation/*` and Decision Required bridge |
| `apps/api/src/bootstrap.ts` | Optional: seed default `source_authority_rules` once |

### 4.2 New modules (create)

```text
apps/api/src/reconciliation/
  schema.ts              — ensureReconciliationSchema
  types.ts               — enums + DTOs
  claim-extract.ts       — heuristic (+ optional LLM) → candidate claims
  claim-store.ts         — upsert claim, attach evidence, merge supports
  evidence-score.ts      — deterministic scoring
  authority.ts           — load source_authority_rules
  conflict-detect.ts     — same entity+dimension incompatible states
  conflict-resolve.ts    — decision tree + persistence
  state-snapshot.ts      — upsert entity_state_snapshots
  escalate.ts            — Decision Required → DRAFT decision (gated)
  index.ts               — runReconciliationForSignal orchestrator
  seed-authority.ts      — default matrix
```

### 4.3 Do not modify for behavior (read-only consumers / leave alone)

| File | Why |
|------|-----|
| `integrations/ingestRouter.ts` | Sacred ingest seam |
| `auditor.ts` | Enforcement stays independent of claim truth |
| `security/organizational-truth.ts` | Narrative layer boundary |
| `security/claim-validation.ts` | Memory gate, different domain |
| `security/decision-lifecycle.ts` | Keep temporal signal path; reconciliation may *observe* its results later |
| `intelligence/autoLinker.ts` | Linking remains execution-link concern |
| `decision_ledger` conflict gate in `database.ts` | One ACTIVE decision rule unchanged |

---

## 5. Schema migration plan

### 5.1 Mechanism

Follow existing boot pattern in `database.ts`:

```text
ensureSecuritySchema → ensureV8EnterpriseSchema → ensureV9TrustSchema
  → ensureReconciliationSchema   // NEW, idempotent CREATE TABLE IF NOT EXISTS
```

No destructive migrations. Additive only. All tables tenant-scoped via `tenant_id` (org id), with `user_id` optional for legacy dual-scope reads matching `ledgerTenantInClause()` patterns.

### 5.2 Tables (six primitives)

#### `claims`

```sql
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,          -- entities.id or stable ref_id; see §7
  entity_label TEXT,               -- denormalized for UI
  dimension TEXT NOT NULL,         -- Phase 1 enum, see §6
  predicate TEXT NOT NULL,         -- e.g. status / date / owner
  value TEXT NOT NULL,             -- canonical value string
  state TEXT,                      -- COMPLETE|BLOCKED|UNKNOWN|... when applicable
  intent TEXT NOT NULL
    CHECK(intent IN (
      'OBSERVATION','ASSERTION','PROPOSAL','DECISION',
      'COMMITMENT','PREDICTION','QUESTION','OPINION'
    )),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(status IN ('ACTIVE','SUPERSEDED','RETRACTED','MERGED')),
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_score REAL,             -- best aggregated score
  claim_key TEXT NOT NULL,         -- hash(tenant, entity, dimension, normalized_value, intent_bucket)
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  superseded_by_claim_id TEXT,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_tenant_key
  ON claims(tenant_id, claim_key);
CREATE INDEX IF NOT EXISTS idx_claims_entity_dim
  ON claims(tenant_id, entity_id, dimension, status);
```

**First-class identity:** `claim_key` collapses equivalent assertions so many signals attach via `claim_evidence` instead of duplicating claim rows.

#### `claim_evidence`

```sql
CREATE TABLE IF NOT EXISTS claim_evidence (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'SUPPORTS'
    CHECK(relationship IN ('SUPPORTS','CONTRADICTS','CONTEXT')),
  authority REAL,
  freshness REAL,
  reliability REAL,
  specificity REAL,
  directness REAL,
  score REAL NOT NULL,
  extractor TEXT NOT NULL DEFAULT 'heuristic'
    CHECK(extractor IN ('heuristic','llm','adapter','human')),
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(claim_id, signal_id, relationship)
);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_signal ON claim_evidence(signal_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim ON claim_evidence(claim_id);
```

#### `conflicts`

```sql
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  conflict_type TEXT NOT NULL
    CHECK(conflict_type IN (
      'STATE_MISMATCH','TEMPORAL_MISMATCH','AUTHORITY_MISMATCH',
      'STALE_SIGNAL','SEMANTIC_CONFLICT','PARTIAL_STATE','UNKNOWN'
    )),
  severity TEXT NOT NULL
    CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','RESOLVED','COEXISTING','ESCALATED','DISMISSED')),
  claim_ids_json TEXT NOT NULL,      -- JSON array of claim ids in the conflict set
  causal_impact REAL,
  detected_at DATETIME NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decision_id TEXT                   -- set when escalated to DRAFT decision
);
CREATE INDEX IF NOT EXISTS idx_conflicts_open
  ON conflicts(tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_conflicts_entity_dim
  ON conflicts(tenant_id, entity_id, dimension, status);
```

#### `conflict_resolutions`

```sql
CREATE TABLE IF NOT EXISTS conflict_resolutions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  conflict_id TEXT NOT NULL,
  resolution_type TEXT NOT NULL
    CHECK(resolution_type IN (
      'SUPERSEDED','COEXIST','STALE','MERGED','HUMAN_DECISION','UNKNOWN'
    )),
  winning_claim_id TEXT,
  explanation TEXT NOT NULL,
  confidence REAL NOT NULL,
  resolved_by TEXT NOT NULL
    CHECK(resolved_by IN ('SYSTEM','USER','NEW_EVIDENCE')),
  supporting_evidence_json TEXT,     -- claim_evidence / signal ids
  resolved_at DATETIME NOT NULL,
  UNIQUE(conflict_id)                -- Phase 1: one resolution row per conflict; reopen = new conflict or status flip
);
```

#### `entity_state_snapshots`

```sql
CREATE TABLE IF NOT EXISTS entity_state_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  state TEXT NOT NULL,               -- COMPLETE|IN_PROGRESS|BLOCKED|UNKNOWN|...
  value TEXT,                        -- optional richer value (dates, owners)
  confidence REAL NOT NULL,
  winning_claim_id TEXT,
  supporting_claim_ids_json TEXT,
  contradicting_claim_ids_json TEXT,
  resolution_method TEXT,            -- DETERMINISTIC|COEXIST|HUMAN|UNKNOWN
  unknown_reason TEXT,
  last_updated_at DATETIME NOT NULL,
  UNIQUE(tenant_id, entity_id, dimension)
);
CREATE INDEX IF NOT EXISTS idx_entity_state_tenant
  ON entity_state_snapshots(tenant_id, last_updated_at DESC);
```

#### `source_authority_rules`

```sql
CREATE TABLE IF NOT EXISTS source_authority_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,           -- use '*' for global defaults; tenant overrides win
  source TEXT NOT NULL,              -- slack|github|jira|linear|meeting|crm|...
  claim_dimension TEXT NOT NULL,     -- or '*' wildcard
  claim_predicate TEXT NOT NULL DEFAULT '*',
  authority REAL NOT NULL,           -- 0..1
  reliability_prior REAL NOT NULL DEFAULT 0.7,
  freshness_half_life_hours REAL,    -- state-specific decay; NULL = dimension default
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, source, claim_dimension, claim_predicate)
);
```

### 5.3 Foreign keys

Phase 1: **logical** FKs only (match much of existing SQLite style). Do not add hard FK to `external_signals` if it complicates tests; enforce in code.

### 5.4 Seed data

On first boot (`seed-authority.ts`), insert global (`tenant_id='*'`) defaults:

| source | dimension | authority |
|--------|-----------|-----------|
| github | IMPLEMENTATION | 0.95 |
| github | CODE_INTEGRATION | 0.98 |
| github | DECISION | 0.20 |
| jira / linear | TASK_STATUS | 0.88 |
| jira / linear | OWNERSHIP | 0.85 |
| jira / linear | IMPLEMENTATION | 0.55 |
| slack | TASK_STATUS | 0.40 |
| slack | BLOCKER / DEPENDENCY | 0.70 |
| slack | DECISION | 0.45 |
| meeting | DECISION | 0.85 |
| meeting | LAUNCH_READINESS | 0.80 |
| decision_ledger\* | DECISION | 0.99 |

\*Via claim extractor reading ACTIVE decision as evidence — optional Phase 1.1; not required for first slice.

---

## 6. Phase 1 dimension & state enums

### 6.1 Dimensions (fixed set)

```text
TASK_STATUS
IMPLEMENTATION
CODE_INTEGRATION
OWNERSHIP
DEADLINE
DECISION
DEPENDENCY
LAUNCH_READINESS
CUSTOMER_READINESS
```

Do not expand in Phase 1 without a migration + authority seed update.

### 6.2 States (canonical)

```text
COMPLETE
IN_PROGRESS
BLOCKED
NOT_STARTED
READY
AT_RISK
UNKNOWN
```

Plus dimension-specific values stored in `claims.value` when state alone is insufficient (e.g. deadline ISO date, owner user id). Conflict detection for date/owner uses normalized `value` equality, not only `state`.

### 6.3 Intent filtering (critical)

Only these intents participate in **state snapshots** and **hard conflicts**:

```text
OBSERVATION, ASSERTION, DECISION, COMMITMENT
```

These **never** set organizational state alone:

```text
PROPOSAL, PREDICTION, QUESTION, OPINION
```

They may still be stored as claims with evidence for explanation UI.

---

## 7. Entity resolution (Phase 1 pragmatic)

Reuse `entities` + `affected_systems` from enrich:

1. If enrich `affected_systems` matches `entities.label` / `ref_id` (existing `wireSignalGraphOnIngest` lookup) → use that `ref_id` as `entity_id`.
2. Else if signal linked / related decision / task → prefer task/project entity.
3. Else create **soft entity**: `entity_id = "soft:" + slug(label)` and upsert into `entities` with low confidence (`type` ∈ existing set, prefer `feature` | `project` | `task`).

Phase 1 does **not** build a full alias graph (PAY-142 ↔ payment-service). Adapter-normalized IDs (Jira key, GitHub repo) should be preferred when present in `ingest_meta` / signal metadata.

---

## 8. Claim lifecycle

```text
Signal enriched
      ↓
extractCandidateClaims[]   (0..N)
      ↓
for each candidate:
  normalize dimension/state/value
  compute claim_key
  UPSERT claims (ACTIVE)
  INSERT claim_evidence SUPPORTS (idempotent)
  recompute claim.evidence_score = max/aggregate of evidence scores
      ↓
find ACTIVE claims same (entity_id, dimension) with incompatible value/state
      ↓
open or update conflict
      ↓
resolve tree → update claim.status / snapshot / escalate
```

### 8.1 claim_key

```text
sha256(
  tenant_id |
  entity_id |
  dimension |
  normalize(value|state) |
  intent_bucket   // ASSERTION≈OBSERVATION for keying; DECISION separate; ignore PROPOSAL
)
```

Same key → same claim row; new signal only adds `claim_evidence`.

### 8.2 Supersession

When resolution picks a winner:

* loser `claims.status = SUPERSEDED`
* `superseded_by_claim_id = winner`
* evidence rows retained forever

---

## 9. Evidence scoring (deterministic)

```text
score = authority × freshness × reliability × specificity × directness
```

| Factor | Source |
|--------|--------|
| authority | `source_authority_rules` for `(source, dimension)` |
| freshness | `exp(-ageHours / halfLife)` using rule or dimension default |
| reliability | rule `reliability_prior` (learning = Phase 2) |
| specificity | heuristic: structured adapter event 1.0; short vague Slack ↓ |
| directness | adapter/system event 1.0; reported speech 0.5 |

LLM must **not** invent these numbers. Optional LLM only proposes claim text/dimension/intent; scores always local.

---

## 10. Conflict detection algorithm

A **conflict candidate** exists when:

```text
same tenant_id
AND same entity_id
AND same dimension
AND both claims.status = ACTIVE
AND both intents ∈ {OBSERVATION, ASSERTION, DECISION, COMMITMENT}
AND incompatible(state/value)
AND within relevance window (default: both last_seen within max(halfLife×4, 14d) OR either is DECISION intent)
```

**Compatible** examples (→ COEXIST, not conflict):

* `IMPLEMENTATION=COMPLETE` vs `CUSTOMER_READINESS=BLOCKED` (different dimensions)
* same dimension + same normalized value

**Incompatible** examples:

* `TASK_STATUS=COMPLETE` vs `TASK_STATUS=BLOCKED`
* `DEADLINE=2026-08-15` vs `DEADLINE=2026-08-18`
* `DECISION` launch Friday vs Monday

**False-conflict guard:** if dimensions differ → never `STATE_MISMATCH`. Optionally emit **execution risk** event (Phase 1.1) without opening a conflict.

### 10.1 Classification

| Condition | `conflict_type` |
|-----------|-----------------|
| Incompatible contemporaneous states | `STATE_MISMATCH` |
| Later claim clearly transitions state | `TEMPORAL_MISMATCH` (often auto-resolved) |
| Winner unclear but authorities differ sharply | `AUTHORITY_MISMATCH` |
| Older claim beyond half-life | `STALE_SIGNAL` |
| Else | `UNKNOWN` |

---

## 11. Resolution state machine

```text
                New / updated claim
                        │
                        ▼
              Related ACTIVE claims?
                   /          \
                 No            Yes
                 │              │
           update snapshot      ▼
                           Compatible?
                            /       \
                          Yes        No
                          │           │
                      COEXIST         ▼
                      (no OPEN     Temporal supersede?
                       conflict)     /            \
                                   Yes             No
                                   │               │
                              SUPERSEDED      Authority margin
                              snapshot           ≥ τ ?
                                                 /    \
                                               Yes     No
                                               │       │
                                            Resolve  If severity≥HIGH
                                            snapshot  AND confidence low
                                                     → ESCALATED
```

### 11.1 Automatic resolve thresholds (defaults)

| Rule | Threshold |
|------|-----------|
| Authority margin to auto-win | `score_winner ≥ score_loser × 1.35` AND `score_winner ≥ 0.55` |
| Temporal supersede | later claim, compatible transition table, fresher by ≥1h |
| Stale lose | age > half-life × 3 AND opposing score ≥ 0.5 |
| Escalate | unresolved AND severity ∈ {HIGH, CRITICAL} AND auto confidence < 0.7 |

### 11.2 Conflict status meanings

| Status | Meaning |
|--------|---------|
| `OPEN` | Unresolved disagreement |
| `COEXISTING` | Different dimensions or explicitly compatible partial states recorded for audit trail (rare as conflict row; prefer skip) |
| `RESOLVED` | System or new evidence closed it |
| `ESCALATED` | `decision_id` set to DRAFT decision |
| `DISMISSED` | Human dismissed |

### 11.3 Resolution types

Map 1:1 to `conflict_resolutions.resolution_type`. Human confirm via API sets `HUMAN_DECISION` and may create/commit decision through existing routes — Phase 1 escalate only creates **DRAFT**.

---

## 12. `processSignal` integration

File: [`apps/api/src/intelligence/index.ts`](../apps/api/src/intelligence/index.ts)

### 12.1 Insertion point

After successful `applyEnrichment` and `resolveTemporalDecisionSignal`, **alongside** (not replacing) `scheduleOrganizationalTruthRecompute` and graph index:

```text
applyEnrichment(...)
resolveTemporalDecisionSignal(...)
scheduleOrganizationalTruthRecompute(...)
indexSignalAsEvidence(...)
wireSignalGraphOnIngest(...)
── NEW ──
await runReconciliationForSignal(signalId).catch(log)   // or setImmediate
── then existing link gates ──
```

### 12.2 Skip rules (inherit cost gates)

Do **not** run reconciliation when:

* `skippedReason` ∈ `tiny-content` | `injection-blocked` (still may run heuristic-only extract for non-injection tiny? **No** — skip)
* signal `state === KILLED`
* `op_classification === ambient` AND heuristic claim extract returns empty
* idempotent: if claim_evidence already has this `signal_id` and `opts.force` is false, skip extract (allow force reprocess)

### 12.3 Failure isolation

Reconciliation errors set optional `external_signals.intelligence_error` suffix or a dedicated log line; **must not** fail linking/enrichment. Same philosophy as current pipeline try/catch around truth/graph.

### 12.4 Meeting path

`meetingIngestion` already enriches early. Ensure it either:

* calls `processSignal({ force: false })` paths that still hit reconciliation, or
* invokes `runReconciliationForSignal` after meeting enrich

Prefer single orchestrator so meetings don’t diverge.

---

## 13. Decision Required → decision ledger

### 13.1 Escalate behavior

`escalate.ts` when opening `ESCALATED` conflict:

1. `POST`-equivalent internal call: create `decision_ledger` row `status=DRAFT` with vow derived from conflict explanation
2. Store `conflicts.decision_id`
3. Attach metadata: `source: "reconciliation"`, `conflict_id`, entity, dimension
4. **Never** call `commitDecisionActive` / `transitionDecisionState(ACTIVE)`

### 13.2 Human resolution

UI / API:

* Confirm winning claim → write `conflict_resolutions` (`HUMAN_DECISION`) → update snapshot → mark conflict `RESOLVED`
* Optional: user then commits DRAFT via existing `POST /api/decisions/commit` (unchanged ACTIVE gate)

### 13.3 Permissions

Reuse RBAC:

* read conflicts: `decision:read`
* resolve / dismiss: `decision:write`
* commit ACTIVE: `decision:commit` (existing)

---

## 14. API contracts

Base path: `/api/reconciliation`

| Method | Path | Permission | Behavior |
|--------|------|------------|----------|
| GET | `/claims` | `decision:read` | Filter: entityId, dimension, status |
| GET | `/claims/:id` | `decision:read` | Claim + evidence list |
| GET | `/state` | `decision:read` | Entity state snapshots (filter entityId) |
| GET | `/state/:entityId` | `decision:read` | All dimensions for entity |
| GET | `/conflicts` | `decision:read` | Default `status=OPEN,ESCALATED` |
| GET | `/conflicts/:id` | `decision:read` | Detail + claims + resolution |
| POST | `/conflicts/:id/resolve` | `decision:write` | Body: `{ winningClaimId?, resolutionType, explanation? }` |
| POST | `/conflicts/:id/dismiss` | `decision:write` | Dismiss |
| GET | `/decision-required` | `decision:read` | `conflicts` where `status=ESCALATED` + joined DRAFT decision |
| GET | `/authority` | `decision:read` | Effective rules for tenant |
| PUT | `/authority` | owner/admin | Upsert tenant overrides |

Do **not** remove:

* `GET /api/truth/current` / `snapshots`
* `GET /api/operational/conflicts` (execution conflicts — different resource; consider renaming UI label later to “Execution conflicts”)

---

## 15. UI data contract (os-ui)

Phase 1 API-first; UI can be thin.

### 15.1 Decision Required card

```ts
type DecisionRequiredCard = {
  conflictId: string;
  entityLabel: string;
  dimension: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;           // human explanation
  claims: Array<{
    id: string;
    value: string;
    state?: string;
    evidenceScore: number;
    sources: string[];       // slack, github, ...
  }>;
  impact?: string;           // optional causal blurb P1.1
  decisionId?: string;       // DRAFT
  actions: Array<"confirm_claim" | "create_decision" | "dismiss">;
};
```

### 15.2 Entity readiness panel

```ts
type EntityStateView = {
  entityId: string;
  label: string;
  dimensions: Array<{
    dimension: string;
    state: string;
    confidence: number;
    explanation: string;
  }>;
};
```

Wire later into `/decide` instead of mock recommendations; **Home** may show count of `decision-required`.

---

## 16. Tests and acceptance criteria

### 16.1 Unit tests (new)

| Test | Assert |
|------|--------|
| False conflict | GitHub MERGED + Slack “customer not ready” → two snapshots, **zero** OPEN conflicts |
| Genuine conflict | Jira DONE vs Slack NOT DONE on TASK_STATUS → OPEN or auto-resolved by authority |
| Evidence aggregation | Two Slack + one meeting supporting same BLOCKED claim → one claim, three `claim_evidence` |
| Proposal ignored | “Could we launch Friday?” → intent QUESTION/PROPOSAL → no snapshot write |
| Temporal | BLOCKED then later DONE from higher/fresh authority → SUPERSEDED, snapshot DONE |
| Escalate | Two near-equal DECISION claims on DEADLINE → ESCALATED + DRAFT decision, not ACTIVE |
| Isolation | Reconciliation throw does not prevent enrich persistence |
| Org truth intact | After reconcile, `GET /api/truth/current` still works; tables unchanged in role |

### 16.2 Integration / smoke

Extend patterns in `ops/scripts/smoke-intelligence.ts`:

1. Insert signals via `ingestExternal`
2. `await processSignal(id, { force: true })`
3. Assert claims / snapshots / conflicts rows
4. Assert no second ACTIVE decision created

### 16.3 Definition of Done (Phase 1)

Engine succeeds when for the MVP scenario (Jira Done + GitHub Merged + Slack blocked on OAuth):

1. Claims extracted per dimension  
2. Implementation / task complete coexist with customer readiness blocked  
3. No false STATE_MISMATCH between those dimensions  
4. Snapshot shows multi-dim state  
5. Explanation string available on snapshot/conflict  
6. Org truth + auditor + commit gate unchanged  

---

## 17. Explicitly what we are NOT changing

1. **`ingestExternal` / Nango / Slack Events** contract  
2. **`external_signals` as immutable evidence ledger** (no claim columns as source of truth)  
3. **Auditor enforcement** (grace, kill, NO-list, capacity, collapse)  
4. **One ACTIVE decision per org** gate  
5. **Signals never auto-create ACTIVE decisions**  
6. **`organizational_truth` module and APIs** (keep; boundary in §3)  
7. **`ai_claim_validations` / memory claim validation**  
8. **`GET /api/operational/conflicts` semantics** (execution conflicts)  
9. **Auto-linker thresholds / link API**  
10. **Organization state compiler rewrite** (optional later consumer only)  
11. **Universal source ranking** (GitHub > Jira > Slack) — forbidden; authority is claim-specific  
12. **LLM as sole resolver of truth**  
13. **Writing back to Jira/GitHub/Slack**  
14. **Full Company Brain redesign / every state dimension in V1**

---

## 18. Implementation sequence (engineering order)

1. `reconciliation/schema.ts` + wire into `database.ts` + authority seed  
2. types + evidence-score + authority loader  
3. claim-extract (heuristic from enrich + source adapters) + claim-store  
4. conflict-detect + conflict-resolve + state-snapshot  
5. `runReconciliationForSignal` + `processSignal` hook  
6. escalate → DRAFT decision  
7. REST APIs  
8. unit tests + smoke  
9. thin os-ui Decision Required list (optional same PR / follow-up)

Estimated vertical slice: heuristic-only extract for Slack + GitHub + Jira/Linear metadata already on signals; LLM extract behind flag `RECONCILIATION_LLM=1`.

---

## 19. Env / flags

| Flag | Default | Meaning |
|------|---------|---------|
| `RECONCILIATION_ENABLED` | `1` | Master switch from `processSignal` |
| `RECONCILIATION_LLM` | `0` | Allow LLM claim extract when heuristic empty |
| `RECONCILIATION_ESCALATE` | `1` | Create DRAFT decisions on escalate |
| `RECONCILIATION_AUTHORITY_MARGIN` | `1.35` | Auto-resolve margin |

---

## 20. One-paragraph summary for implementers

Phase 1 adds a **first-class claim/evidence/conflict/snapshot/authority** layer beside the existing signal ledger. Hook it into `processSignal` after enrich/temporal without replacing organizational truth, auditor, or decision commit. Aggregate many signals into one claim; detect conflicts only on the same entity and dimension; resolve deterministically via claim-specific authority; escalate unresolved high-severity conflicts into **DRAFT** decisions for humans. Success is multi-dimensional state with explainable coexistence — not “Slack vs Jira” alerts and not a new spine.

**DECIDE. ALIGN. EXECUTE.**
