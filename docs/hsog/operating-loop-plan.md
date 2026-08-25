# Plan: Talk → Execute → Measure → Learn

**Date:** 15 August 2026  
**Status:** Wave 0 implemented — Talk → Validate → Execute. Stop and demo before Waves 1–4.  
**Constraint:** the intelligence engine is **not** the problem. Do not rebuild it. Do not weaken governance. Do not force-attach off-facet evidence. Do not chase day-taste ~95.

North star:

```text
Talk → Understand → Evidence → Impact → Decide → Execute → Measure outcome → Learn
                                                              └─ retunes readiness (bounded)
```

That loop is the gap between an impressive prototype and software a company depends on.

---

## 0. What is already true (do not redo)

| Proof | Result |
|---|---|
| Blind HSOG | 8/8 decision-ready |
| Evidence | **0.87** (honest; leftover mostly correct non-attach) |
| Open-world | 7/7 discover · 4/4 should-ready · 2/2 resolve · **0** false-ready |
| De-escalation | 2/2 + 2/2 |
| Governance | **53/53** |
| Talk grounding | company → Acme → evidence → impact → recommend → DRAFT |

The brain works. The **operating system around it** does not close.

```text
Signals → Entities → Candidates → Evidence → Temporal → Readiness
       → DRAFT → (Talk execute dies on v3 gates)
       → tasks ACTIVE/DONE (no situation update)
       → learning_log INSERT (never read for gates)
```

---

## 1. Why this order

Later waves need earlier ones. Do not run them in parallel as equals.

| Wave | Fixes | Why first / later |
|---|---|---|
| **0 — Talk is the OS** | Flaw 5 | Product front door. Execute must complete *through* governance, not around it. Outcome learning is unreachable until commit works. |
| **1 — Impact is organizational** | Flaw 2 | Talk’s “who is affected” is only as true as the Teams graph. |
| **2 — Feasibility** | Flaw 3 | Talk must know whether the org can execute, using hours × effort × deadline × deps. |
| **3 — Outcome → Learn** | Flaw 1 | Only after Execute produces real COMPLETED/FAILED outcomes. |
| **4 — Honest evidence** | Flaw 4 | Surgical. Last on purpose so nobody score-chases while productizing. |

Harder open-world (renames, “the account”) and Company Reality Benchmark stay **after Wave 3**. They are science, not the operating loop.

---

## 2. Non-negotiables

1. **No rebuild** of `situation-engine.ts`, `open-world-engine.ts`, or a second backend.
2. **No governance skip.** Talk must *satisfy* `causal_validation` and v3 activation, not stamp `complete: true` in one line.
3. **No force-attach.** SEV1 d66 and FlowOps d77 stay unattached. A looser facet-bridge was tried and reverted (SentryLine CRM bleed).
4. **No READY_GATES bypass.** Learning may *nudge* floors inside hard bounds. Pattern gates still required (`readiness.ts`: `gateOk && score >= 0.48`).
5. **53/53 must not regress.** Re-run `npm run hsog:full-system` after Waves 0 and 3.
6. **Intelligence scores are a floor, not a KPI.** 8/8, 0.87, 7/7, 0 false-ready must hold. Do not spend a cycle to push 0.87 → 0.95.

---

## Wave 0 — Talk is the operating interface (P0)

**Flaw:** `/chat` is a sixth nav item. Login lands on Mission Control. “Execute it” dies on `CAUSAL_VALIDATION_REQUIRED` because Talk-minted DRAFTs are incomplete v3 stubs. Capacity is never even consulted.

**Target:** a signed-in operator lives in Talk. Dashboards remain inspection surfaces, not the place work happens.

### 0.1 Front door

