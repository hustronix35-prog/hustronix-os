# Hustronix OS — Security Assessment Report

**Assessment date:** June 27, 2026  
**Scope:** Security architecture docs (V7–V9), `apps/api/src/security/*`, middleware, Phase 0 mutation/link-policy work, automated red-team suite  
**Runtime:** Node/Express API (port 3005), SQLite primary store, Next.js UI (port 3000)  
**Automated tests:** `npm run test:security` — **24 passed / 0 failed** (14 suites, ~998 ms)

---

## 1. Executive Summary

Hustronix OS has undergone a structured security remediation program (V7 → V9) that moved the product from a demo-grade agent surface to a **defense-in-depth model** with RBAC, unified mutation boundaries, prompt-injection controls, dual-control approvals, capability-token replay prevention, and tenant-scoped ledger access. The system’s design principle is correct for an operational decision OS: **the ledger and auditor are authoritative; the LLM assists but does not mint authority.**

### Current posture (documented scores, clean tenant)

| Metric | Pre-V7 | Post-V9 (documented) | Notes |
|--------|--------|----------------------|-------|
| **Security** | 42 | **88** | Bypass paths closed; dual-control; replay prevention |
| **Trust** | 35 | **86** | Anti-poisoning, provenance, weighted truth |
| **Reliability** | 38 | **82** | Debounced truth recompute; SQLite scale ceiling |
| **Enterprise readiness** | — | **78** | Postgres/RLS, load proof, external pen test remain |

Scores degrade with open memory conflicts, malicious signals, and denied agent actions (`GET /api/trust/metrics`).

### Bottom line for a CISO

**Suitable for controlled pilot / single-tenant deployments** with explicit role assignment and dual-control workflow training. **Not yet enterprise-grade** for regulated or multi-tenant SaaS at scale until PostgreSQL + RLS cutover, full `user_id` → `org_id` migration, load/soak validation, and external penetration testing are complete.

---

## 2. Threat Model

### Primary assets

- Decision ledger, execution ledger, external signals
- Organization memory (`memory_records`, provenance chain)
- Sessions, API keys (`hx_live_…`), OAuth/Slack tokens
- LLM prompts/context, audit and security event streams

### Likely adversaries

| Actor | Motivation |
|-------|------------|
| Credential stuffers | Account takeover |
| Malicious insiders | Privilege abuse, SoD bypass |
| Compromised API keys / agents | Automated ledger mutation |
| Webhook spoofers | Signal injection, noise, replay |
| Cross-tenant users | Data exfiltration via IDOR |
| Prompt-injection via Slack/meetings/chat | Context poisoning, tool abuse |
| Denial-of-wallet actors | LLM cost exhaustion |

### Trust-boundary invariants (enforced in design)

1. Untrusted input enters only via public API or verified integrations.
2. **LLM output is never authorization** — no policy, identity, or ledger truth from model text alone.
3. Agents receive scoped capabilities, not broad human roles.
4. Ledger mutation requires deterministic policy + tenant checks.
5. Irreversible transitions should have causal parent, signer, policy version, and tamper-evident hash (partially implemented via `ledger_events` append path).

Sources: [`docs/security-architecture.md`](security-architecture.md), [`docs/architecture-enforcement.md`](architecture-enforcement.md)

---

## 3. Security Architecture

### Layer model

```text
[Edge: TLS, WAF, proxy]
 → [HTTP middleware: request ID, HTTPS, CSP, CORS, rate limits, CSRF]
 → [Auth: session / Bearer hx_live_ / automation headers]
 → [RBAC: requirePermission on mutations]
 → [Tenant scope: orgId + legacy userId IN-clause]
 → [UnifiedSecurityBoundary: approval + capability + audit]
 → [SQLite ledger + auditor (deterministic)]
 → [LLM (untrusted reasoning, gated tools)]
```

### Key modules

