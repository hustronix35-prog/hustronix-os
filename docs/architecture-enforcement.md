# Enforcement architecture (production model)

This document records **how deterministic enforcement relates to the LLM layer**, what is **implemented today**, and what remains **intentional technical debt**—so the system stays an **operating model**, not a suggestion engine.

---

## 1. Source of truth

| Layer | Role |
|--------|------|
| **SQLite ledger** (`decision_ledger`, `execution_ledger`, `external_signals`, `audit_log`) | Authoritative state |
| **Auditor** (`src/auditor.ts`) | Deterministic rules: shadow work / grace, capacity hints, NO-list, structural collapse |
| **LLM coordinator** (`src/agent.ts`) | Assistance + structured tool calls; **must not** be the only enforcement path |

---

## 2. Agent vs auditor (critical separation)

- **Chat / coordinator** (`runAgent`): proposes actions via tools, answers questions, delegates to short-lived sub-agents.
- **Auditor**: evaluates the **DB** on a schedule and on **key mutations** (see §5). It does not “chat.”

Sub-agents (**Marketing**, **Research**) today only receive **web search** tools; they are optional product surface, not enforcement.

---

## 3. Coordinator tools that mutate state (known risk)

These tools go through the **mutation gateway** (`mutation-handlers.ts`), same as HTTP:

- `log_strategic_decision` → `mutationCreateDraftDecision` (DRAFT + tenant checks)
- `transition_execution` → `mutationTransitionExecution` (tenant + capacity gate)
- Plus memory tools

**Design intent:** *propose* → **validated API / auditor** → **commit**. Chat cannot bypass Mission Control tenant/capacity rules.

**Mitigations to consider (backlog):** tool handlers enqueue **intents**; only **HTTP routes** or a single **enforcement service** commit; or require **auditor pre-check** token for sensitive tools.

---

## 4. Conflict gate (ACTIVE decision)

**Implemented** in the database layer, not in the doc only:

- `database.ts` → `transitionDecisionState`: when `newState === "ACTIVE"`, `findConflictingActiveDecision` blocks only if another ACTIVE vow in the org has an **overlapping NO-list**. Orthogonal bets (launch hold vs hiring freeze) may both be ACTIVE.  
- Conflict → audit `DECISION_CONFLICT_BLOCKED` + **throws** `CONFLICT: … shared NO-list: "…"`.  
- Owner overload is still enforced at **execution** time (`getOwnerCapacity` from roster hours / 8 × reputation).

So “commit to ACTIVE” via Mission Control / `POST /api/decisions/commit` / WebSocket `COMMIT_DECISION` goes through this gate. **DRAFT creation** does not; only **activation** is conflict-checked.

---

## 5. Signal → execution linking (explicit path)

Ingestion (e.g. Slack) only **inserts** `external_signals` (`UNVERIFIED`). Linking to work is a **separate, explicit** step:

| Step | Mechanism |
|------|------------|
| List / triage | `GET /api/execution/signals/by-state`, Signals UI |
| **Link** | `POST /api/execution/link` with `{ signalId, taskId }` — sets `state = LINKED`, `linked_execution_id` |
| **Kill** | `POST /api/execution/signals/kill` (or auditor after grace) |

There is **no auto-LLM “suggested execution”** in the hot path today; **manual (or future rules engine) linking** keeps noise visible and decisions intentional.

A future **Signal Linking Engine** can sit between ingest and `LINKED`: match heuristics, confidence thresholds, then call the same **link** API or write `LINKED` under stricter policy.

---

## 6. Auditor trigger strategy: event-driven + cron

| Trigger | When |
|---------|------|
| **After Slack signal insert** | `auditor.runAfterSignalIngested()` — shadow-work pass (grace init + kill expired) |
| **After ledger mutation** | `auditor.runAfterLedgerMutation()` — full `evaluateAll()` on: execution **transition**, signal **link**, decision **ACTIVE** (commit path) |
| **Cron** | `*/5 * * * *` in `bootstrap.ts` — **safety net** if a code path forgets to call the auditor or for time-based grace |

So: **events first**, **cron as backup**—not the only driver.

---

## 7. Slack → signal volume (backpressure)

Env-based filters in `src/integrations/slackEvents.ts`:

| Variable | Effect |
|----------|--------|
| `SLACK_INGEST_CHANNEL_ALLOWLIST` | If non-empty, **only** these channel IDs (comma-separated) create signals. |
| `SLACK_INGEST_CHANNEL_DENYLIST` | Channel IDs to **never** ingest. **Deny is evaluated first**, then allowlist. |

Further caps (per-minute throttles, keyword gates) are backlog.

---

## 8. What to keep vs fix (summary)

