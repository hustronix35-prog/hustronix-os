# Hustronix OS — full-system product QA

Run: `fsqa_2026-08-17T17-27-22-301Z_7e1971`  
API: `http://127.0.0.1:3005` · UI: `http://localhost:3000`  
Isolated HTTP tenant: `11a674c7-e441-4a09-9eee-59bfa4273fb6` (`fullsys.c9c4e21a@qa.hustronix.test`)  
Isolated tenants created: **16** (demo/HSOG corpus was dumped, then left alone)

Evaluator rules were followed: no product-code changes, no HSOG score chasing, DB + API + audit checked after every loop transition.

## 1. Executive verdict

**Partially a real Decision OS.** The Talk loop on isolated tenants is real: situation → DRAFT → causal validation → ACTIVE → governed tasks → COMPLETED → `decision_outcomes` → bounded learning. Capacity, reverse, failed-vs-successful outcomes, and tenant isolation all held in the database.

It is **not** safe to claim a live Company Brain, billing, MFA, or file upload. One real execution-governance gap: **BLOCKED tasks can be forced to DONE**.

**Could a founder use this without an explanation?**  
**Yes for Talk → decide → execute → complete, if they came through signup/onboarding and are the org owner.**  
**No if you put them on Brain catalogs, analytics-as-BI, or attachments.** Incomplete onboarding (`org.onboarding.completed` unset) sends the shell to `/onboarding` and swallows search.

## 2. Overall score

Founder journey **80/100** after reclassifying harness noise (see §1a). Raw runner score was 63/100 because three P0s were the HTTP tenant missing owner/onboarding stamps that `POST /api/auth/register` would have set.

| Dimension | /10 |
|---|---:|
| Understands what's happening | 8 |
| Evidence quality | 8 |
| Explains why | 7 |
| Identifies impact | 8 |
| Recommends action | 8 |
| Governance | 9 |
| Execution | 6 |
| Capacity | 9 |
| Outcome measurement | 9 |
| Learning | 8 |
| **Total** | **80** |

### 1a. Reclassification (raw vs product)

The runner recorded **86 checks · 79 passed · 7 failed**. After reading API + DB, those 7 split as:

| Raw fail | Honest class | Why |
|---|---|---|
| PATCH `/api/me` 403 `settings:write` | **Harness + P2 product note** | Login does **not** call `stampOrgOwnerIfUnset`. Register does. This tenant was inserted via SQLite in a second connection; API treated the user as **viewer**. Earlier UI pass on a stamped QA user persisted profile/settings. |
| POST `/api/settings/bulk` 403 | Same | Same owner stamp. |
| Search → `/onboarding` | **P2 UX** | Shell intercepts when `org.onboarding.completed` is unset as seen by the API. Search never ran. |
| Chat attach `null` | **Not a regression** | Page was onboarding, not the Talk thread composer. Prior `qa:os-ui-click` on a completed-onboarding user: attach **disabled** as designed. |
| Change photo `null` | Same | Same intercept. |
| BLOCKED → DONE | **REAL_BUG P1** | `transitionExecutionState` sets any non-ACTIVE target with no illegal-transition table. |
| `test:os-enforcement` SQLITE_BUSY | **Harness** | Second SQLite writer vs live API. Same pack was **8/8** earlier this session. |

## 3–4. Test count

**86** runner checks · **79** raw pass · **7** raw fail.  
Product-true fails this run: **1** (BLOCKED→DONE).  
Talk loop A–F: **all passed with DB verification.**

## 5. Real bugs

1. **P1** `BLOCKED → DONE` is accepted. A blocked task can skip ACTIVE and complete. Audit still writes `TASK_TRANSITION`. This is a mutation-gateway hole, not a UI illusion.

## 6. Mock / not-live features

| Surface | Class |
|---|---|
| Talk | LIVE |
| Home attention / mission summary | LIVE (mock flash until fetch) |
| Signals | LIVE |
| Decide / Execute / Teams / Alerts | LIVE when authenticated |
| Settings profile / general / notifications | LIVE when caller is owner |
| Settings users / roles / spaces / billing / MFA | MOCK |
| Brain people / projects / docs | MOCK (Share copies URL; Star/Edit not live) |
| Analytics | PARTIAL (live summary merged onto `analyticsMock`) |
| Help | MOCK |
| Chat attach / profile photo | DISABLED (honest) |

## 7. Intelligence limitations (not bugs)

- Open-world polarity does not treat “happy/green” as IMPROVING (CobaltWorks-class). Prior `hsog:operating-loop` **50/51**.
- Learning needs **5** samples; an outcome row is not itself learning. Caps held: evidence Δ≤2, days Δ≤2, floor Δ≤0.03. Pattern Y untouched. `gateOk` stayed false.
- UNVERIFIED signals staying unverified is grace, not a UI bug.
- Duplicate `externalId` deduped (1 row).

## 8. Security

Held in this run:

- Invalid login → 401
- Unauthenticated `/api/me` and `/api/decisions` → 401
- Cross-tenant commit → 403 (`resource belongs to another tenant`)
- Direct `mutationCommitDecision` across tenants → Forbidden
- Logout invalidates the session cookie
- Server-only key `org.owner_user_id` is not writable (403/400)
- Signup without email OTP → 400 `otpRequired` (product, not a bypass)

**P2:** `POST /api/auth/login` does not stamp org owner. Accounts that never went through register (or whose `org.owner_user_id` is missing) become **viewer** and cannot save settings. That is real, but it is not a Talk-loop bypass.

## 9. UX

