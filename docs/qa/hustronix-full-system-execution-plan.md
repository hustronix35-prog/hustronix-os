# Full-System Heavy QA — execution plan

Evaluator stance: test whether the **current** Hustronix OS works as a product.
Do **not** modify product code while testing. Do **not** optimize HSOG scores.
Do **not** classify an expected intelligence limitation as a bug.
Do **not** call a test passed because the UI looks correct.

Verify, for every mutation:

```text
CLICK / API
 → network request?
 → backend mutation?
 → database changed?
 → audit event?
 → UI reflects new state after reload?
```

Classify every result as one of:

`PASS` · `REAL_BUG` · `MOCK_NOT_LIVE` · `EXPECTED_LIMITATION` · `UX` · `SECURITY`

## Environment

```text
API:      http://localhost:3005
UI:       http://localhost:3000
Browser:  authenticated isolated QA tenant
DB:       data/hustronix.db
```

Destructive tests use a **fresh isolated tenant**. The production/demo corpus is dumped, then left alone.

## Commands

```powershell
npm run dump:os-state
npm run qa:full-system
```

Deliverables:

- `docs/qa/hustronix-full-system-report.md`
- `data/hustronix-full-system-scorecard.json`
- `data/os-state-dump.json`

## Phase 0 — Clean baseline

Dump all tables. Create isolated QA tenant. Record user/tenant IDs and per-tenant counts for situations, decisions, executions, outcomes, priors, notifications, settings, audit.

## Phase 1 — UI action integrity

Search, profile, general settings, notifications, chat attach, alerts, Brain share/star/edit.
Fake “Saved locally” / “wire next” toasts are failures.

## Phase 2 — Authentication

Signup → login → `/api/me` → `/chat` → logout → protected route.
Invalid login, session reload, tenant isolation, unauthenticated API.

## Phase 3 — Talk product loop (most important)

A successful execution · B governance rejection · C capacity · D failed outcome · E successful outcome · F reverse.

Database state after **every** transition.

## Phase 4 — Execution ledger

PENDING / ACTIVE / BLOCKED / DONE / KILLED and illegal transitions.

## Phase 5 — Outcome + learning

One `decision_outcomes` row per decision. Priors change only after enough samples. Pattern Y unaffected. Caps hold. `gateOk` cannot be bypassed.

## Phase 6 — Teams

`from = waiter`, `to = blocker`. Talk “who is affected?” vs Teams bottlenecks tell the same story.

## Phase 7 — Home / Attention

New high-risk situation changes ranking. Click opens Talk with that situation. No hardcoded Acme ranking.

## Phase 8 — API contract

Auth, valid, invalid, wrong-tenant, idempotency for the listed endpoints.

## Phase 9 — Live vs mock

Every surface is LIVE / MOCK / DISABLED / BUG. Never “looks live.”

## Phase 10 — Adversarial

Duplicate/contradictory/stale signals, overloaded owner, duplicate complete/reverse, tenant A → tenant B, malformed mutation.

## Phase 11 — Founder Journey

UI-only path. Score /100. Answer: could a founder use this without an explanation?

## Runner

Implemented in `ops/scripts/hustronix-full-system-qa.ts`.