| Keep | Fix / backlog |
|------|----------------|
| Slack HTTP → DB → auditor pipeline | Agent tools that write DB without proposal queue |
| Deduplication + signing secret | Richer **signal → execution** matching service |
| Grace + auditor KILLED | Throttles + keyword / team policies |
| Multi-tenant `team_id` → `user_id` | — |
| ACTIVE conflict classes (NO-list overlap) in DB | — |
| `POST /api/execution/link` as the link contract | Optional automation **calling the same contract** |

---

## 9. Related files

- `docs/database-consistency-and-context.md` — SQLite schema, consistency gates, working-set vs retrieval, cost-saver caps  
- `docs/agents-and-slack-signals.md` — agents + Slack ingestion detail  
- `docs/signal-conflict-reconciliation-phase1.md` — claim/conflict/snapshot layer on top of `processSignal` (does not replace this spine)
- `src/auditor.ts` — rules  
- `src/integrations/slackEvents.ts` — Events API + filters  
- `apps/api/src/server.ts` — link, transition, commit, OAuth
- `apps/api/src/database.ts` — `transitionDecisionState`, `insertExternalSignal`

---

## 10. Execution Intelligence Engine (EIE) — advisory learning loop

V1 adds a **parallel learning path** that does not replace auditor enforcement:

```text
ledger mutations → execution_evidence (immutable)
                → execution_features (versioned store)
                → entity_beliefs (Beta/Gaussian posteriors)
                → execution_predictions (shadow + explanations)
                → prediction.calibration_error → evidence (closed loop)
```

| Layer | Role in V1 |
|--------|------------|
| **`owner_reputation` + `getOwnerCapacity`** | **Enforcement** — unchanged; auditor capacity checks still use this |
| **`entity_beliefs`** | **Advisory** — probabilistic execution beliefs (`mean`, `variance`, `n_obs`, `model_id`) |
| **`execution_predictions`** | **Shadow only** — logged with `model_version`, `feature_version`, `algorithm_version` + explanation JSON |
| **`beliefs` (narrative)** | **Separate** — institutional/narrative beliefs stay in `beliefs` + `belief_evidence`; EIE does not merge them in V1 |

**Hook wiring:** `bootstrap.ts` chains `executionIntelligence.onLedgerEvent(ctx)` beside `auditor.onWrite(ctx)` on every ledger write. Evidence also emits from `auditor.killExpiredSignal` (with `INSERT OR IGNORE INTO owner_reputation` before UPDATE), `outcome-evaluation.ts` (`decision.outcome`), and execution/signal paths via the auditor hook.

**Derived capacity** is computed at read time from `performance_at_load:{bucket}` beliefs — not stored as `optimal_load`. Teams UI and `GET /api/execution/capacity` expose shadow capacity **next to** legacy capacity with an explicit advisory tooltip.

**Replay:** `POST /api/intelligence/replay` rebuilds `entity_beliefs` from `execution_evidence` + `execution_features` (operator/admin via `audit:run`).

**Key module:** `apps/api/src/execution-intelligence/` — distinct from narrative `apps/api/src/beliefs/`.

---

## 11. One-line product rule

> **If enforcement is not deterministic, you have a suggestion engine, not a system.**  
> The LLM **assists**; the **ledger + auditor** **decide** durable state.

---

## 12. Clarification (exception channel)

Clarification is **not chat** and **not a standing update ping**. It opens only when execution reality is insufficiently known.

```text
Normal:     Signal → Ledger → Auditor → Decision → Execution
Exception:  Ledger/Signals → Auditor → Clarification Request → Owner →
            extract claims → validate → allowed mutation → Ledger/Signal → Auditor
```

| Layer | Responsibility |
|--------|----------------|
| **Ask** | User voluntarily asks Hustronix |
| **ClarificationRequest** | Workflow object: question, reason, claims, resolution |
| **Messages / Slack / email** | Transport only |
| **Execution ledger + signals + audit_log** | Source of truth |

**Invariant:** Chat/messages are transport. Clarification Requests are workflow objects. The ledger remains truth.

**V1:** `clarification_requests` table; auditor opens at most one `OPEN` request per task (`BLOCKED`, `STALE`, `MISSING_FIELD`, `DEPENDENCY_UNCLEAR`, `OWNER_UNCLEAR`). Owner-facing copy always includes a **reason for asking**. Answer path: LLM/heuristic extraction → deterministic validation → `mutationTransitionExecution` / signal link / meta patch. Same fingerprint does not re-open after commit.

**APIs:** `GET /api/execution/clarifications`, `POST .../answer`, `POST .../dismiss`. UI: Execute rail “Needs clarification.”
