# HSOG customer-path validation

**Goal:** test Hustronix the way a real customer would use it — raw Slack/Jira/Gmail/… through `ingestExternal` — while HSOG ground truth stays offline for scoring.

**Not this:** `event_type` → playbook → decision (that is Test A harness in `hsog:full-system`).

## Dual corpus

| File | Role | Fed to OS? |
|---|---|---|
| Original `os_ingest.json` | Labeled HSOG (scenarios, event_type, GT facts) | **No** (source only) |
| `data/hsog/ground_truth.json` | Evaluator index (scenarios, people, artifact↔opaque id) | **Never** |
| `data/hsog/os_ingest_blind.json` | Customer-shaped artifacts only | **Yes** |

```powershell
npm run hsog:export-blind
```

Blind records look like:

```json
{
  "source": "slack",
  "timestamp": "2026-04-17T10:00:00.000Z",
  "author": "Arjun",
  "channel": "engineering",
  "content": "Arjun in #engineering: Still waiting on API credentials.",
  "external_id": "cust:a1b2c3…"
}
```

No `hsog_scenario_id`, `event_type`, playbook IDs, or ground-truth fact ids.

## Pipeline

```text
Blind artifact
  → provider transform (Slack/Jira/GitHub/Gmail/CRM/…)
  → ingestExternal()
  → external_signals
  → enrich + situation_detect
  → DRAFT situations (no finalizeExecuted)
  → evaluator vs ground_truth.json
```

## Modes

```powershell
npm run hsog:customer-path                              # chrono (default)
npm run hsog:customer-path:intelligence                 # lead-time + synthesis + action
npm run hsog:customer-path -- --mode stream
npm run hsog:customer-path -- --mode sources            # Slack / Jira / combos ablation
npm run hsog:customer-path -- --mode isolated           # one scenario env each
npm run hsog:customer-path -- --mode noise              # ~80% ambient traffic
npm run hsog:customer-path -- --mode conflict           # conflicting launch narratives
npm run hsog:customer-path -- --mode ooo                # out-of-order ingest order
npm run hsog:customer-path -- --mode dup                # re-ingest same corpus
npm run hsog:customer-path:all                          # all modes
```

## The Situation Object

Between signals and decisions:

```text
Signal → Situation (AWARENESS → FORMING → ELEVATED → DECISION_READY) → DRAFT Decision
```

Persisted in `situations` / `situation_evidence` / `situation_events`.

API:

- `GET /api/intelligence/situations`
- `GET /api/intelligence/situations/:id`
- `POST /api/intelligence/situations/ask` — Chat grounding from Situation objects (`{ question }`)

DRAFT decisions are created **only** at `DECISION_READY` — not on first keyword hit.

Progressive gates (pattern-specific) require multi-facet evidence over multiple days.
Word-boundary matching blocks substring bleed (e.g. `hris` ∈ `Chris`).

### Benchmark milestones (not first-evidence lead alone)

| Milestone | Meaning |
|---|---|
| Awareness | Something unusual noticed |
| Forming / Elevated | Situation identified; confidence rising |
| Decision-ready | Enough evidence to recommend action |

Quality scores: detection · evidence synthesis · temporal progression · action usefulness.

## Outputs

- `data/hsog-customer-path-scorecard.json`
- [`hsog-customer-path-report.md`](./hsog-customer-path-report.md)
- [`hsog-intelligence-lead-report.md`](./hsog-intelligence-lead-report.md) (when `--mode intelligence`)
- Ideal console block: scenarios detected, false positives, evidence/deps/owner accuracy, retrieval

## What this suite deliberately does **not** do

- `finalizeExecuted` / seeded Teams deps (Spandan demo only: `hsog:seed-spandan`)
- Labeled trigger map (`DECISION_TRIGGERS` / `PLAYBOOKS`)
- Optimizing situation keywords solely to pass the eight HSOG scenarios
- Treating “detect on first keyword” as solved Decision Intelligence

## Architecture (intelligence path)

```text
RAW SIGNALS
     ↓
ENTITY / EVENT GRAPH   (signal_entities, co-occurrence)
     ↓
CANDIDATE EVIDENCE     (keywords propose)
     ↓
ENTITY + GRAPH ATTACH  (same customer/product → one situation)
     ↓
EMERGENT CLUSTERS      (unseen themes without HSOG scenario ids)
     ↓
EVIDENCE CLUSTER       (facets, sources, timeline, coverage, contradictions)
     ↓
READINESS SCORE        (multi-factor; gates calibrate; de-escalation on IMPROVING)
     ↓
SITUATION → DECISION → EXECUTION
```

Dependencies: inferred from “waiting on / blocked by / exception” language (`source=inferred`), plus pattern edges at decision-ready (`source=pattern`).

## Golden metrics (intelligence suite)

| Metric | Target |
|---|---|
| Evidence synthesis | ≥0.80 |
| Decision-ready lead (avg) | >0 days |
| Action quality | ≥0.90 |
| Temporal progression | high |
| Governance | 100% (separate suite) |

```powershell
npm run hsog:customer-path:intelligence
npm run hsog:generalization   # unseen scenarios + chat E2E + de-escalation
```

## Generalization (must-pass proof)

`npm run hsog:generalization` ingests novel stories (HelixBio, PayOrbit, Northwind, LatticeOps)
with **no** HSOG scenario IDs / playbooks / taught pattern keys. Scoring:

- Discovery rate (emergent situation opened)
- Theme + entity match
- Lead vs declaration
- De-escalation when resolve evidence appears
- Chat grounded in Situation objects

## Power upgrades (post-P0)

- Workflow deps: `workflow-deps.ts` (blocked tasks + task graph → org edges)
- Teams intelligence: `GET /api/org/teams/intelligence`
- Situation learning: writes `learning_log` when situations decide/resolve
- Launch trajectory: mixed green/yellow gates count as **WORSENING** (not IMPROVING)

```powershell
npm run hsog:customer-path:intelligence
npm run hsog:generalization
```

Complete narrative (architecture, scores, journey, remaining work): [`hustronix-intelligence-complete-report.md`](./hustronix-intelligence-complete-report.md)