| Layer | Implementation |
|-------|----------------|
| **Unified boundary** | `apps/api/src/security/security-gateway.ts` — `executeSecuredTool`, `gateUserChatInput`, `authorizeSecuredMutation`, `authorizeAndExecuteMutation` |
| **RBAC** | `apps/api/src/security/authorization.ts` — roles: owner, admin, strategist, operator, viewer, agent |
| **Tool gate** | `agent-tool-gate.ts` + `tool-permissions.ts` — default DENY registry |
| **Dual-control** | `approval-gate.ts` — two independent approvers, emergency override |
| **Tenant isolation** | `tenant-context.ts`, `tenant-scope.ts` — org provisioning + IN-clause back-compat |
| **Content trust** | `content-trust-pipeline.ts` → `prompt-injection.ts` |
| **Claim integrity** | `claim-validation.ts`, `memory-provenance.ts`, `llm-output-firewall.ts` |
| **Observability** | `security-observability.ts` (V8 events), `audit.ts` (V7 auth events), `agent-audit.ts` |
| **Mutation handlers (Phase 0)** | `mutation-handlers.ts` — centralized REST mutation logic with tenant checks |
| **Link policy (Phase 0)** | `intelligence/link-policy.ts` — deterministic vs adaptive auto-link tiers |

### Middleware pipeline (`apps/api/src/server.ts`)

Order: `trust proxy` → request context → HTTPS → security headers → CORS → `globalApiLimiter` → `cookieParser` → **raw Slack webhook before JSON** → JSON parsers → CSRF → auth on protected routes → permission checks → route limiters.

---

## 4. Implemented Controls

| Control | Status | File / Route |
|---------|--------|--------------|
| Session cookie auth (`hustronix_session`) | ✅ | `middleware/auth.ts`; all protected REST/WS |
| API token auth (`Bearer hx_live_…`) | ✅ | `middleware/auth.ts` |
| Automation auth (`x-api-key` + `x-user-id`) | ✅ Dev/prod with `MISSION_CONTROL_API_KEY` |
| Loopback bypass | ⚠️ Dev only | `ALLOW_LOOPBACK_AUTH`, `ALLOW_LEGACY_UID_COOKIE`, `ALLOW_WS_SESSION_QUERY` — **must be unset in prod** |
| RBAC permission map | ✅ | `authorization.ts`; `requirePermission()` on mutations |
| Tool permission registry (default deny) | ✅ | `tool-permissions.ts` |
| WS action authorization | ✅ | `action-authorization.ts`; `server.ts` WS handler |
| CSRF origin guard (cookie writes) | ✅ | `csrf.ts` |
| Security headers + CSP + HSTS | ✅ | `httpSecurity.ts` |
| CORS exact allowlist | ✅ | `cors.ts`; `ALLOWED_ORIGINS` |
| Global API rate limit (600/min/IP) | ✅ | `rateLimit.ts` → `globalApiLimiter` |
| Auth rate limit (30/15min/IP) | ✅ | `authRouteLimiter` on login/register/OTP |
| Mutation rate limit (120/min/principal) | ✅ | `mutationRouteLimiter` |
| AI route rate limit (30/min/principal) | ✅ | `aiRouteLimiter` |
| WS rate limits | ✅ | `ws-rate-limit.ts`; `WS_TEXT_RATE_LIMIT` (40), `WS_COMMIT_RATE_LIMIT` (12) |
| Redis-backed rate limits | ⚠️ Optional | `REDIS_URL` → `rate-limit-redis`; falls back to in-memory |
| Slack HMAC + replay window | ✅ | `integrations/slackEvents.ts`; `SLACK_SIGNING_SECRET` |
| GitHub webhook HMAC | ✅ | `POST /api/ingest/github`; `GITHUB_WEBHOOK_SECRET` |
| Prompt injection classifier | ✅ | `prompt-injection.ts` |
| Content trust pipeline (block non-SAFE) | ✅ | `content-trust-pipeline.ts`; intelligence ingest |
| User chat input gate | ✅ | `gateUserChatInput` in `agent.ts`, `assistant-agent.ts` |
| Claim validation (anti-gaming) | ✅ | `claim-validation.ts` |
| LLM output firewall | ✅ | `llm-output-firewall.ts` |
| Dual-control approvals | ✅ | `approval-gate.ts`; `POST /api/security/approvals/:id/approve` ×2 |
| Capability tokens + JTI consume | ✅ | `capability-tokens.ts`; `capability_jti_log` table |
| Unified mutation boundary (REST) | ✅ Partial | `authorizeAndExecuteMutation` on decisions, execution transition |
| Tenant ledger access checks | ✅ | `tenant-scope.ts`; `mutation-handlers.ts` |
| Decision ACTIVE conflict gate | ✅ | `database.ts` → `transitionDecisionState` |
| Signal temporal supersession | ✅ | `decision-lifecycle.ts` |
| Memory conflicts + provenance | ✅ | `memory-store.ts`, `memory-provenance.ts` |
| Evidence graph | ✅ | `evidence-graph.ts` |
| Organizational truth (debounced) | ✅ | `organizational-truth.ts` |
| Trust metrics API | ✅ | `GET /api/trust/metrics` |
| Security dashboard API | ✅ | `GET /api/security/dashboard` |
| Agent action audit | ✅ | `agent_action_audit` via `agent-audit.ts` |
| Security events V7 (auth) | ✅ | `security/audit.ts` → `security_events` |
| Security events V8 (policy) | ✅ | `security_events_v8` via `security-observability.ts` |
| Hash-chained authority ledger events | ✅ Partial | `appendAuthorityLedgerEvent` in `server.ts` |
| PostgreSQL + RLS | ❌ Schema only | `infra/db/postgres/001_initial_schema.sql`; runtime SQLite |
| MCP tool gateway | ⚠️ Gated but unused | `mcp-gateway.ts`; prod blocked unless `MCP_ALLOW_PRODUCTION=1` |
| Assistant agent isolation | ✅ | `assistant-agent.ts` — `get_current_time` only |
| Adaptive auto-link policy | ✅ | `link-policy.ts`; `AUTO_LINK_POLICY=adaptive` |
| Production env validation | ✅ | `config.ts` — fails on weak `MISSION_CONTROL_API_KEY`, wildcard CORS |
| TOTP / bcrypt passwords | ✅ | Auth routes; `TOTP_ENCRYPTION_KEY` for 2FA at rest |
| bcrypt → upgrade path | ✅ | Legacy SHA-256 one-time upgrade on login (per stack rules) |

