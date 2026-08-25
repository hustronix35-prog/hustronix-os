# Hustronix — Complete Application Report

**Report date:** 14 August 2026  
**Scope:** Full monorepo as shipped — product surfaces, architecture, maturity, and gaps  
**Companions:** [`architecture-enforcement.md`](architecture-enforcement.md), [`architecture-report-2026-06.md`](architecture-report-2026-06.md), [`database-consistency-and-context.md`](database-consistency-and-context.md)

---

## 1. What Hustronix is

Hustronix is a **Decision Operating System**: organizational commitments live on a ledger, deterministic rules enforce them, and LLMs are an interface into that system — not the source of truth.

| Layer | Role |
| --- | --- |
| **Ledger** | `decision_ledger`, `execution_ledger`, `external_signals`, `audit_log`, signed `ledger_events` |
| **Auditor** | Capacity, NO-list conflict, shadow-work grace, structural collapse — no LLM |
| **UI / agent** | Propose, review, clarify, chat — mutations go through the same security gateway |

**Product promise:** Decide → Align → Execute. A decision becomes an organizational commitment (`ACTIVE`); execution is a separate commitment (tasks `PENDING` → `ACTIVE`).

---

## 2. Stack and runtime

| Layer | Technology | Default |
| --- | --- | --- |
| API + WebSocket | Node, Express, `ws` | Port **3005** (`apps/api`) |
| Default UI | Next.js App Router | Port **3000** (`apps/os-ui`) |
| Legacy UI | Next.js | `npm run dev:web:legacy` (`apps/web`) |
| Database | SQLite (`better-sqlite3`) | `./data/hustronix.db` |
| Postgres | Schema exists | Not production-cutover |
| LLM | Anthropic (premium + fast) / OpenAI | Cost-saver defaults on |
| Marketing | Static Netlify export | `netlify-landing/` |
| Shared contracts | `packages/shared` | Roster + EIE types |

**Dev:** `npm run dev` → API + os-ui. Unified process: `dev:unified` / `start:unified`.

**Auth (browser):** Session cookie `hustronix_session` via same-origin `/api` rewrite. Optional automation: `x-api-key` + `x-user-id`.

---

## 3. Monorepo map

```text
Hustronix OS/
├── apps/api/          Express API, WS, agent, auditor, integrations
├── apps/os-ui/        Default Decision OS shell (new UI)
├── apps/web/          Legacy dashboard + marketing source
├── packages/shared/   Cross-app types
├── docs/              Architecture, security, domain specs
├── ops/               Tests, smoke, migrate, security checks
├── infra/             Docker, Fly, Azure, Postgres schema
├── nango-integrations/ Slack sync adapter
├── netlify-landing/   Demand-validation static site
├── data/              Runtime SQLite
└── scripts/           Landing export/sanitize
```

---

## 4. Core control loop (product architecture)

```text
Signals (Slack, Jira, GitHub, Calendar, Meetings, …)
        ↓
external_signals (UNVERIFIED → LINKED | KILLED)
        ↓
Decide  — DRAFT → Approve → ACTIVE (+ execution plan, read-only)
        ↓
Execute — PENDING → ACTIVE (capacity + deps) → DONE / BLOCKED / KILLED
        ↓
Clarification (exception channel) → structured claims → ledger mutations
        ↓
Auditor (event + */5 cron) → decision health / UNDER_REVIEW tripwire
        ↓
Outcome (COMPLETED / REVERSED) → decision_outcomes + learning_log + beliefs
```

### Semantic boundaries (important)

| Action | Meaning | What it does *not* do |
| --- | --- | --- |
| **Approve Decision** | Commit vow to ledger (`ACTIVE`) | Start tasks, create Jira, book meetings |
| **Start execution** | Task `PENDING` → `ACTIVE` | Change the strategic vow |
| **Clarification answer** | Typed claim → validated mutation | Free-form chat transcript as truth |
| **Reject / Defer (os-ui)** | UI verdict only today | Ledger write |

---

## 5. Backend (`apps/api`) — capability inventory

### 5.1 Auth and tenancy

- Chain: Bearer `hx_live_…` → session cookie → optional legacy UID → API key + user id  
- RBAC: `owner | admin | strategist | operator | viewer | agent`  
- Permissions: `decision:*`, `execution:*`, `signal:*`, `memory:*`, `settings:*`, `security:manage`, `agent:invoke`, `audit:run`  
- High-risk tools (`commit_decision`, etc.): dual-control for agents/keys; **session/UI click skips dual-control** (human *is* the approval)  
- Mutations: `authorizeAndExecuteMutation` → `mutation-handlers.ts`

### 5.2 Ledger and enforcement

| Mechanism | Behavior |
| --- | --- |
| ACTIVE NO-list | Blocks second ACTIVE vow with overlapping constraints |
| Capacity | Owner roster hours / 8 × reputation at task activation |
| Shadow work | Unverified signals get grace → KILL (or GRACE for high risk) |
| Structural collapse | >50% tasks KILLED/BLOCKED → decision `UNDER_REVIEW` |
| Authority events | Hash-chained, signed `ledger_events` on commit |