| Change | Where |
|---|---|
| Post-login default → `/chat` | `apps/os-ui/src/components/AuthGate.tsx` (today `/`) |
| Nav: Talk first, then Decide / Tasks as inspect | `apps/os-ui/src/components/shell/AppShell.tsx` |
| Home (`/`) becomes a **brief**, not Mission Control theater: top situations + “Ask Hustronix” | `apps/os-ui/src/app/page.tsx` |
| Chat rail “Suggested Actions” must not dump people onto `/decide` to finish the loop | `apps/os-ui/src/app/chat/page.tsx` |

Keep Decide / Execute / Teams as **ledgers you can open**. The loop itself stays in Talk.

### 0.2 Complete v3 *in* Talk (do not skip the gate)

Today (`situation-chat.ts` `ensureDraft`, `situation-engine.ts` ~803–848):

- `institutional_version: 3`
- situation metadata only
- no `ranked_hypotheses`, `evidence_graph`, `validation_requirements`, `causal_validation`

Activation (`institutional-reasoning.ts` `requireCausalValidationForActivation`) then requires:

- `causal_validation.complete === true`
- `instrumentation_integrity_verified`
- non-empty `checklist_completed`
- full v3: ≥3 hypotheses, ≥2 evidence graph nodes, ≥2 SATISFIED validations, economics, equilibrium, derived confidence floor

**Build, don’t bypass:**

1. New helper `buildInstitutionalMemoFromSituation(sit)` in `apps/api/src/intelligence/` (new file, e.g. `situation-institutional.ts`).
   - Hypotheses from situation title + competing open situations on shared entities + “instrumentation / coincidence / other-cause”.
   - `evidence_graph` from attached evidence (source, day, snippet, strength).
   - `validation_requirements` from missing facets and “what would disconfirm trajectory”.
   - `recommended_actions` from existing recommend text; fill `expected_impact_range`, cost/risk, reversibility.
2. Talk intents, as chips, not a Decide form:
   - **Validate** — walk PENDING requirements; user confirms or supplies missing check.
   - **What else could be true?** — show ranked hypotheses; user can demote.
   - **Instrumentation OK?** — sets `instrumentation_integrity_verified` only after an explicit confirm.
3. Stamp `causal_validation.complete = true` **only when** the same `validateInstitutionalV3ForActivation` function would pass. Reuse the validator; do not duplicate a weaker one.
4. Then `mutationCommitDecision`. Expected: decision `ACTIVE`, `execution_ledger` rows, Talk says what spawned — not “open Decide”.

If a requirement cannot be satisfied from Situation evidence, Talk **stays in DRAFT** and names the missing check. That is the product, not a failure.

### 0.3 Remove HSOG-hardcoded Talk scoring

`situation-chat.ts` `scoreRow` currently boosts `acme`, `signalgrid`, … for company brief. Replace with situation `confidence`, `trajectory`, `stage`, recency. Open-world names must rank without a HSOG lexicon.

### 0.4 Acceptance

```powershell
npm run hsog:talk-complete
```

Must become:

| Step | Pass means |
|---|---|
| Company | Ranked live situations, no hardcoded names required |
| Acme | Churn situation (not SignalGrid) — already true |
| Evidence / impact / recommend | Grounded — already true |
| Create | DRAFT with **completeable** v3 memo (or already exists and is upgraded) |
| Validate | Talk records SATISFIED checks; `causal_validation.complete` still false until last check |
| Execute | `mutationCommitDecision` succeeds · decision `ACTIVE` · ≥1 `execution_ledger` row |
| Governance | Same commit still fails if Talk tries to skip a PENDING validation (unit test) |

New tests (do not fold into HSOG day-taste):

- `ops/scripts/hsog-talk-complete.ts` — distinguish **execute succeeded** vs **grounded but gated**.
- Unit: incomplete v3 still throws `CAUSAL_VALIDATION_REQUIRED`.
- `npm run hsog:full-system` still **53/53**.

### 0.5 Out of scope this wave

Real hours capacity, Teams graph UI, readiness retune, evidence 0.87→0.90.

---

