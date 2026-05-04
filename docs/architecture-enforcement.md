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

These tools call the DB **directly** from the LLM tool path:

- `log_strategic_decision` → `db.saveDecisionEvent` (DRAFT decision + tasks)
- `transition_execution` → `db.transitionExecutionState`
- Plus memory tools

**Design intent (target):** *propose* → **validated API / auditor** → **commit**.  
**Current state:** tools **execute** transitions immediately, which is convenient for demos but **strengthens the “agent as controller” risk** the product must not ship at scale without guardrails.

**Mitigations to consider (backlog):** tool handlers enqueue **intents**; only **HTTP routes** or a single **enforcement service** commit; or require **auditor pre-check** token for sensitive tools.

---

## 4. Conflict gate (ACTIVE decision)

**Implemented** in the database layer, not in the doc only:

- `database.ts` → `transitionDecisionState`: when `newState === "ACTIVE"`, `findOtherActiveDecision` enforces **at most one ACTIVE decision per `user_id`**.  
- Conflict → audit `DECISION_CONFLICT_BLOCKED` + **throws** `CONFLICT: Cannot activate while decision … is ACTIVE`.

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
| ACTIVE conflict in DB | — |
| `POST /api/execution/link` as the link contract | Optional automation **calling the same contract** |

---

## 9. Related files

- `docs/agents-and-slack-signals.md` — agents + Slack ingestion detail  
- `src/auditor.ts` — rules  
- `src/integrations/slackEvents.ts` — Events API + filters  
- `src/server.ts` — link, transition, commit, OAuth  
- `src/database.ts` — `transitionDecisionState`, `insertExternalSignal`  

---

## 10. One-line product rule

> **If enforcement is not deterministic, you have a suggestion engine, not a system.**  
> The LLM **assists**; the **ledger + auditor** **decide** durable state.