### 5.3 Execution plan (Aug 2026)

**File:** `apps/api/src/execution/execution-plan.ts`

Read-only plan after commit / on demand:

- Linked actions classified: ready / in_progress / blocked / needs_clarification / done  
- Owner load vs capacity (conflict flags)  
- Existing Jira / Linear / GitHub signals linked to tasks  
- `readinessPct` + `recommendedNext`  
- **Does not** create tickets, meetings, or start work  

**Endpoints:**

- `GET /api/decisions/:id/execution-plan`  
- `POST /api/decisions/commit` → `{ status: "ACTIVE", executionPlan }`

### 5.4 Clarification

Exception workflow (`clarification_requests`): blocked, stale, missing success condition, unclear owner/deps. Answer → extract claims → validate → ledger/signal update → auditor. Wired live on os-ui Execute.

### 5.5 Intelligence and state

| Module | Role | Maturity |
| --- | --- | --- |
| Signal pipeline | Detect → enrich → embed → auto-link (policy-gated) | Live |
| Organization state | Compiled objectives, blockers, active decisions, doctrine | Live API; UI partial |
| Beliefs (narrative) | Hypotheses promoted on commit; updated on outcome | Live |
| Execution intelligence (EIE) | Shadow predictions / calibration | Advisory only |
| Outcome evaluation | On COMPLETED/REVERSED | Stub scoring |
| Meeting ingest | Transcript → operational claims | Live ingest |
| Causal simulator | Decision simulate route | Available |

### 5.6 Integrations

**Inbound (signals):** Slack, GitHub, Jira, Linear, Google Calendar/Gmail, Microsoft (mail/calendar/Teams), Notion, CRM webhooks (HubSpot/Salesforce/Pipedrive), manual, meetings, HSOG taste ingest.

**OAuth:** First-party (7 providers) **and** Nango catalog (featured ~33; full catalog much larger). Parallel paths until Nango is sole path.

**Outbound create (Jira issues, calendar events):** Not built — connectors are ingest + OAuth today.

### 5.7 Agent / WebSocket

- `/ws`: chat (`text`), `COMMIT_DECISION`, session load  
- Coordinator tools: draft decision, transition execution, memory, web search, marketing/research delegates  
- os-ui Ask panel: **not** full WS agent (canned + summary context); full agent remains on legacy `/chat`

---

## 6. Default UI (`apps/os-ui`) — route maturity

### Live (API-backed with mock fallback when unauthenticated)

| Route | Behavior |
| --- | --- |
| `/` Home | Mission-control summary, live KPIs |
| `/decide` | Ledger decisions, commit, **execution readiness modal**, deep-link Execute |
| `/execute` | Ledger, capacity, clarifications; `?decision=` / `?clarify=` |
| `/alerts` | Notifications mark-read |
| `/login`, `/signup` | Auth |
| `/onboarding` | Me + settings bulk |
| `/brain`, `/brain/projects`, `/brain/projects/[slug]` | Summary + decision detail |
| `/brain/decisions`, `/brain/signals`, `/brain/people` | Live lists |
| `/settings/integrations` | Nango connect/sync |

### Partial / thin

| Route | Notes |
| --- | --- |
| `/brain/customers`, `/brain/meetings` | Entity/summary-backed; empty until data exists |
| `/brain` insights/activity | Still fixture-heavy in places |

### Mock / not wired

| Route | Notes |
| --- | --- |
| `/brain/documents` | Catalog empty / mock |
| `/brain/integrations` | Fixture cards (real connect is Settings → Integrations) |
| `/settings/*` except integrations | General, profile, security MFA, users, roles, spaces, audit, billing, AI, notification prefs |
| `/help` | Static/mock |
| Ask composer | Not full agent chat |

---

## 7. Legacy UI (`apps/web`)

Still owns:

- Marketing landing (source for Netlify export)  
- Full WS chat agent (`/chat`)  
- Mature OTP/TOTP/SSO UX  
- Approvals panel, capacity settings, teams roster Excel/PDF import  
- Older Mission Control / Execute / Signals dashboards  

Default product path is **os-ui**. Use `dev:web:legacy` when you need those surfaces.

---

## 8. Data model (SQLite) — groups

| Group | Tables (representative) |
| --- | --- |
| Identity | `users`, `user_sessions`, `api_access_tokens`, `api_keys`, OTP/TOTP, OAuth login |
| Ledger | `decision_ledger`, `execution_ledger`, `external_signals`, `audit_log`, `ledger_events`, `owner_reputation` |
| Work exception | `clarification_requests` |
| Org / teams | `team_roster`, `settings`, `organizations`, `workspaces` |
| Beliefs / outcomes | `beliefs`, `belief_evidence`, `decision_outcomes`, `learning_log` |
| State | `organization_state_versions`, `doctrine_rules`, `domain_state_patches` |
| Graph / entities | `entities`, `entity_edges`, `entity_embeddings` |
| Reconciliation | `claims`, `conflicts`, `entity_state_snapshots`, … |
| EIE | `execution_evidence`, `execution_features`, `entity_beliefs`, `execution_predictions` |
| Integrations | `oauth_connections`, `nango_connections`, `nango_sync_cursors`, webhook dedup |
| Security | `pending_action_approvals`, `capability_jti_log`, `agent_action_audit`, `security_events`, … |
| Marketing | `early_access_leads`, `marketing_contact_messages` |