## Wave 1 — Teams intelligence is the org, not a roster (P1)

**Flaw:** `GET /api/org/teams/intelligence` exists. `/team` never calls it. It shows `GET /api/org/intelligence` (roster/health/tree). Dependencies are a flat table filled by regex + catalog + ledger JSON, with **two opposite edge directions**. Talk impact uses a 18-character title match onto that heuristic.

**Target:** Teams tab = bottleneck intelligence. Every workflow edge has provenance. Talk “who is affected” reads the same graph.

### 1.1 One edge contract

Unify writers in `dependency-infer.ts`, `workflow-deps.ts`, `org/intelligence.ts` `syncLedgerDependencies`, `situation-patterns.ts`.

Canonical direction (pick one and migrate):

```text
from = waiter (blocked team)
to   = blocker (team they wait on)
type = waits_on | handoff | blocks
```

Add columns (or JSON on the row — prefer columns):

| Column | Why |
|---|---|
| `edge_type` | `waits_on` / `handoff` / `blocks` |
| `evidence_json` | signal ids + snippets (min 1 for `inferred`) |
| `confidence_0_1` | regex 0.4 · ledger 0.8 · manual 1.0 |
| `situation_id` | optional |

Pattern-catalog edges keep `source=pattern` but must cite the situation’s attached signals, not just a work label.

### 1.2 Stop GET mutation

`buildTeamsIntelligence` currently calls `inferDependenciesFromWorkflow` / `FromSignals` on every GET. Move refresh into `runSituationDetection` (same place as `recordSituationLearnings`). GET becomes read-only.

### 1.3 Teams UI

`apps/os-ui/src/app/team/page.tsx`:

1. Call `GET /api/org/teams/intelligence` (add client helper next to `fetchOrgIntelligence`).
2. Default tab = **Bottlenecks**: team, waiting on, blocking, open situations, overloaded people.
3. **Graph** tab: nodes = teams, edges = `org_dependencies` with evidence peek (snippet + source). Reuse task DAG layout ideas from org-console; do not invent a second graph engine if `compute` on the API is enough to return nodes/edges.
4. Keep roster/directory as a secondary tab.

Fix UI types in `apps/os-ui/src/lib/api.ts`: `source` must include `inferred | pattern`.

### 1.4 Talk impact

`impactAnswer` in `situation-chat.ts`:

- Match bottleneck by `situation_id`, not `title.slice(0, 18)`.
- Name **owner + waiting-on team + evidence snippet**.
- Open-world / emergent: infer teams from roster ∩ signal authors when `teams_json` is empty (`emergent`/`open-world` currently `[]`).

### 1.5 Acceptance

- `/team` shows the same bottleneck Talk narrates for Acme.
- At least one HSOG situation (Acme or SEV1) has ≥1 edge with a real `signal_id`.
- Ledger-synced edges and inferred edges agree on direction (unit test on a two-task chain).
- `GET /api/org/teams/intelligence` does not INSERT.
- New test file: `ops/scripts/org-teams-intelligence.test.ts` (today only snapshot tests exist).

---

## Wave 2 — Real capacity (P1/P2)

**Flaw:** enforcement is a **concurrent weight budget**. Roster `"40h / week"` → `hours/8 × reputation_modifier`. Task `weight` defaults to `1`. `estimated_duration_hours` is written by clarification and **never read** by the gate. There is **no due date** on `execution_ledger`. A 40h person can hold five weight-1 ACTIVE tasks forever.

**Target:** activation answers *whether this can finish given hours, effort, deadline, and unfinished deps* — still via `capacity_exceeded` / `dependency_incomplete`, still auditor-enforced.

### 2.1 Model (keep one gate)

Do not add a second capacity system. Fold into `getOwnerCapacity` + `transitionExecutionState`.