---

## 5. Dual-Control & High-Risk Actions

### High-risk action set (`approval-gate.ts`)

`log_strategic_decision`, `remember_fact`, `transition_execution`, `commit_decision`, `bulk_update`

**V9 policy:** All roles require approval — **no owner/admin bypass** for normal path.

### Workflow

1. Actor attempts high-risk action → `enforceHighRiskApproval` creates `pending_action_approvals` row (10-minute TTL).
2. **Approver A** (`POST /api/security/approvals/:id/approve`) — must ≠ actor; requires `security:manage` or owner/admin role.
3. **Approver B** — second approve sets `status = APPROVED`.
4. Actor retries with matching `approvalId` and identical args hash.

### Emergency override (owners only)

- Requires `emergencyReason` ≥ 12 chars + **one independent approval** (not full dual-control).
- Creates `emergency_overrides` row + CRITICAL security event.

### API routes

| Route | Permission | Dual-control |
|-------|------------|--------------|
| `POST /api/decisions` | `decision:write` | ✅ via `authorizeAndExecuteMutation` |
| `POST /api/decisions/commit` | `decision:commit` | ✅ via `commitDecisionActive` |
| `POST /api/execution/transition` | `execution:write` | ✅ |
| WebSocket `COMMIT_DECISION` | `decision:commit` | ✅ via `commitDecisionActive` |
| Agent tools (coordinator) | Per tool | ✅ via `executeSecuredTool` |

### UI status

- **Approvals admin UI exists:** Settings → Approvals tab (`ApprovalsPanel.tsx`) — lists pending, supports approve clicks.
- **Approval ID entry on commit/transition:** `DecisionsPanel.tsx`, `ExecuteClient.tsx` — manual ID paste fields (functional but not guided workflow).

### Residual risk

`POST /api/execution/link` uses `authorizeAndExecuteMutation` but **`link_execution_signal` is not in `HIGH_RISK_ACTIONS`** — linking does not require dual-control (by design: operator action). Auto-link from intelligence bypasses the secured mutation path and writes directly via `db.linkExternalSignalToTask` when policy tier is `auto`.

---

## 6. Memory & Content Trust

### Injection defense stack

| Stage | Component | Behavior |
|-------|-----------|----------|
| Classification | `prompt-injection.ts` | Deterministic regex patterns → SAFE / SUSPICIOUS / MALICIOUS |
| Pipeline | `content-trust-pipeline.ts` | Non-SAFE → block LLM, memory, tools; log V8 event |
| Isolation | `wrapUntrustedContent` | `<<<BEGIN_UNTRUSTED_CONTENT>>>` delimiters for SAFE content |
| User chat | `gateUserChatInput` | Coordinator + assistant paths |
| Signal ingest | `intelligence/index.ts` | Sets `injection_classification`; blocks LLM if not SAFE |
| Output | `llm-output-firewall.ts` | Blocks authority fabrication, financial claims in stored facts |