- Home/Decide/Alerts still **initialize** from `mock-data`, then replace after `/api/me`. Unauthenticated users see fixture companies.
- `/onboarding` can capture the shell and drop global search.
- Talk “who is affected?” and Teams bottlenecks named the same QA/Engineering pair.

## 10. Database

Dump: `data/os-state-dump.json` (global corpus). Isolated tenants started at 0 situations/decisions/tasks.

Loop A after execute/complete (verified): DRAFT → ACTIVE → tasks DONE → COMPLETED → exactly **1** `decision_outcomes` row → audit events on the decision id.

Loop D: COMPLETED + WORSENING → outcome **failed**, situation **not RESOLVED**.  
Loop E: COMPLETED + IMPROVING → **successful** + **RESOLVED**.  
Loop F: REVERSED, situation **DECISION_READY**, evidence kept, second reverse throws.

## 11. Founder Journey

UI-only: login landed on `/`, then onboarding intercepted search.  
Product loop (API/DB, isolated tenants): attention → create → hypotheses → instrumentation → execute → tasks DONE → complete → outcome. That path is the one that actually works.

## 12. Top fixes (ranked)

1. **P1** Reject illegal execution transitions (`BLOCKED→DONE`, `PENDING→DONE`, `KILLED→ACTIVE` unless an explicit revive exists).
2. **P2** Call `stampOrgOwnerIfUnset` on login, not only register.
3. **P2** Don’t let `/onboarding` swallow global search / Talk once a session exists — or complete onboarding server-side when org name is set.
4. **P2** Remove mock-data first paint on Home/Decide/Alerts when authenticated (empty state until live).
5. **P2** Analytics: stop merging onto `analyticsMock` or label the page “partial.”
6. **P3** Brain catalogs: keep disabled; don’t fake CRUD.
7. **P3** Open-world sentiment polarity (expected limitation until you choose to extend it).

## 13. Genuinely production-ready

- Talk create / causal validation (`CAUSAL_VALIDATION_REQUIRED`) / execute / complete / reverse
- Hours capacity (40h − 32h − 16h → BLOCKED, overloaded by 8h)
- Outcome evaluation (task done ≠ business success)
- Bounded readiness learning
- Session auth, logout, tenant isolation
- Profile/settings persistence **for org owners**

## 14. Unsafe to claim

- Company Brain as a live graph of people/projects/docs
- Billing, users/roles/spaces admin, MFA UX
- File attachments
- Analytics as full BI
- “Understands contradictory sentiment” in open-world
- Execution ledger as a strict state machine (BLOCKED→DONE still works)

## 15. Commands used

```powershell
npm run dump:os-state
npm run qa:full-system
npm run test:wave3-completion
npm run test:wave3-evaluation
npm run test:wave3-learning
npm run test:operating-loop
npm run test:os-enforcement
```

Plan: `docs/qa/hustronix-full-system-execution-plan.md`

## 16. Regression results

| Command | Result |
|---|---|
| test:wave3-completion | PASS 4/4 |
| test:wave3-evaluation | PASS 3/3 |
| test:wave3-learning | PASS 10/10 |
| test:operating-loop | PASS 6/6 |
| test:os-enforcement | 6/8 this run (`SQLITE_BUSY` vs live API); **8/8** earlier same day |
| hsog:operating-loop (prior) | 50/51 expected CobaltWorks polarity miss |

## Appendix — every raw runner check

The table below is the **instrumented** output before reclassification. Use §1a as the product reading.

| Phase | Id | Result | Kind | Expected | Actual |
|---|---|---|---|---|---|
| 0 | dump | PASS | PASS | data/os-state-dump.json written | wrote dump |
| 0 | isolated-tenant | PASS | PASS | 0 situations/decisions/tasks | empty tenant |
| 3A | talk-grounded | PASS | PASS | grounded answers | brief=true |
| 3A | evidence | PASS | PASS | non-empty | Northwind warehouse delay… |
| 3A | impact | PASS | PASS | people/teams | Entities: Northwind. Bottleneck: product. |
| 3A | recommend | PASS | PASS | recommended next | Restore the SLA |
| 3A | draft | PASS | PASS | DRAFT | DRAFT |
| 3A | execute | PASS | PASS | ACTIVE | ACTIVE |
| 3A | tasks | PASS | PASS | >0 | 2 |
| 3A | done | PASS | PASS | 0 open | 0 |
| 3A | complete | PASS | PASS | COMPLETED | COMPLETED |
| 3A | outcome-row | PASS | PASS | 1 | 1 |
| 3A | audit | PASS | PASS | >0 | 4 |
| 3B | talk-skip | PASS | PASS | DRAFT + blocked | DRAFT |
| 3B | gateway | PASS | PASS | CAUSAL_VALIDATION_REQUIRED | Commit blocked: CAUSAL_VALIDATION_REQUIRED |
| 3B | no-task | PASS | PASS | DRAFT + 0 tasks | ok |
| 3C | capacity | PASS | PASS | BLOCKED + 8h | Overloaded by 8 hours |
| 3D | failed-outcome | PASS | PASS | failed + not RESOLVED | ok |
| 3E | success-outcome | PASS | PASS | successful + RESOLVED | ok |
| 3F | reverse | PASS | PASS | REVERSED | DECISION_READY |
| 5 | x-learns / y-untouched / caps / gate / one-row | PASS | PASS | learning policy | held |
| 6 | direction | PASS | PASS | QA → Engineering | QA → Engineering |
| 7 | rank-moves | PASS | PASS | items increase | 0 → 2 |
| 10 | tenant-isolation | PASS | PASS | not ACTIVE | Forbidden |
| 2 | login / logout / unauth | PASS | PASS | session lifecycle | held |