```text
available_hours_week = roster weekly hours
                      − sum(remaining_hours of ACTIVE tasks)
                      − (optional) blocked-but-owned hold

task_effort_hours    = estimated_duration_hours  (fallback: weight × 8)

can_activate         = deps all DONE
                     AND (current remaining_hours + task_effort) ≤ available_hours_week
                     AND if due_at set: remaining_hours_along_dep_path ≤ hours_until(due_at)
```

| Field | Action |
|---|---|
| `execution_ledger.estimated_duration_hours` | Read in the gate; default 8 if null |
| `execution_ledger.due_at` | **Add column** (nullable). Talk/recommend may set from situation urgency |
| `team_roster.capacity` | Keep parsing weekly hours |
| `weight` | Keep for UI/EIE; **stop using it as the activation currency** once hours exist |
| `reputation_modifier` | Keep as a **reliability** signal, not a way to fake 5× capacity. Cap demo bumps; HSOG seed should not need modifier `5.0` if hours are real |
| EIE `computeDerivedCapacity` | Stay advisory (`architecture-enforcement.md` §10) |

Critical path: walk `execution_ledger.dependencies` JSON (already a task DAG). Remaining work = sum of not-DONE effort hours on upstream chain.

### 2.2 Talk

New intent / chip: **Can we execute this?**

Answer with: owner, remaining hours, this task’s effort, blockers, deadline slack. If `capacity_exceeded`, Talk says *who is overloaded and by how many hours* — not “open Execute”.

### 2.3 Acceptance

- Unit: 40h owner, 32h already ACTIVE, 16h new task → BLOCKED `capacity_exceeded`.
- Unit: deps incomplete → still `dependency_incomplete` (unchanged).
- Talk execute after Wave 0: if hours insufficient, grounded BLOCKED explanation.
- HSOG full-system capacity probes still pass (governance). If seed used `modifier=5` only to smash the old 3.0 slot model, **remove that bump** and size task hours honestly instead.
- Do not fail Talk because HSOG parallel sprints were designed for fake capacity.

---

## Wave 3 — Outcome → Evaluation → Learning (P2, architectural frontier)

**Flaw:** `learning_log` is written on every detect for DECIDED/RESOLVED and **never consumed** to change `READY_GATES` or `0.48`. `evaluateDecisionOutcome` only runs on `COMPLETED`/`REVERSED`, and **no live mutation sets those states**. Situation `RESOLVED` comes from improving *signals*, not from task outcomes. `weight_shifts` is never SELECTed. Writer A is not idempotent (duplicate rows every detect).

**Target:** after execution, the OS measures whether the decision worked and **bounded-nudge** future readiness. Not a second brain.

### 3.1 Make COMPLETED real

Add `mutationCompleteDecision` / `mutationReverseDecision` (same mutation gateway as commit).

Triggers (all must go through the mutator, not raw SQL):

| Trigger | Result |
|---|---|
| All spawned tasks `DONE` (and none `KILLED`) | eligible for COMPLETED; Talk chip **Mark as done** |
| Operator in Talk: “it worked” / “close this” | COMPLETED after confirm |
| Operator: “it didn’t work” / “reverse” | REVERSED; spawn no silent auto-retry |
| Auditor collapse (>50% KILLED+BLOCKED) | stays `UNDER_REVIEW` (already). Optional Talk prompt to reverse |

Do **not** auto-COMPLETED from detect. Detect must not complete the ledger.

When COMPLETED/REVERSED: `onDecisionTerminalState` already calls `evaluateDecisionOutcome`. Keep that hook; make it reachable.

### 3.2 Situation follows outcome

| Decision | Situation |
|---|---|
| COMPLETED | `RESOLVED` if trajectory not still WORSENING on fresh evidence; else stay DECIDED and say “executed but evidence still worsening” |
| REVERSED | back to `DECISION_READY` or `ELEVATED` (do not delete evidence) |
| Tasks DONE, decision still ACTIVE | Talk: “execution finished; confirm outcome” |