### Claim validation (`claim-validation.ts`)

- Weighted evidence: decisions (0.95) > meetings (0.8) > Slack (0.45) > agent_tool (0.2).
- **Anti-gaming:** `canVerify` requires human-verified evidence or approval; Slack repetition alone cannot verify.
- `allowedToStore` requires source diversity ≥2, weighted score ≥0.55, not low-trust-only.

### Memory provenance

- Tables: `memory_records`, `memory_conflicts`, `memory_provenance_events`, `memory_evidence`
- Explain API: `GET /api/memory/facts/:id/explain`
- Tool: `remember_fact` → `tools/remember-fact.ts` through secured gateway

### Organizational truth

- `GET /api/truth/current`, `GET /api/truth/snapshots`
- Debounced recompute via `truth_recompute_queue` (V9 schema)

---

## 7. Agent & LLM Security

### Coordinator agent (`agent.ts`)

- All tool calls via `executeSecuredTool` → full RBAC + approval + capability + audit.
- Chat input via `gateUserChatInput` before LLM.
- Iteration cap: `MAX_ITERATIONS` (default 3 in cost-saver mode).
- History caps: `CHAT_HISTORY_MESSAGES`, `CHAT_MESSAGE_CHAR_CAP`, etc.

### Assistant agent (`assistant-agent.ts`)

- **Product-help only:** single tool `get_current_time` — no ledger/memory mutation tools (V9 fix for RBAC bypass).

### Capability tokens (`capability-tokens.ts`)

- HMAC-SHA256 signed; TTL 5 minutes.
- Signing key: `LEDGER_SIGNING_KEY` or `MISSION_CONTROL_API_KEY` (required in production).
- **JTI consume-on-use** prevents replay (`capability_jti_log`).
- High-risk tools require verified token at execution time.

### LLM budget (known split — see gaps)

| Path | Module | Default limit | Persistence |
|------|--------|---------------|-------------|
| `llm.ts` API calls | `security/llm-budget.ts` | 5000 units/day (`ORG_LLM_DAILY_BUDGET`) | SQLite settings |
| `agent.ts` coordinator | `middleware/llmBudget.ts` | 500 units/day | **In-memory only** |

This inconsistency is a residual denial-of-wallet / enforcement gap.

### Sub-agents

- Marketing/Research: `SUB_AGENT_ALLOWED_TOOLS` = `web_search`, `update_domain_state` only.

### WebSocket limits

- `checkWsRateLimit(userId, "text")` — default 40/min
- `checkWsRateLimit(userId, "commit_decision")` — default 12/min
- Configurable: `WS_RATE_LIMIT_WINDOW_MS`, `WS_TEXT_RATE_LIMIT`, `WS_COMMIT_RATE_LIMIT`

---

## 8. Data & Tenant Isolation

### Model

- V8+ introduces explicit `organizations`, `workspaces`, `workspace_members` (`tenant-context.ts`).
- Default: single-user org provisioning (`org_<userId>` pattern).
- **Canonical tenant key for security:** `orgId` (`tenant-scope.ts`).

### Enforcement mechanism (SQLite)

```typescript
// tenant-scope.ts — back-compat for legacy rows
ledgerTenantInClause() → "user_id IN (?, ?)" // [orgId, userId]
memoryTenantInClause() → "tenant_id IN (?, ?)"
assertLedgerTenantAccess(ctx, resourceUserId)
```

### RLS status

- **Not active at runtime.** SQLite with application-layer scoping only.
- PostgreSQL schema defines RLS policies on `decision_ledger`, `execution_ledger`, `external_signals`, `ledger_events` (`infra/db/postgres/001_initial_schema.sql`) — requires `app.current_org_id` session variable at cutover.

### Known gaps

| Gap | Severity | Detail |
|-----|----------|--------|
| Legacy `user_id` on ledger rows | Medium | IN-clause masks split-brain; migration script TBD |
| No DB-enforced isolation | High | One missed WHERE clause = potential leak |
| Multi-member org model | Partial | Schema exists; product still owner-centric |
| `system` principal | Medium | Bypasses tenant checks in mutation handlers when `userId === "system"` |

### Signal reads