---

## 9. Maturity matrix

| Capability | Status | Notes |
| --- | --- | --- |
| Decision draft → ACTIVE commit | **Production-shaped** | Gates + authority ledger + UI |
| Execution plan after approve | **Shipped (read-only)** | Aug 2026 |
| Task transitions + capacity | **Live** | |
| Clarification loop | **Live** (Execute UI) | Multi-turn tree still thin |
| Signal ingest + link/kill | **Live** | Auto-link policy-gated |
| NO-list conflict | **Live** | Throws on activate |
| Auditor cron + onWrite | **Live** | Collapse rule mutates status |
| Org state compile | **API live** | UI partial |
| Nango / OAuth connect | **Live** (Settings) | Dual OAuth paths |
| Full agent chat in os-ui | **Gap** | Legacy web has it |
| Outbound Jira / calendar create | **Not built** | Ingest only |
| Action policy engine (assign/schedule) | **Proto** | High-risk tools only |
| Decision health (At Risk / intervene) | **Thin** | Collapse tripwire only |
| Outcome learning → Brain recall | **Stub** | Tables exist; UX not |
| Settings / admin suite (os-ui) | **Mock** | |
| Postgres multi-tenant cutover | **Not ready** | |
| EIE as enforcement | **No** | Shadow/advisory |

---

## 10. What happens after Approve (current vs intended)

### Current (implemented)

1. Gates (tenant, optional causal/epistemic, NO-list)  
2. `decision_ledger.status = ACTIVE`  
3. Audit + auditor hook  
4. Promote beliefs from institutional hypotheses (if present)  
5. Notification `decision.committed`  
6. Authority `decision.commit` event  
7. **Execution plan** returned → Decide modal readiness → **Review Execution**

Tasks remain `PENDING`. No Jira/calendar side effects.

### Intended product layers (not yet built as orchestration)

1. Decision commitment — **done**  
2. Execution readiness — **done (read-only)**  
3. Reconcile existing work → authorize create/assign/schedule — **next**  
4. Execution activation — **exists as task transitions**  
5. Decision control / health — **thin**  
6. Intervention (audience-routed) — **partial (clarification)**  
7. Outcome + learning recall — **stub**

---

## 11. Security and trust posture

**Strengths**

- Unified mutation gateway for REST / WS / tools  
- RBAC + tenant scope on ledger reads/writes  
- Capability JTIs + dual-control for high-risk *agent* actions  
- Prompt injection / content-trust gates on chat input  
- Settings key allowlist  
- Signed authority ledger events  

**Risks / debt**

- Agent tools still commit through gateway directly (intent-queue backlog)  
- Auto-link can apply without a human when policy allows  
- First-party OAuth parallel to Nango  
- Session commit bypasses dual-control by design (solo founder UX)  
- Auditor can silently move ACTIVE → UNDER_REVIEW (>50% failure)  

---

## 12. Recommended build order (from current baseline)

1. **Reconcile existing work** in the plan (link Jira keys ↔ `execution_ledger`) — still no create  
2. **Action Policy Engine** for create ticket / assign / schedule / slip deadline  
3. **Outbound Jira create** only for plan items marked missing, under policy  
4. **Clarification multi-step** (blocker → who → ETA) + signal-driven unblock (not auto-DONE)  
5. **Audience-routed notifications** (founder vs owner vs blocker)  
6. **Decision health** (Healthy / At Risk / recommend review) without silent mutation as default  
7. **Outcome → Company Brain recall** for similar future decisions  
8. Wire os-ui Settings to live APIs; bring WS agent into Ask (or deep-link legacy chat)

---

## 13. How to run locally

```bash
# Root
npm run dev          # API :3005 + os-ui :3000

# Env
# Root .env — PORT, ALLOWED_ORIGINS=http://localhost:3000, LLM keys, MISSION_CONTROL_API_KEY
# apps/os-ui/.env.local — leave NEXT_PUBLIC_API_URL empty for same-origin /api; API_PROXY_TARGET=http://127.0.0.1:3005
```

Health: `GET http://127.0.0.1:3005/api/health`

---

## 14. One-sentence verdict

**Hustronix already behaves like a Decision OS at the ledger and auditor layer; the default UI is live on Decide / Execute / Home / core Brain; the next product leap is authorized orchestration around ACTIVE decisions (policy → project work → people → verify), not changing what Approve means.**

---

*Generated from repository inventory August 2026. Update this file when maturity matrix cells move.*