Hook from `transitionExecutionState` only to **notify** Talk/eligibility, not to mutate situation stage directly (keep ledger as source of truth).

### 3.3 Honest evaluation

Replace token-overlap `scoreOutcome` (`outcome-evaluation.ts`) with structured compare:

```text
expected_outcomes JSON  vs  { tasks_done, tasks_killed, completion_rate,
                              situation_trajectory_after, days_to_resolve }
delta_score ∈ [0,1]
```

Write `decision_outcomes` **upsert** on `decision_id` (add unique index).  
`learning_log` **upsert** on `(user_id, decision_id, kind)` so detect does not flood.

Split kinds:

- `situation_decide` — existing writer A, **stop treating this as outcome**
- `decision_outcome` — writer B, the only input to retune

### 3.4 Bounded learning (the actual retune)

New module `apps/api/src/intelligence/readiness-learning.ts` (do not inline into `situation-engine.ts`).

Reads last N `decision_outcomes` **per pattern_id** (and a global prior):

| If | Nudge |
|---|---|
| High false-ready (COMPLETED but trajectory still WORSENING / reversed fast) | +`minEvidence` or +`minDistinctDays` for that pattern, cap +2 |
| High missed-ready (situation later RESOLVED by signals without a useful decision — rare, needs labels) | do **not** auto-loosen in v1 of learning |
| Useful COMPLETED + IMPROVING | tiny score-floor nudge toward 0.45, **never below 0.45**, never skip `gateOk` |

Persist nudges in a table `readiness_priors (user_id, pattern_id, min_evidence_delta, …)` not by rewriting `READY_GATES` constants.

**Hard floors:** `gatesAllowReady` still required. Global `score >= 0.48` may become `score >= max(0.45, 0.48 + prior)` with `|prior| ≤ 0.03`.

Open-world patterns (`pattern_id` synthetic): use a single `open_world` prior, not per-title overfitting.

### 3.5 Acceptance

- Talk loop after execute: **Mark as done** → `COMPLETED` → `decision_outcomes` row → situation `RESOLVED` when evidence agrees.
- `learning_log` row count does not grow on every `situation_detect`.
- Injected fixture: 5 false-ready on one pattern → next detect requires more evidence; other patterns unchanged.
- `READY_GATES` cannot be emptied by learning (unit).
- `npm run hsog:customer-path:intelligence` still 8/8, evidence ≥ 0.87, 0 false-ready on open-world.
- `npm run hsog:full-system` 53/53.
- Safe claim becomes: “outcome evaluation exists and can retune gates inside bounds.” Still **not** “the system autonomously improves every week.”

---

## Wave 4 — Evidence honesty (P2, small)

**Flaw:** 0.87 is strong. Remaining misses:

| Item | Class | Action |
|---|---|---|
| SignalGrid d82 “Acme imports a larger telemetry dataset than forecast” | **architectural** — shares Acme, no infra facet | Optional **load/volume** facet on *infrastructure only*: `dataset`, `telemetry volume`, `ingest load`, `larger than forecast` **plus** existing entity share. Must still fail if the only shared token is Acme with CRM green-stage chatter |
| SEV1 d66 Acme debugging exception | **off-facet** | **Leave** |
| FlowOps d77 beta rollout chatter | **off-facet** | **Leave** |

### 4.1 If you add the load facet

1. Add phrases to `PATTERN_FACETS` infra `ops`/`reliability` in `situation-patterns.ts`.
2. Re-run `npm run hsog:customer-path:intelligence` and `npm run hsog:missing-evidence`.
3. **Abort if** SentryLine or NexusAI evidence count jumps the way the reverted facet-bridge did (CRM `deal.propertyChange` bleed). Record the delta in the missing-evidence report.
4. Do not add “any facet on an open situation.”

Success: d82 classified attached **or** still architectural with a written reason that volume language was too ambiguous. Either is honest. Target is **not** 1.00.