- `external_signals.user_id` scopes per tenant; automation `system` principal does not receive cross-tenant signal reads (per stack rules).

---

## 9. Integration Security

### Slack Events API

| Control | Detail |
|---------|--------|
| Route | `POST /api/integrations/slack/events` |
| Raw body | Mounted **before** `express.json()` |
| Signature | HMAC-SHA256 v0, 5-minute timestamp skew |
| Secret | `SLACK_SIGNING_SECRET` |
| Channel filters | `SLACK_INGEST_CHANNEL_DENYLIST`, `SLACK_INGEST_CHANNEL_ALLOWLIST` |
| Content trust | Intelligence pipeline classifies injection before LLM |

### Other webhooks

| Integration | Verification | Env |
|-------------|--------------|-----|
| GitHub | `x-hub-signature-256` HMAC | `GITHUB_WEBHOOK_SECRET` |
| Linear, Jira, CRM, etc. | Per-handler in `server.ts` | Provider-specific secrets |
| OAuth tokens | Encrypted at rest | `OAUTH_TOKEN_ENCRYPTION_KEY` (64-hex) |

### Slack OAuth

- `GET /api/oauth/slack/start` (authenticated)
- `GET /api/oauth/slack/callback` — state validation via `oauth_pending_states`

### CSRF bypass (intentional)

Webhooks, OAuth callbacks, Bearer/API-key requests — no cookie CSRF check (`csrf.ts`).

---

## 10. Observability & Audit

### Event stores

| Store | Purpose | Key actions |
|-------|---------|-------------|
| `security_events` | Auth lifecycle (V7) | `auth.login_failed`, `auth.api_key_created`, etc. |
| `security_events_v8` | Policy/content (V8/V9) | `content.injection.*`, `approval.*`, `tool.*`, `tenant.isolation_violation` |
| `agent_action_audit` | Tool gate outcomes | ALLOWED/DENIED with capability JTI |
| `audit_log` | Product auditor | Shadow work, conflicts, KILLED signals |
| `ledger_events` | Authority chain | Hash-linked mutation events |
| `emergency_overrides` | Break-glass audit | Owner emergency actions |

### Dashboard APIs

- `GET /api/security/dashboard` — 24h critical/high/denied/injection/cross-tenant counts (`requirePermission("audit:run")`)
- `GET /api/trust/metrics` — composite trust/security/reliability scores
- `GET /api/audit-log` — auditor events

### Logging discipline

Documented prohibition on logging passwords, tokens, raw cookies, full webhook payloads (`docs/security-architecture.md` §13).

---

## 11. Automated Test Coverage

**Command:** `cd apps/api && npm run test:security`  
**Result:** **24 / 24 passed**, 0 failed, 14 suites (~998 ms)

### Test categories (`ops/scripts/security-redteam.test.ts`)

| # | Suite | Tests | Validates |
|---|-------|-------|-----------|
| 1 | RBAC — tool permission registry | 3 | Tool→permission mapping; viewer denied; unregistered tools denied |
| 2 | RBAC — WebSocket actions | 2 | `agent:invoke` required for chat; session load allowed |
| 3 | Prompt injection classifier | 3 | MALICIOUS detection; untrusted wrapping; benign SAFE |
| 4 | Decision temporal resolution | 1 | Prior decision_signal SUPERSEDED on revocation |
| 5 | Role matrix sanity | 2 | Viewer lacks writes; strategist vs operator matrix |
| 6 | Execution tenant isolation | 1 | Cross-tenant task transition rejected |
| 7 | V8 — ContentTrustPipeline | 1 | MALICIOUS blocks LLM/memory/tools |
| 8 | V8 — Claim validation | 1 | Unsupported AI claims rejected |
| 9 | V8 — Tenant context | 2 | Org/workspace provisioning; cross-tenant denied |
| 10 | V8 — Organizational truth | 1 | Truth snapshot computation |
| 11 | V8 — Trust engine | 1 | Human decisions score higher than signals |
| 12 | V8 — Approval gate | 1 | All roles require approval on high-risk tools |
| 13 | V9 — Security gateway | 4 | Chat blocked; claim gaming; self-approve denied; capability replay |
| 14 | V9 — LLM output firewall | 1 | Authority fabrication blocked |

### Not covered (documented backlog)

- Full end-to-end dual-control approval workflow (REST integration)
- Concurrent truth writes / race conditions
- Cross-org membership scenarios
- Load/soak (100–10k users)
- Postgres RLS negative tests

