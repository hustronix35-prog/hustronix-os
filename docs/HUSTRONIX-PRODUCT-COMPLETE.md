# Hustronix OS — Complete Product Reference

**Version:** 2.0 (codebase-aligned) · **Updated:** June 2026  
**Audience:** Founders, operators, engineers, security reviewers  
**Sources:** `PRD.md`, `docs/HUSTRONIX-COMPLETE-TECHNICAL-GUIDE.md`, runtime code in `apps/api` and `apps/web`

---

## Table of contents

1. [What Hustronix is](#1-what-hustronix-is)
2. [Core mental model](#2-core-mental-model)
3. [Who it is for](#3-who-it-is-for)
4. [Repository & runtime](#4-repository--runtime)
5. [The three layers](#5-the-three-layers)
6. [End-to-end data flow](#6-end-to-end-data-flow)
7. [Every product screen](#7-every-product-screen)
8. [User workflows (step by step)](#8-user-workflows-step-by-step)
9. [Decision & execution ledger](#9-decision--execution-ledger)
10. [Signals & intelligence pipeline](#10-signals--intelligence-pipeline)
11. [Organizational truth, memory & trust](#11-organizational-truth-memory--trust)
12. [AI agent system](#12-ai-agent-system)
13. [WebSocket protocol](#13-websocket-protocol)
14. [Complete API reference](#14-complete-api-reference)
15. [Authentication & RBAC](#15-authentication--rbac)
16. [Integrations](#16-integrations)
17. [Auditor engine (deterministic rules)](#17-auditor-engine-deterministic-rules)
18. [Security & trust architecture (V7–V9)](#18-security--trust-architecture-v7v9)
19. [Database schema](#19-database-schema)
20. [Notifications & background workers](#20-notifications--background-workers)
21. [Deployment & environment](#21-deployment--environment)
22. [Product maturity & known gaps](#22-product-maturity--known-gaps)
23. [Glossary](#23-glossary)

---

## 1. What Hustronix is

Hustronix is a **decision and execution operating system** for teams and solopreneurs who need to:

1. **Commit** to a small number of strategic decisions (the “vow”).
2. **Track execution** as weighted tasks under those decisions.
3. **Ingest signals** from Slack, GitHub, email, meetings, Jira, Linear, and more.
4. **Enforce rules automatically** — shadow work, capacity limits, NO-list violations, structural collapse.
5. **Talk to an AI coordinator** that reads the ledger and helps draft actions — without silently overriding enforcement.

**One-sentence definition:** Mission Control for organizational focus — the **database + auditor** are the source of truth; the **LLM is an interface**, not the authority.

### What Hustronix is NOT

- Not a generic chatbot replacement for Slack.
- Not a fully autonomous agent that commits decisions without human gates.
- Not multi-tenant enterprise SaaS at production scale today (SQLite runtime; org model evolving).
- Not a mobile-native app (responsive web + optional Telegram scaffolding in legacy PRD).

### Original PRD vision vs current implementation

| PRD vision | Current state |
|------------|---------------|
| Growth/Ops/Marketing agents with Apollo, ClickUp, LinkedIn | Sub-agents expose **`web_search` only**; coordinator has ledger tools |
| Telegram as primary input | **Web UI + WebSocket chat** is primary |
| Graph memory | **SQLite memory_records** + evidence graph + core memory projection |
| Local-first SaaS operator | **Local-first SQLite** + optional cloud deploy (Fly/Azure/Docker) |

---

## 2. Core mental model

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3 — INTERFACE                                        │
│  Next.js UI · WebSocket chat · AI Assistant drawer          │
│  Files: apps/web/, apps/api/src/agent.ts, assistant-agent.ts│
└───────────────────────────┬─────────────────────────────────┘
                            │ REST + WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│  LAYER 2 — ENFORCEMENT                                      │
│  Auditor · conflict gates · RBAC · approval gates           │
│  Files: auditor.ts, security/*                              │
└───────────────────────────┬─────────────────────────────────┘
                            │ reads/writes
┌───────────────────────────▼─────────────────────────────────┐
│  LAYER 1 — LEDGER (SQLite)                                  │
│  decisions · execution · external_signals · audit           │
│  File: apps/api/src/database.ts                             │
└─────────────────────────────────────────────────────────────┘
```

**Golden rule:** Ingestion **never silently creates execution work**. Linking is **explicit** (user action or high-confidence auto-linker with guardrails).

---

## 3. Who it is for

### Primary persona — Solo Entrepreneur Sam
- Juggles clients + growth; drowning in admin across disconnected tools.
- Wants one place to see **what the company decided** and **what is actually happening**.

### Secondary persona — Scaling Agency Sarah
- Needs **Mission Control** overview: decisions, capacity, signal triage, audit trail.
- Uses RBAC roles (strategist, operator, viewer) for team separation.

### Roles in the product (RBAC)

| Role | Typical user | Can do | Cannot do |
|------|--------------|--------|-----------|
| **owner** | Founder | Everything including security settings | — |
| **admin** | Ops lead | Same as owner (settings-based) | — |
| **strategist** | PM / strategy | Decisions, commit (with approval), chat agent, signals | Direct execution write via REST without permission |
| **operator** | IC / ops | Execution transitions, signal triage | Agent chat, decision write |
| **viewer** | Stakeholder | Read dashboards, memory read | Any mutation |
| **agent** | API token / automation | Read + signal write + agent invoke | Memory write, decision commit (unless granted) |

Defined in `apps/api/src/security/authorization.ts`.

---

## 4. Repository & runtime

### Monorepo layout

```
Hustronix OS/
├── apps/api/          Express + WebSocket + agents + SQLite
├── apps/web/          Next.js App Router UI
├── packages/shared/   Shared TypeScript types
├── infra/             Docker, Fly, Azure, Postgres schema (future)
├── ops/scripts/       QA, security tests, PDF export
├── docs/              Product & security documentation
├── data/              hustronix.db (gitignored)
├── PRD.md             Product requirements (local, gitignored)
└── netlify-landing/   Static marketing site (early access only)
```

### How to run

| Mode | Command | Ports |
|------|---------|-------|
| Dev (split) | `npm run dev` | API **3005**, Web **3000** |
| Dev (unified) | `npm run dev:unified` | **3000** |
| Production | `npm run build` → `npm run start:unified` | **PORT** (default 3000) |

### Boot sequence (`bootstrap.ts`)

1. Open SQLite, run schema migrations (V7/V8/V9 security tables).
2. Seed `system` user if missing.
3. Backfill FTS5 search mirrors from ledger.
4. Wire WebSocket → coordinator vs assistant routing.
5. Start **auditor cron** (every 5 minutes).
6. Start **integration workers** (OAuth refresh, polling, digests).
7. Optionally seed demo decision + sample signals (empty DB only).

---

## 5. The three layers

### Layer 1 — Ledger

**Tables:** `decision_ledger`, `execution_ledger`, `external_signals`, `audit_log`, `ledger_events`, `messages`, `memory_records`, …

All strategic truth flows through here. Decisions have statuses; tasks have owners and weights; signals have triage states.

### Layer 2 — Enforcement

**Auditor** (`auditor.ts`): deterministic rules on every ledger write + cron sweep.

**Security gates** (`security/*`): RBAC, dual-control approvals, capability tokens, prompt injection classifier, claim validation.

**Conflict gates:** Only one ACTIVE decision per tenant (configurable behavior via `findOtherActiveDecision`); causal validation before commit.

### Layer 3 — Interface

**Mission Control UI:** create, view, commit decisions; see capacity and signals.

**Chat coordinator:** LLM with tools (`log_strategic_decision`, `transition_execution`, `remember_fact`, delegates).

**Assistant drawer:** product help only (`get_current_time` tool); separate `asst:*` sessions.

---

## 6. End-to-end data flow

### Signal → execution loop

```
Slack / GitHub / Meeting / Manual ingest
        │
        ▼
external_signals (UNVERIFIED)
        │
        ▼
Intelligence pipeline (async):
  · Content trust / injection scan
  · Heuristic + optional LLM detection
  · Embedding + auto-link candidate
  · Decision-signal temporal resolution
  · Evidence graph + truth recompute (debounced)
        │
        ▼
Signals UI (/signals) — user triages
        │
        ├── LINK → external_signals (LINKED) → execution_ledger task
        ├── KILL → external_signals (KILLED)
        └── CREATE DECISION → decision_ledger (DRAFT)
        │
        ▼
Auditor: shadow work, capacity, NO-list, collapse
```

### Decision activation loop

```
DRAFT decision (REST, agent tool, or Signals UI)
        │
        ▼
User commits (Mission Control, REST, or WS COMMIT_DECISION)
        │
        ▼
Dual-control approval (V9) + causal validation
        │
        ▼
decision_ledger.status = ACTIVE
        │
        ▼
Truth engine elevates vow to high-confidence organizational belief
```

---

## 7. Every product screen

### Public / marketing

| URL | Component | Purpose |
|-----|-----------|---------|
| `/` | `LandingPage` | Marketing homepage |
| `/login` | Login | Password, OTP, Google/GitHub social login |
| `/signup`, `/register` | Signup | Account creation |
| `/contact` | Contact | Marketing contact form |
| `/privacy`, `/terms`, `/cookies` | Legal | Compliance pages |

### Authenticated dashboard (`(dashboard)/layout.tsx`)

Sidebar (`AppSidebar.tsx`), credential gate, onboarding gate, product tour.

| URL | Component | Primary APIs |
|-----|-----------|--------------|
| `/mission-control` | `MissionControlClient` | `GET /api/mission-control/summary`, `GET /api/decisions`, commit |
| `/execute` | `ExecuteClient` | `GET /api/execution/ledger`, `POST /api/execution/transition` |
| `/signals` | `SignalsClient` | `GET /api/execution/signals/by-state`, link, kill |
| `/chat` | `ChatClient` | WebSocket + `GET /api/chat/sidebar` |
| `/reports` | `ReportsClient` | `GET /api/metrics/reports`, operational reports |
| `/teams` | `TeamsClient` | Roster CRUD, team metrics |
| `/settings` | `SettingsClient` | Settings bulk, OAuth connections, security |
| `/profile` | `ProfileClient` | `/api/me`, API keys, sessions |
| `/guide` | `GuideClient` | In-app walkthrough |
| `/onboarding` | Onboarding wizard | `POST /api/settings/bulk` (org profile) |

### Global chrome

- **Header Assistant drawer** (`SystemAssistantDrawer`): product help; `asst:{uuid}` sessions; fast LLM tier.
- **Product tour** (`ProductTourProvider`): spotlight onboarding.
- **OAuth redirect** `/oauth/[provider]` → `/api/oauth/{provider}/start`.

---

## 8. User workflows (step by step)

### 8.1 First-time setup

1. Register at `/signup` → session cookie `hustronix_session`.
2. Complete `/onboarding` → org name, ICP, north star → `POST /api/settings/bulk`.
3. Open `/settings` → **Connections** → connect Slack, GitHub, Google, etc. via OAuth popups.
4. Optional: enable TOTP 2FA under Security (`security:manage`).

### 8.2 Mission Control — create and commit a decision

1. Open `/mission-control` → loads summary (active decision, execution preview, signals preview, capacity).
2. **Create DRAFT:** enter vow + optional tasks → `POST /api/decisions` (requires `decision:write`).
3. Review in Decisions panel → `GET /api/decisions?status=DRAFT`.
4. **Commit to ACTIVE:**
   - UI button or `POST /api/decisions/commit` with `decisionId`, `justification`, and **`approvalId`** (dual-control).
   - Or WebSocket `{ type: "COMMIT_DECISION", decisionId, approvalId, ... }`.
5. Backend runs causal validation on institutional reasoning; blocks if another ACTIVE decision conflicts.
6. Auditor re-evaluates decision + owner capacity.
7. WebSocket broadcasts `DECISION_COMMITTED` to tenant.

### 8.3 Execute — manage tasks

1. Open `/execute` → `GET /api/execution/ledger?scope=all`.
2. Filter tabs: ACTIVE, BLOCKED, PENDING, COMPLETED.
3. Transition task: `POST /api/execution/transition` with `taskId`, `newState`, `reason` (`execution:write`).
   - **Note:** REST path does not require the same dual-control approval as agent tool `transition_execution` (policy asymmetry — see §22).
4. View owner load: `GET /api/execution/capacity?owner=`.

### 8.4 Signals — triage external world

1. Open `/signals` → `GET /api/execution/signals/by-state` (UNVERIFIED / LINKED / KILLED counts).
2. **UNVERIFIED signals** show grace countdown (`GraceCountdownRing`) — auditor may enforce if grace expires.
3. **Link to task:** `POST /api/execution/link` with `signalId` + `taskId`.
4. **Kill noise:** `POST /api/execution/signals/kill`.
5. **Promote to decision:** `POST /api/decisions` pre-filled from signal context.

### 8.5 Chat — talk to the coordinator

1. Open `/chat` → WebSocket connect (session cookie auth).
2. Receive `{ type: "sessions" }` with recent session IDs.
3. Send `{ type: "text", text, sessionId, planMode? }`.
4. Coordinator streams `{ type: "text_chunk" }` then tool calls if needed.
5. Sidebar loads parallel context: `GET /api/chat/sidebar` (decisions, signals, capacity, memory lines).
6. **Plan mode:** `planMode: true` → coordinator asks clarifying questions before mutating tools.

**Tools the coordinator may invoke (each gated):**

| Tool | Effect |
|------|--------|
| `log_strategic_decision` | Create DRAFT decision + tasks |
| `transition_execution` | Change task state (dual-control + capability) |
| `remember_fact` | Store verified memory fact |
| `recall_memory` | Search archived chat messages |
| `delegate_to_marketing` / `delegate_to_research` | Sub-agent with web search only |
| `ping` | Diagnostic |

### 8.6 Assistant drawer — product help

1. Click **Assistant** in header on any dashboard page.
2. Creates `asst:{uuid}` session (never mixes with main chat history).
3. **Only tool:** `get_current_time` — no ledger mutation (by design post-V9).
4. User input scanned by `gateUserChatInput` before LLM.

### 8.7 Settings & integrations

1. **General / Notifications:** `GET/POST /api/settings/bulk` (allowlisted keys only — `security/settings-keys.ts` blocks privilege escalation via settings).
2. **Connections:** OAuth for Slack, GitHub, Google (Calendar+Gmail), Microsoft (Teams+Outlook), Notion, Jira, Linear.
3. **Health:** `GET /api/integrations/health` — token expiry, webhook status.
4. **Security tab:** sessions, API keys (`hx_live_…`), audit log export.
5. **Dual-control approvals:** admin approves pending actions via `POST /api/security/approvals/:id/approve` (twice, different principals).

### 8.8 Reports & teams

- **Reports:** weekly drift, operational health → `GET /api/reports/weekly`, `/api/reports/health`.
- **Teams:** roster import/export → `/api/metrics/teams/roster*`.

---

## 9. Decision & execution ledger

### Decision lifecycle

| Status | Meaning |
|--------|---------|
| **DRAFT** | Proposed vow; not yet enforcing |
| **UNDER_REVIEW** | Auditor or conflict detection flagged review |
| **ACTIVE** | Committed strategic commitment — enforces focus |
| **COMPLETED** | Successfully concluded |
| **REVERSED** | Explicitly revoked |

V7+ also tracks `lifecycle_state`: PROPOSED, UNDER_REVIEW, ACTIVE, SUPERSEDED, REVOKED, COMPLETED, ARCHIVED.

**Decision record includes:**
- `vow` — the commitment statement
- `expected_outcomes` — JSON metrics/targets
- `constraints` — NO-list (auditor enforces)
- `reversal_conditions` — when to unwind
- `institutional_reasoning` / `decision_reasoning` — causal memo (validated on commit)
- `fingerprint` — integrity hash

### Execution task model

Tasks live in `execution_ledger`, linked to `decision_id`.

| Field | Purpose |
|-------|---------|
| `type` | ACTION, KILL, VERIFY, BLOCK, … |
| `status` | PENDING, ACTIVE, DONE, KILLED, BLOCKED, … |
| `owner` | Responsible party (capacity scoped) |
| `weight` | Load units (capacity math) |
| `success_condition` | Checked against NO-list |
| `dependencies` | Task graph edges |

### Signal triage states

| State | Meaning |
|-------|---------|
| **UNVERIFIED** | Just ingested; grace timer may apply |
| **GRACE** | Countdown before shadow-work enforcement |
| **LINKED** | Connected to an execution task |
| **KILLED** | Dismissed as noise |

---

## 10. Signals & intelligence pipeline

**Orchestrator:** `apps/api/src/intelligence/index.ts` → `processSignal()`.

### Per-signal stages

1. **Dedup** — `external_event_dedup`, Slack event receipts.
2. **Insert** — `external_signals` row (UNVERIFIED).
3. **Auditor hook** — `onWrite({ type: "signal" })` → shadow work check + async intelligence.
4. **Content trust** — `runContentTrustPipeline()`; MALICIOUS/SUSPICIOUS blocked from LLM/memory.
5. **Context fetch** — active decision + executions + recent signals.
6. **Detection** — heuristic first; LLM `detectSignal()` if warranted (cost saver gates).
7. **Enrichment** — urgency, op_classification, risk, intent persisted.
8. **Temporal resolution** — `resolveTemporalDecisionSignal()` supersedes conflicting decision_signals.
9. **Embedding** — optional vector for hybrid search.
10. **Auto-link** — `autoLinker.ts` (FTS + cosine fusion); applies only above threshold.
11. **Evidence graph** — `indexSignalAsEvidence()`.
12. **Truth recompute** — `scheduleOrganizationalTruthRecompute()` (debounced 750ms).

### Manual & meeting ingest

- `POST /api/ingest/manual` — paste text as signal (`signal:write`).
- `POST /api/ingest/meeting` — transcript → chunked signals (`meetingIngestion.ts`).

### Search & operational queries

- `GET /api/intelligence/search` — hybrid FTS5 + embeddings.
- `GET /api/operational/drift|overloaded|conflicts|related|search` — graph queries.

---

## 11. Organizational truth, memory & trust

### Organizational truth (V2)

**Module:** `security/organizational-truth.ts`

Computes what the organization **currently believes** from:
- ACTIVE decision signals (Slack, etc.)
- ACTIVE decisions (human-committed vows — **highest weight**)
- Superseded signals (historical)

**APIs:**
- `GET /api/truth/current` — computes + returns snapshot (also persists).
- `GET /api/truth/snapshots` — reads stored ACTIVE truths.

**Important:** Truth is **heuristic**, not adjudicated fact. Committed decisions dominate per topic key.

### Memory facts

**Write path:** coordinator tool `remember_fact` → `storeMemoryFact()`:

1. LLM output firewall on fact text.
2. Content trust pipeline.
3. **Claim validation** — weighted evidence; blocks low-trust-only sources (e.g. repeated Slack).
4. **VERIFIED** only with human decision support or dual-control approval.
5. Provenance events in `memory_provenance_events`.

**Read path:** `recall_memory` tool (archival message search); `GET /api/memory/facts/:id/explain` (provenance chain).

### Trust metrics

`GET /api/trust/metrics` — composite score from:
- Security (denied agent actions, malicious signals, memory conflicts)
- Reliability (open conflicts, contradiction count)
- Provenance (evidence diversity)

---

## 12. AI agent system

### Coordinator (`agent.ts` — `runAgent()`)

- **LLM tier:** premium (Claude Sonnet class by default).
- **History:** last N messages from `messages` table per session.
- **System prompt:** core memory + supervisor prompt + institutional guide.
- **Input gate:** `gateUserChatInput()` — blocks MALICIOUS/SUSPICIOUS chat.
- **Tool gate:** `secureAuthorizeToolExecution()` — RBAC + dual-control + capability JTI + audit.
- **Max iterations / timeout:** configurable via `config.agent.*`.

### Assistant (`assistant-agent.ts`)

- **Sessions:** `asst:*` prefix (`assistant-guide.ts`).
- **LLM tier:** fast (Haiku class).
- **Tools:** `get_current_time` only.
- **Purpose:** product navigation help — explicitly **does not** mutate ledger.

### Sub-agents (`runSubAgent()`)

- Marketing / Research delegates.
- **Read-only:** `web_search` only (`SUB_AGENT_ALLOWED_TOOLS`).
- Fast tier, max 5 tool iterations.

### LLM provider routing (`llm.ts`, `config.ts`)

- Default: Anthropic (`ACTIVE_PROVIDER=anthropic`).
- Also supports OpenAI path.
- Per-user API keys via settings (legacy `api_keys` table).
- Cost-saver mode reduces caps (`LLM_COST_SAVER`).

---

## 13. WebSocket protocol

**Endpoint:** same host as API (port 3005 dev, 3000 unified).  
**Auth:** `hustronix_session` cookie; dev: `?session=` or loopback `?userId=` if enabled.

### Client → server

| `type` | Permission | Payload |
|--------|------------|---------|
| `text` | `agent:invoke` | `text`, `sessionId`, `planMode?` |
| `load_session` | none | `sessionId` |
| `new_session` | none | `channel?: "assistant" \| "chat"` |
| `COMMIT_DECISION` | `decision:commit` | `decisionId`, `justification`, `approvalId?` |
| `SYNC_PROTOCOLS` | `agent:invoke` | — |
| `CAPABILITY_OVERRIDE` | `security:manage` | `id`, `status`, `reason` |

### Server → client

`sessions`, `history`, `text_chunk`, `typing`, `error`, `session_created`, `auth_error`, `DECISION_COMMITTED`, `DECISION_COMMIT_FAILED`, `CAPABILITY_UPDATE`, `SIGNAL_ALERT`.

**No WebSocket rate limit** today — only HTTP `globalApiLimiter`.

---

## 14. Complete API reference

Primary file: `apps/api/src/server.ts`. Legend: 🔓 public · 🔐 auth required · 🛡 permission required.

### Health & marketing 🔓

| Method | Path |
|--------|------|
| GET | `/api/health` |
| POST | `/api/early-access` |
| POST | `/api/contact` |

### Webhooks 🔓 (signature-verified)

| Method | Path |
|--------|------|
| POST | `/api/integrations/slack/events` |
| POST | `/api/ingest/github`, `/api/ingest/github/:tenant` |
| POST | `/api/ingest/linear/:tenant` |
| POST | `/api/ingest/jira`, `/api/ingest/jira/:tenant` |
| POST | `/api/ingest/crm/:vendor`, `.../:tenant` |
| POST | Google / Microsoft webhook routes |

### Authentication

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/auth/providers` | 🔓 |
| POST | `/api/auth/otp/request`, `/register`, `/login`, `/login/totp` | 🔓 rate limited |
| GET/POST | `/api/auth/totp/*` | 🔐 🛡 `security:manage` for setup |
| POST | `/api/auth/logout` | 🔐 |
| GET | `/api/auth/google/*`, `/api/auth/github/*` | Social **login** |
| POST | `/api/auth/password` | 🛡 |
| CRUD | `/api/auth/api-keys`, `/api/auth/sessions` | 🛡 |

### Integration OAuth 🔐

| Method | Path |
|--------|------|
| GET/DELETE | `/api/oauth/:provider/*` |
| GET | `/api/oauth/connections`, `/api/oauth/slack/*` |
| GET/POST | `/api/integrations/github/*`, `/api/integrations/google/*`, `/api/integrations/microsoft/*` |
| GET | `/api/integrations/health` |
| GET/POST | `/api/connections`, `/api/connections/sync` |

### Decisions & execution 🔐

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/mission-control/summary` | read |
| GET/POST | `/api/decisions` | write for POST |
| POST | `/api/decisions/commit` | 🛡 `decision:commit` + dual-control |
| GET | `/api/execution/ledger`, `/capacity`, `/signals*` | read |
| POST | `/api/execution/transition` | 🛡 `execution:write` |
| POST | `/api/execution/link` | 🛡 `execution:write` |
| POST | `/api/execution/signals/kill` | 🛡 `signal:write` |
| POST | `/api/audit/run` | 🛡 `audit:run` |

### Intelligence 🔐

| Method | Path |
|--------|------|
| GET | `/api/intelligence/context`, `/search` |
| POST | `/api/intelligence/relink`, `/warm-embeddings` |
| POST | `/api/ingest/manual`, `/ingest/meeting` |
| GET | `/api/operational/*`, `/api/reports/*` |

### Trust, security, memory 🔐

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/trust/metrics` | `decision:read` |
| GET | `/api/truth/current`, `/truth/snapshots` | `decision:read` |
| GET | `/api/security/dashboard` | `audit:run` |
| GET | `/api/memory/facts/:id/explain` | `memory:read` |
| POST | `/api/security/approvals/:id/approve` | `security:manage` |

### User, settings, metrics, notifications 🔐

| Method | Path |
|--------|------|
| GET/PATCH | `/api/me` |
| GET/POST | `/api/settings`, `/api/settings/bulk`, `/api/settings/capacity-summary` |
| GET/POST | `/api/billing` |
| GET | `/api/metrics/reports`, `/api/metrics/teams`, roster CRUD |
| GET | `/api/chat/sidebar` |
| GET/POST | `/api/notifications*` |
| GET | `/api/audit-log`, `/api/learning-log`, `/api/productivity`, `/api/system/value-telemetry` |

---

## 15. Authentication & RBAC

### Session model

- Opaque session token in **`hustronix_session`** HttpOnly cookie.
- Stored hashed in `user_sessions` with expiry and revoke support.
- API automation: **`hx_live_…`** bearer tokens.

### Auth resolution order (`middleware/auth.ts`)

1. Bearer `hx_live_*` → API token principal (`agent` role).
2. Session cookie → user principal + tenant context.
3. Legacy `hustronix_uid` cookie (dev only if enabled).
4. `x-api-key` + `x-user-id` automation header.
5. Loopback `?userId=` (dev only if `ALLOW_LOOPBACK_AUTH=1`).

### Tenant context (V8+)

On every authenticated request:
- `orgId` — organization (`org_{userId}` default for solo tenants)
- `workspaceId` — default workspace
- `tenantRole` — from `workspace_members` or settings fallback

**Runtime note:** Most ledger rows still key on `user_id`; org scoping uses IN-clause back-compat (`tenant-scope.ts`).

### Dual-control approvals (V9)

High-risk actions require:
1. Actor triggers action → pending approval UUID returned in error.
2. **Approver A** → `POST /api/security/approvals/:id/approve`.
3. **Approver B** (different principal) → same endpoint.
4. Actor retries with `approvalId`.

**High-risk actions:** `remember_fact`, `log_strategic_decision`, `transition_execution`, `commit_decision`, `bulk_update`.

**Emergency override:** owner + detailed reason + one independent approval → CRITICAL audit event.

---

## 16. Integrations

### OAuth providers (`auth/oauthProviders.ts`)

| Provider | Surfaces | Ingest mechanism |
|----------|----------|------------------|
| **Slack** | Events API, bot | `slackEvents.ts` → HMAC verified |
| **GitHub** | Repo webhooks | HMAC + tenant in URL |
| **Google** | Calendar, Gmail | Push notifications + poll |
| **Microsoft** | Teams, Outlook | Graph subscriptions |
| **Notion** | Pages | 5-minute poll worker |
| **Jira** | Issues | Webhooks + renewal |
| **Linear** | Issues | Webhook ingest |

### Background workers (on boot)

- OAuth token refresh.
- Microsoft/Jira subscription renewal.
- Google calendar watch renewal + Gmail poll.
- Notion poll.
- Notification digest scheduler.
- Unenriched signal drift sweep (cron, heuristic-only).

### Demo/mock layer

`connections_manager.ts` — in-memory “business capabilities” for UI demos; WS `SYNC_PROTOCOLS` / `CAPABILITY_OVERRIDE`.

---

## 17. Auditor engine (deterministic rules)

**File:** `apps/api/src/auditor.ts`

Runs on **every ledger write** (`onWrite`) + **full sweep** every 5 minutes + manual `POST /api/audit/run`.

### Rules

1. **Shadow work** — UNVERIFIED/GRACE signals past source-specific grace (e.g. Slack 2h) → enforcement action.
2. **Capacity** — owner ACTIVE task weights vs published capacity → block/warn.
3. **NO-list violations** — signal content matches decision `constraints` → task BLOCKED.
4. **Structural collapse** — >50% of decision tasks KILLED/BLOCKED → decision UNDER_REVIEW.

### Event-driven scopes

| Write type | Auditor action |
|------------|----------------|
| `signal` | Shadow work + async intelligence pipeline |
| `decision` | Decision health + owner capacity |
| `execution` | Owner capacity + decision health |
| `signal_link` | Shadow work + linked task/decision |

**No LLM in auditor** — purely deterministic.

---

## 18. Security & trust architecture (V7–V9)

### V7 — Baseline security

- Tool RBAC registry (`tool-permissions.ts`).
- WebSocket action authorization (`action-authorization.ts`).
- Agent tool gate (`agent-tool-gate.ts`).
- Prompt injection classifier (`prompt-injection.ts`).
- Memory store + conflict detection.
- Decision lifecycle / supersession.
- Capability tokens + agent audit log.
- Evidence graph + trust metrics API.

### V8 — Enterprise scaffolding

- `organizations`, `workspaces`, `workspace_members`.
- `memory_evidence`, `organizational_truth_snapshots`.
- `pending_action_approvals`, `security_events_v8`, `ai_claim_validations`.

### V9 — Trust program

- **SecurityGateway** (`security-gateway.ts`) — `executeSecuredTool`, `gateUserChatInput`.
- **Dual-control** approvals — all roles including owner.
- **Capability JTI replay prevention** — `capability_jti_log`.
- **Weighted claim validation** — anti–Slack-spam poisoning.
- **Memory provenance chain** — `memory_provenance_events`.
- **LLM output firewall** — authority/financial claim blocking on memory writes.
- **SUSPICIOUS content blocked** from LLM reasoning (not just MALICIOUS).

### HTTP edge security

- CORS, CSRF origin guard, security headers, HTTPS enforcement (prod).
- Rate limits on auth, AI, and mutation routes (`middleware/rateLimit.ts`).
- Hash-chained `ledger_events` for tamper evidence.

---

## 19. Database schema

**Engine:** SQLite (`better-sqlite3`) at `SQLITE_PATH` (default `./data/hustronix.db`).  
**Future:** `infra/db/postgres/` with RLS — **not runtime yet**.

### Core tables

| Table | Purpose |
|-------|---------|
| `decision_ledger` | Strategic vows and metadata |
| `execution_ledger` | Tasks under decisions |
| `external_signals` | Ingested world events |
| `messages` | Chat history by session |
| `memory_records` | Long-term facts |
| `audit_log` | Auditor + system actions |
| `ledger_events` | Hash-chained authority log |

### Auth & OAuth

`users`, `user_sessions`, `api_access_tokens`, `oauth_connections`, `oauth_subscriptions`, `oauth_identities`, …

### Intelligence

`entity_embeddings`, FTS5 mirror tables, `meeting_ingestions`, `external_event_dedup`.

### Security V7–V9

`evidence_nodes`, `evidence_edges`, `memory_evidence`, `memory_provenance_events`, `agent_action_audit`, `pending_action_approvals`, `emergency_overrides`, `capability_jti_log`, `organizational_truth_snapshots`, `ai_claim_validations`, `security_events_v8`.

---

## 20. Notifications & background workers

- **In-app:** `notifications` table; unread badge via `/api/notifications/unread-count`.
- **Email:** SMTP via `auth/smtp.ts` (OTP, digests).
- **Slack DM/channel:** when OAuth connected.
- **Digest scheduler:** batched undelivered notifications.

Event kinds include `decision.committed`, signal alerts, auditor blocks.

---

## 21. Deployment & environment

### Key environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3005 / 3000 unified) |
| `SQLITE_PATH` | Database file path |
| `ANTHROPIC_API_KEY` | LLM provider |
| `MISSION_CONTROL_API_KEY` | Automation header auth |
| `LEDGER_SIGNING_KEY` | Capability token signing (prod) |
| `SLACK_CLIENT_ID/SECRET`, `SLACK_SIGNING_SECRET` | Slack OAuth + events |
| `ALLOWED_ORIGINS` | CORS |
| `APP_ORIGIN` | OAuth redirect base |
| `ALLOW_LOOPBACK_AUTH` | Dev impersonation (**off in prod**) |
| `LLM_COST_SAVER` | Reduce LLM spend caps |

See `.env.example` for full list.

### Deployment targets

| Target | Path |
|--------|------|
| Docker | `infra/docker/Dockerfile`, `docker-compose.yml` |
| Fly.io | `infra/fly/` |
| Azure | `infra/azure/` |
| Netlify landing | `netlify-landing/` (marketing only) |

### Export this document as PDF

```bash
npm run report:pdf -- docs/HUSTRONIX-PRODUCT-COMPLETE.md
```

---

## 22. Product maturity & known gaps

### Production-ready strengths

- Clear three-layer architecture (ledger → auditor → interface).
- Real RBAC + session auth + OAuth integrations.
- Deterministic enforcement separate from LLM.
- V9 security gateway on agent paths; dual-control on high-risk tools.
- Hybrid search, signal pipeline, Mission Control UX.

### Known gaps (honest)

| Area | Gap |
|------|-----|
| **Tenancy** | Ledger uses `user_id`; multi-member org sharing incomplete |
| **Database** | SQLite single-node; Postgres RLS not active |
| **Policy parity** | REST `execution/transition` lacks agent-path dual-control |
| **Approval replay** | Approved IDs reusable until expiry (not single-use) |
| **Sub-agents** | Web search only — PRD external integrations not wired |
| **Assistant** | Help only — no operational tools by design |
| **Scale** | No load test proof; truth-on-read can be expensive |
| **MCP** | `mcp.ts` exists but ungated if enabled |
| **Billing** | Stub endpoints |
| **Profile password UI** | Partial mock; backend exists |

### Recommended reading order

1. This document — full product picture.
2. `docs/HUSTRONIX-COMPLETE-TECHNICAL-GUIDE.md` — engineering deep dive.
3. `docs/v9-trust-program-rollout.md` — security posture.
4. `PRD.md` — original vision and personas.

---

## 23. Glossary

| Term | Definition |
|------|------------|
| **Vow** | The decision commitment statement stored in `decision_ledger.vow` |
| **Signal** | External observation (Slack message, PR, meeting note) in `external_signals` |
| **Shadow work** | Execution not linked to an ACTIVE decision — auditor enforces after grace |
| **Grace period** | Time UNVERIFIED signals can exist before enforcement |
| **Coordinator** | Main AI agent in `/chat` with ledger tools |
| **Assistant** | Header drawer help agent; `asst:*` sessions |
| **Dual-control** | Two independent approvers for high-risk mutations |
| **Organizational truth** | Computed belief state from signals + ACTIVE decisions |
| **Memory fact** | Validated long-term claim with provenance |
| **FTS5** | SQLite full-text search mirror for hybrid retrieval |
| **Capability token** | Short-lived HMAC token authorizing one high-risk tool invocation |
| **System principal** | Automation user for cron/scripts — not a human |

---

*This document reflects the codebase as of V9 trust program. For security certification status, see adversarial audit findings — do not treat this guide as a security guarantee.*