### 4.2 Acceptance

- Off-facet rows remain off-facet.
- Open-world evidence policy unchanged (constructed corpus 1.00 is not a HSOG target).
- No new situation-specific `if Acme && competitor`.

---

## 3. File map (touch these, not the engine core)

| Wave | Primary files |
|---|---|
| 0 | `situation-chat.ts`, new `situation-institutional.ts`, `apps/os-ui/src/app/chat/page.tsx`, `AppShell.tsx`, `AuthGate.tsx`, `app/page.tsx`, `ops/scripts/hsog-talk-complete.ts` |
| 1 | `teams-intelligence.ts`, `dependency-infer.ts`, `workflow-deps.ts`, `org/schema.ts`, `org/intelligence.ts`, `apps/os-ui/src/app/team/page.tsx`, `os-ui/src/lib/api.ts` |
| 2 | `database.ts` `getOwnerCapacity` / `transitionExecutionState`, execution schema `due_at`, `situation-chat.ts` feasibility intent |
| 3 | `outcome-evaluation.ts`, `situation-learning.ts`, `mutation-handlers.ts`, new `readiness-learning.ts`, `readiness.ts` (read priors only), `situation-detect.ts` |
| 4 | `situation-patterns.ts` facets only; `evidenceMiss.ts` unchanged classifier |

Engine files (`situation-engine.ts`, `open-world-engine.ts`, `emergent-situations.ts`) should only gain **call sites** (priors, teams_json fill, memo attach) — not new scoring philosophies.

---

## 4. Regression pack (every wave)

```powershell
npm run hsog:export-blind
npm run hsog:customer-path:intelligence
npm run hsog:missing-evidence
npm run hsog:generalization
npm run hsog:open-world
npm run hsog:talk-complete
```

After Waves 0 and 3 also:

```powershell
npm run hsog:full-system
```

Floor:

- Detection 1.00 · Evidence ≥ 0.87 · Temporal 1.00 · Action 1.00  
- Open-world 7/7 · 0 false-ready · Chat 5/5  
- Generalization 4/4 · 2/2 de-escalation  
- Governance 53/53  

---

## 5. What we will still not claim

After this plan ships:

**Safe:** Talk is how you operate. Execute is governed. Capacity speaks hours. Teams show bottlenecks with evidence. Outcomes can retune readiness inside bounds.

**Not safe:** autonomous weekly self-improvement; 0.87 means perfect evidence; Talk replaced the ledger; the org graph is complete for unnamed entities; day-taste ~95 is intelligence.

---

## 6. Suggested calendar (if staffed as one engineer who knows this repo)

| Wave | Calendar | Done when |
|---|---|---|
| 0 Talk OS | ~1.5 weeks | Talk execute → ACTIVE + ledger; login opens Talk; 53/53 |
| 1 Teams | ~1.5 weeks | Teams tab = bottlenecks; Talk impact cites evidence edges |
| 2 Capacity | ~1 week | Hours × effort × deps in the same gate; Talk explains BLOCKED |
| 3 Learn | ~2 weeks | COMPLETED path + bounded priors; detect no longer floods `learning_log` |
| 4 Evidence | ~2 days | d82 decision recorded; off-facet untouched |

Company Reality Benchmark (500–2k unlabeled artifacts) is **v2 science after Wave 3**, not a fix for these five flaws.

---

## 7. First implementation slice (Wave 0, smallest)

If only one slice starts next:

1. `buildInstitutionalMemoFromSituation` + Talk **Validate** chips until `validateInstitutionalV3ForActivation` passes.
2. Talk **Execute** → `ACTIVE` + tasks.
3. Upgrade `hsog-talk-complete` so Execute is a real pass/fail, not “answer length > 40”.
4. Login → `/chat`.

Stop there and re-demo. Waves 1–3 are useless if the operator still has to finish the loop on Decide.