---

## 12. Known Gaps & Residual Risks

| Risk | Severity | Detail |
|------|----------|--------|
| **PostgreSQL + RLS not active** | **High** | Schema exists; runtime SQLite. One application bug can leak cross-tenant data. |
| **Legacy `user_id` ledger keys** | Medium | `tenant-scope.ts` IN-clause is back-compat, not migration. |
| **No load/chaos validation** | **High** | V9 Phase 10 open; SQLite ceiling for 1k+ users. |
| **No external pen test** | **High** | Required before enterprise sales (V9 rollout plan). |
| **Split LLM budget enforcement** | Medium | `llm.ts` vs `agent.ts` use different budget stores/limits. |
| **Auto-link bypasses secured mutation path** | Medium | `intelligence/index.ts` calls `db.linkExternalSignalToTask` directly when `link-policy` tier=auto; no dual-control on auto links. |
| **Suggest-link UI absent** | Low | Policy logs `tier=suggest` candidates; no operator review UI for suggested links. |
| **Agent-as-controller (architectural)** | Medium | Coordinator tools still mutate DB after gates; target is propose→validate→commit queue (`docs/architecture-enforcement.md`). |
| **MCP path** | High if enabled | Wired through `executeSecuredTool` but disabled in prod unless `MCP_ALLOW_PRODUCTION=1`. |
| **Redis rate limits optional** | Medium | Without `REDIS_URL`, per-instance in-memory limits only. |
| **Argon2id not yet default** | Low | bcrypt verified + upgraded; architecture doc targets Argon2id for new hashes. |
| **JWT access tokens** | Low | Session cookies today; JWT design documented for future. |
| **Security dashboard UI** | Low | API exists; no dedicated dashboard page in web app. |
| **Formal policy engine** | Low | Static role-permission map; Cedar/OPA documented as future. |

### Enterprise acceptance blockers (from V9 doc)

Stripe/Linear/Notion/Brex/Ramp would require: Postgres/RLS, external pen test, load proof, complete tenant migration, SOC2 mapping evidence for dual-control SoD.

---

## 13. Production Checklist

### Required / fail-closed

| Variable | Requirement |
|----------|-------------|
| `NODE_ENV=production` | Enables production guards |
| `MISSION_CONTROL_API_KEY` | ≥24 chars random (boot throws if weak) |
| `ALLOWED_ORIGINS` | Exact HTTPS UI origins only; no wildcards |
| `REQUIRE_HTTPS=true` | Enforced except `/api/health` |
| `LEDGER_SIGNING_KEY` or `MISSION_CONTROL_API_KEY` | Capability token signing |
| `DATABASE_TYPE=postgres` + `DATABASE_URL` | Recommended; required if postgres mode |
| `TOTP_ENCRYPTION_KEY` | 32+ chars if enabling 2FA |

### Must be **unset** in production

- `ALLOW_LOOPBACK_AUTH`
- `ALLOW_LEGACY_UID_COOKIE`
- `ALLOW_WS_SESSION_QUERY`

### Integration secrets

| Variable | Purpose |
|----------|---------|
| `SLACK_SIGNING_SECRET` | Events API HMAC |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | OAuth |
| `GITHUB_WEBHOOK_SECRET` | GitHub ingest |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | 64-hex; enables OAuth flows |
| `APP_ORIGIN` or `WEBHOOK_PUBLIC_BASE_URL` | Callback URLs |

### LLM / agent hardening

| Variable | Default (cost-saver) |
|----------|---------------------|
| `LLM_COST_SAVER=0` | Disable to relax caps |
| `ORG_LLM_DAILY_BUDGET` | 5000 (llm.ts) / 500 (agent in-memory) |
| `MAX_ITERATIONS` | 3 |
| `WS_TEXT_RATE_LIMIT` | 40 |
| `WS_COMMIT_RATE_LIMIT` | 12 |
| `AUTO_LINK_POLICY` | `adaptive` |

### Optional hardening

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Distributed rate limits |
| `SLACK_INGEST_CHANNEL_ALLOWLIST` / `DENYLIST` | Signal volume control |
| `MCP_ALLOW_PRODUCTION=1` | Only if MCP intentionally enabled |

### Deployment gates (V7/V9 rollout)

1. `npm run test:security` — all 24 pass
2. `npm run build` (API)
3. Post-deploy: viewer RBAC smoke, injection smoke, trust metrics, role audit
4. No production deploy until external red team Critical/High = 0 (V9 plan)

---

## 14. Recommendations (Prioritized)

### P0 — Block enterprise / regulated use until complete

1. **PostgreSQL runtime cutover + RLS enforcement** — wire `app.current_org_id` per request; run cross-org negative test suite against RLS (`infra/db/postgres/001_initial_schema.sql`).
2. **Complete tenant migration** — normalize all ledger/signal rows to `org_id`; remove reliance on dual IN-clause back-compat.
3. **Unify LLM budget enforcement** — single Redis/SQLite-backed budget used by both `llm.ts` and `agent.ts`; align default limits.
4. **External penetration test** — scope: assistant bypass, dual-control bypass, tenant escape, memory poisoning, truth manipulation.
5. **Load/soak suite** — 100–10k concurrent users; WS chat + commit paths; truth recompute under write load.

### P1 — Reduce operational risk before broad rollout

6. **Route auto-link through secured mutation boundary** — or require manual confirm for `tier=suggest`; add suggest-link review UI.
7. **Redis mandatory in multi-instance production** — rate limits, idempotency, capability revocation cache.
8. **Full dual-control UX** — guided flow: pending approval → two approvers → auto-fill `approvalId` on retry (reduce paste friction).
9. **Security dashboard UI** — surface `GET /api/security/dashboard` for admins.
10. **Agent intent queue** — high-risk tools propose intents; only HTTP/enforcement service commits (`architecture-enforcement.md` backlog).

### P2 — Maturity / compliance path

11. **Argon2id password hashing** for new credentials.
12. **JWT + opaque refresh rotation** with family replay detection.
13. **Formal policy engine** (Cedar/OPA) with versioned policy bundles on ledger events.
14. **LLM second-pass injection classifier** as advisory layer on top of deterministic rules.
15. **SOC2 control mapping** — dual-control SoD evidence, audit retention, break-glass review process.
16. **Worker sandbox isolation** — separate agent runtime with egress deny (architecture target).

---

## Appendix A — Role × Capability Matrix (Effective)

| Role | Chat agent | Write decisions | Commit ACTIVE | Execute transition | Write memory | Approve dual-control |
|------|------------|-----------------|---------------|-------------------|--------------|---------------------|
| viewer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| operator | ❌ | ❌ | ❌ | ✅ (+ approval) | ❌ | ❌ (can approve if admin+) |
| strategist | ✅ | ✅ (+ approval) | ✅ (+ approval) | ❌ | ❌ | ❌ |
| admin/owner | ✅ | ✅ (+ approval) | ✅ (+ approval) | ✅ (+ approval) | ✅ (+ approval) | ✅ |

*All high-risk actions require dual-control regardless of role (V9).*

---

## Appendix B — Phase 0 Implementations Reviewed

### `mutation-handlers.ts`

Centralizes REST mutation logic with `assertLedgerTenantAccess` on commit, transition, link, unlink, kill. Commit path adds institutional reasoning validation (`requireCausalValidationForActivation`, `assertEpistemicSupportForCommit`). Does not itself enforce approval — that happens in `authorizeAndExecuteMutation` wrapper in `server.ts`.

### `link-policy.ts`

- **Auto tier:** deterministic matchers (task UUID, PR/issue refs) when risk ≠ high.
- **Suggest tier:** fused score ≥ 0.48.
- **Auto apply:** score ≥ 0.72 and low risk, or deterministic match.
- Controlled by `AUTO_LINK_POLICY=adaptive`.
- High-risk signals never auto-link via deterministic path.

---

## Related documentation

| Document | Topic |
|----------|--------|
| [`security-architecture.md`](security-architecture.md) | Threat model, target hardening |
| [`v7-security-remediation-rollout.md`](v7-security-remediation-rollout.md) | V7 rollout |
| [`v8-enterprise-readiness-rollout.md`](v8-enterprise-readiness-rollout.md) | V8 memory/trust |
| [`v9-trust-program-rollout.md`](v9-trust-program-rollout.md) | V9 red team, scores |
| [`architecture-enforcement.md`](architecture-enforcement.md) | Ledger vs LLM enforcement |

---

**Report prepared from:** security architecture docs, live codebase inspection, and `npm run test:security` (24/24 pass).
