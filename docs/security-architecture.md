# Hustronix Security and Access-Control Architecture

## 1. High-Level Architecture

Hustronix is an organization-centric decision and execution system. Security treats the ledger, auditor, signals, and agent tool surface as sensitive operational infrastructure, not a generic dashboard.

Runtime layers:

1. Edge: Cloudflare or NGINX terminates TLS, normalizes headers, blocks obvious abuse, and forwards only trusted proxy headers.
2. API middleware: request IDs, HTTPS enforcement, security headers, strict CORS, raw webhook verification, JSON limits, CSRF origin checks, authentication, authorization, tenancy checks, scoped rate limits, and structured logs.
3. Auth core: password/OAuth/API-key/service auth resolves a principal, organization, auth kind, session, and role.
4. Policy layer: routes ask for permissions such as `decision:commit` or `signal:write`; resource-specific code verifies tenant ownership.
5. Data layer: today SQLite enforces scoped queries in code; production PostgreSQL should add row-level security (RLS) with `app.current_org_id`.
6. Redis: distributed rate limits, refresh/session revocation, OTPs, idempotency, locks, and AI cost guards.
7. Audit layer: security events are JSON logged and persisted without secrets.

Security domain separation:

| Domain | Trust Level | Allowed Authority | Isolation Boundary |
| --- | --- | --- | --- |
| Public API | Internet-facing, hostile input | Authenticate users, accept UI/API requests, enqueue work | Reverse proxy, strict CORS, request limits, no direct execution authority |
| Integration ingestion | Adversarial third-party payloads | Verify signatures, normalize signals, write quarantined/provenanced records | Raw-body signature verification, replay cache, schema validation |
| LLM inference | Untrusted probabilistic reasoning | Suggest classifications, summarize context, propose actions | No direct ledger mutation, no secret access, bounded context and tools |
| Agent runtime | Potentially compromised automation | Execute only granted capabilities for a workflow | Capability tokens, sandbox, egress policy, loop limits |
| Internal orchestration | High privilege coordination | Dispatch jobs, apply deterministic policy, require approvals | Signed service traffic, queue ACLs, workflow-scoped grants |
| Ledger system | Critical integrity boundary | Persist decisions/executions/audit trail | DB RLS, append-only audit, idempotency, privileged write API |
| Admin/security plane | Break-glass and sensitive controls | Manage org security, tokens, sessions, roles | Step-up auth, low rate limits, separate audit stream |

The important rule is that ingestion and inference can create evidence, but they cannot directly create execution authority. Authority must be minted deliberately by the policy/orchestration layer, scoped to an organization, workflow, capability, and time window.

Current repo implementation adds `apps/api/src/security/*`, hardened middleware in `apps/api/src/server.ts`, security events in `apps/api/src/database.ts`, and production env validation in `apps/api/src/config.ts`. The production target below assumes PostgreSQL and Redis.

## 2. Threat Model

Primary assets:

- Decision ledger, execution ledger, external signals, organization context, Slack/OAuth tokens, API keys, sessions, LLM prompts/context, and audit logs.

Likely attackers:

- Credential stuffers, malicious insiders, compromised agents/API keys, webhook spoofers, cross-tenant users, prompt-injection payloads in Slack/meeting data, and denial-of-wallet actors targeting LLM endpoints.

Key threats and controls:

| Threat | Control |
| --- | --- |
| Credential stuffing | Per-IP + per-identifier auth limits, security events, email/TOTP step-up, breach password checks |
| JWT/session theft | Short access tokens, tracked refresh/session records, rotation, revocation, secure cookies |
| Cross-org data leakage | Org-scoped middleware, resource ownership checks, PostgreSQL RLS |
| Webhook spoofing/replay | Raw body HMAC or bearer verification, timestamp tolerance, idempotency keys |
| LLM cost explosion | Principal/org/model token budgets, tool allowlists, execution loop caps |
| Prompt/context poisoning | Ingestion classification, source provenance, tool boundary policy, human approval for critical actions |
| Agent privilege pivot | Capability-scoped execution tokens, sandboxed runtimes, no ambient internal credentials |
| Internal lateral movement | Zero-trust service auth, mTLS or signed service JWTs, network segmentation |
| Classification bypass | Data classification labels enforced during API reads and AI context assembly |
| Workflow expansion abuse | Execution graph caps, per-workflow budgets, recursion depth and fan-out limits |
| Decision tampering | Append-only mutation log, hash-chained events, signed approvals and transitions |
| Policy drift | Central policy engine with versioned decisions and explainable deny reasons |
| Split-brain execution | Workflow locks, idempotent mutation boundaries, reconciliation jobs |
| Low-quality autonomous decision | Adversarial validation, contradiction detection, causal checks, confidence gates |
| Causal graph corruption | Explicit causal DAG edges, graph integrity checks, contradiction propagation |
| Malicious worker forgery | Worker attestations, signed execution receipts, quorum for high-risk actions |
| Stale temporal authority | Operational epochs, supersession rules, context freshness checks |
| Stale or poisoned memory | Memory decay, trust weighting, conflict resolution, source confidence |
| Invariant regression | Formal models for critical authority and tenancy invariants |
| Human governance bypass | Delegated authority chains, emergency override semantics, constitutional constraints |
| Misaligned execution incentives | Risk-adjusted utility scoring, resource allocation policy, post-action outcome feedback |
| Hidden epistemic uncertainty | Uncertainty propagation, ambiguity tracking, unknown-state handling |
| Governance drift | Amendment process, policy simulation, governance rollback |
| Cross-org authority leakage | Federated trust contracts, external attestations, treaty-scoped delegation |
| Doctrine mismatch | Machine-interpretable principles and mission-weighted policy constraints |
| Governance capture | Anti-capture constraints, trust concentration analysis, adversarial governance simulation |
| Miscalibrated certainty | Calibration scoring, source reliability drift, prediction outcome tracking |
| Institutional drift | Doctrine evolution history, continuity checks, organizational identity persistence |
| Procedurally valid but illegitimate action | Legitimacy review, stakeholder standing, contested-state handling |
| CSRF | SameSite cookies plus origin/referer checks on cookie-backed writes |
| XSS impact | HttpOnly cookies, strict CSP, no token storage in browser localStorage |
| SQL injection | Parameterized queries/ORM, no dynamic table names from input, RLS |
| Timing attacks | Constant-time token/signature comparisons |

Trust-boundary invariant:

- Untrusted input enters only through public API or integration ingestion.
- LLM output is never treated as authorization, identity, policy, or source of truth.
- Agents receive scoped capabilities, not broad roles.
- Ledger mutation requires deterministic policy checks plus tenant/resource checks.
- Every irreversible decision transition has a causal parent, signer, policy version, and tamper-evident event hash.
- Decision validity is temporal: authority can expire, be superseded, or be invalidated by new evidence/policy.
- Organizational memory is not permanent truth; it carries source, confidence, decay, and conflict metadata.
- Critical invariants should be modeled and checked before implementation changes that affect authority propagation.
- Human governance is part of the security model; emergency power must be explicit, constrained, reversible where possible, and auditable.
- The system should distinguish "false", "unknown", "ambiguous", and "not yet evidenced"; uncertainty is an operational state.
- Cross-organization authority is never implicit; it requires explicit federation contracts and auditable delegation.
- Procedural authority and institutional legitimacy are related but distinct; contested actions need review semantics, not silent execution.
- Governance itself can be attacked through capture, collusion, concentration, and amendment abuse.
- Internal services authenticate each other even on private networks.

## 3. Folder Structure

Recommended production layout:

```text
src/
  auth/
    password.ts
    tokens.ts
    jwt.ts
    refreshTokens.ts
    oauth.ts
    apiKeys.ts
    serviceAuth.ts
  security/
    audit.ts
    authorization.ts
    cors.ts
    csrf.ts
    httpSecurity.ts
    requestContext.ts
    rateLimitRedis.ts
    idempotency.ts
    webhookSignatures.ts
    capabilities.ts
    serviceIdentity.ts
  tenancy/
    organizationContext.ts
    tenantQueries.ts
    rls.ts
  execution/
    capabilityTokens.ts
    approvals.ts
    economicGuards.ts
    sandboxPolicy.ts
    decisionIntegrity.ts
    reconciliation.ts
    validation.ts
    causalGraph.ts
    temporalSemantics.ts
    workerAttestation.ts
  memory/
    governance.ts
    decay.ts
    conflictResolution.ts
  verification/
    invariants.tla
    authorityModel.alloy
    modelChecks.ts
  governance/
    councils.ts
    delegations.ts
    emergencyOverrides.ts
    constitution.ts
  economics/
    utility.ts
    risk.ts
    allocation.ts
  epistemics/
    uncertainty.ts
    confidencePropagation.ts
    ambiguity.ts
  federation/
    trustContracts.ts
    externalAttestations.ts
    crossOrgDelegation.ts
  doctrine/
    principles.ts
    missionWeights.ts
    constitutionalReasoning.ts
    continuity.ts
  legitimacy/
    standing.ts
    contestedActions.ts
    review.ts
  calibration/
    sourceReliability.ts
    confidenceScoring.ts
    predictionOutcomes.ts
  policy/
    engine.ts
    policies/
    explain.ts
    versions.ts
  classification/
    dataClasses.ts
    contextPolicy.ts
  provenance/
    hashChain.ts
    signatures.ts
  db/
    schema.sql
    migrations/
  integrations/
  intelligence/
```

Current implementation starts this split with `src/security/` while preserving existing route contracts.

## 4. Middleware Pipeline

Order matters:

```text
trust proxy
requestContextMiddleware
requireHttpsMiddleware
securityHeadersMiddleware
cors(exact allowlist)
globalApiLimiter
cookieParser
raw webhook routes requiring signature verification
json/urlencoded body parsers with small limits
static assets, if any
structured request logger
csrfOriginGuard
authMiddleware on protected routes
requirePermission(...) on protected mutations
resource tenant checks inside handlers/services
route-specific rate limiters
error handler with safe output
```

Why:

- Raw webhooks must be mounted before JSON parsing because HMAC verification needs exact bytes.
- CORS must run before auth so preflight is cheap and deterministic.
- CSRF checks happen after cookies and before route mutation.
- Permission checks should happen before expensive work.
- Resource tenant checks still belong close to the data read/write because middleware cannot infer every resource relationship.

## 5. Auth Implementation

Supported auth modes:

- Email/password with Argon2id target. Existing bcrypt hashes are verified and upgraded on login.
- OAuth Google/GitHub with state stored server-side.
- API keys for agents/services, stored as hashes and shown once.
- Internal service auth with signed service tokens or mTLS at the edge.
- Future SSO via organization identity-provider records.

Access token design:

- JWT access token TTL: 5-15 minutes.
- Signed with asymmetric EdDSA or RS256 keys from secret manager, not `.env` files baked into images.
- Claims: `sub`, `org_id`, `sid`, `roles`, `scp`, `iat`, `exp`, `jti`, `iss`, `aud`.
- Access tokens are not enough for logout; revocation uses short TTL plus session/refresh revocation checks for high-risk operations.

Refresh token design:

- Opaque random token, not JWT.
- Store only hash in DB with `family_id`, `session_id`, `user_id`, `org_id`, `expires_at`, `rotated_at`, `revoked_at`.
- Rotate on every use. If an already-rotated token appears, invalidate the entire family because it indicates replay.

Why:

- Short-lived access tokens reduce blast radius after browser/device compromise.
- Refresh tokens need DB tracking because logout, device management, family invalidation, and suspicious-session detection are stateful.
- Rotation converts replay from silent persistence into a detectable event.

Text flow:

```text
Email/password login
Client -> POST /auth/login
API -> verify password with Argon2id/bcrypt migration
API -> optional email OTP / TOTP step-up
API -> create session + refresh token family
API -> set secure HttpOnly refresh/session cookie, return access JWT
Client -> calls API with access JWT or cookie session
```

```text
Refresh rotation
Client -> POST /auth/refresh with refresh cookie
API -> hash token and load active row
API -> if token was already rotated: revoke family and alert
API -> revoke old token, insert new token in same family
API -> issue fresh access JWT and refresh cookie
```

```text
API key
Agent -> Authorization: Bearer hx_live_...
API -> SHA-256 hash lookup, constant-time prefix checks where applicable
API -> principal authKind=api_token, role=agent, org scope from token owner
API -> route permission + org quota checks
```

Password policy:

- Argon2id with memory cost tuned for your instance class, e.g. 64-128 MB, time cost 2-3, parallelism 1-2.
- Minimum 12 characters for production, reject known-breached passwords using Have I Been Pwned k-anonymity.
- Never log password/reset/OTP fields.
- Reset tokens are opaque, single-use, hashed, short TTL, and invalidate active sessions after success.
- Email verification challenge is single-use, hashed, attempt-limited, and expires in 10 minutes.

Why Argon2id over bcrypt:

- Argon2id is memory-hard, making GPU/ASIC cracking materially more expensive.
- bcrypt is CPU-hard and has a 72-byte password input limitation. It remains acceptable for legacy verification, but new hashes should move to Argon2id.

## 6. Authorization Implementation

Roles:

| Role | Purpose |
| --- | --- |
| Owner | Full organization control, billing/security, irreversible execution authority |
| Admin | Most administrative and operational control |
| Strategist | Creates and commits decisions, invokes intelligence |
| Operator | Executes tasks and links/kills signals |
| Viewer | Read-only observability |
| Agent/System | Narrow machine principal for scoped automation |

Policy shape:

```ts
export type Permission =
  | "decision:read"
  | "decision:write"
  | "decision:commit"
  | "execution:read"
  | "execution:write"
  | "execution:approve"
  | "execution:delegate"
  | "signal:read"
  | "signal:write"
  | "context:read"
  | "settings:write"
  | "security:manage"
  | "agent:invoke";
```

Route example:

```ts
app.post(
  "/api/decisions/commit",
  authMiddleware,
  requirePermission("decision:commit"),
  mutationRouteLimiter,
  handler,
);
```

Avoid role explosion by keeping roles coarse and moving exceptions into permissions and policies. Avoid hardcoded route checks like `if role === "admin"` because that makes future SSO/ABAC brittle. Use policy inputs: role, org, auth kind, resource type, resource owner, risk level, and environment.

Future ABAC examples:

- Agents can write signals only from approved integration sources.
- Strategists can commit decisions only under a budget/risk threshold.
- Operators can transition tasks only for assigned departments.

Human governance semantics:

Hustronix should eventually model human authority with the same rigor as machine authority. A human approval is not just a Boolean; it is an action taken by a person inside a governance topology.

Governance primitives:

| Primitive | Meaning | Security Requirement |
| --- | --- | --- |
| Delegation | One actor grants bounded authority to another | Scope, TTL, revocation, audit event |
| Council | A group required for quorum approval | Membership snapshot and threshold recorded |
| Escalation path | Ordered route for disputed/high-risk execution | Deterministic routing and timeout handling |
| Emergency override | Temporary break-glass authority | Step-up auth, short TTL, after-action review |
| Constitutional constraint | Non-negotiable org rule | Cannot be bypassed by normal delegation |
| Reversal authority | Who can undo/rollback a decision | Separate from who can execute initially |

Emergency overrides should not erase policy failures. They should append a higher-authority event that explicitly says "this action bypassed normal controls under emergency rule X," then trigger mandatory review.

Adaptive governance:

Governance rules should evolve, but the mechanism for evolving them must itself be governed. Otherwise the policy layer becomes a hidden superuser.

Adaptive governance controls:

- Policy changes require proposal, simulation, approval, activation, and rollback paths.
- High-impact policy changes create a new operational epoch and trigger revalidation of active workflows.
- Constitutional constraints define which rules cannot be changed by ordinary admins.
- Governance simulations replay recent decisions under proposed policies before activation.
- Policy rollback is explicit: it reverts future evaluation but does not erase decisions made under the old policy.
- Every policy amendment records proposer, reviewers, policy diff hash, simulation results, approval quorum, and activation epoch.

Adversarial governance modeling:

Governance can be attacked without breaking cryptography. Capture, collusion, rubber-stamp councils, and delegated-authority concentration are institutional attack paths.

Anti-capture controls:

- Track authority concentration: who can mint, approve, reverse, and override.
- Detect circular delegations and unusually dense approval coalitions.
- Require independent standing for high-risk quorum members.
- Simulate proposed governance changes against adversarial scenarios.
- Separate emergency override power from authority to suppress review.
- Record dissent and minority objections as first-class governance evidence.

Legitimacy layer:

Authority means an actor can perform an action under current rules. Legitimacy asks whether the action should be trusted as institutionally acceptable under contested conditions.

| Legitimacy Type | Question |
| --- | --- |
| Legal authority | Is the action allowed by policy/contract? |
| Procedural authority | Was the correct process followed? |
| Delegated authority | Was the actor given bounded authority by the right source? |
| Trusted authority | Does the actor/source retain sufficient trust? |
| Legitimate authority | Would the institution accept this action as valid under review? |

Legitimacy is not a replacement for policy. It is a review signal for emergency actions, cross-org workflows, governance amendments, and contested operational states.

Formal policy engine:

The in-repo permission map is a pragmatic early implementation. As Hustronix grows, authorization should move into a versioned policy engine so execution rules are testable, explainable, and consistent across API routes, workers, schedulers, and agent runtimes.

Policy engine requirements:

- Inputs: principal, role, org, relationship graph, capability claims, resource, data classification, workflow risk, decision state, environment, request purpose, and time.
- Outputs: allow/deny, required approvals, required step-up auth, policy version, and human-readable denial reason.
- Deterministic evaluation: no LLM calls inside authorization.
- Versioned policy bundles: every ledger mutation records which policy version allowed it.
- Test harness: cross-org denial tests, stale capability tests, high-risk workflow approval tests, and regression fixtures.

Candidate approaches:

| Option | Strength | Tradeoff |
| --- | --- | --- |
| Cedar | Strong typed authorization model, good for app-level policies | Operational maturity depends on ecosystem fit |
| OPA/Rego | Mature, expressive, widely deployed | Rego can become hard to govern without style rules |
| Zanzibar-style relationships | Excellent for resource sharing and hierarchy | More complex to build and query |
| Custom capability graph | Fits Hustronix execution authority closely | Must avoid becoming ad hoc business logic |

Example policy:

```text
ALLOW task.transition
ONLY IF
  principal.org_id == task.org_id
  AND capability.workflow_id == task.workflow_id
  AND capability.includes("task.transition.limited")
  AND requested_state IN capability.constraints.allowed_task_states
  AND decision.status IN ["ACTIVE", "UNDER_REVIEW"]
  AND workflow.risk_score < org.policy.max_autonomous_risk
  AND NOT workflow.escalation_locked
```

Capability-based execution:

RBAC answers "who is this principal in the organization?" Capabilities answer "what exact authority was delegated for this workflow right now?" Hustronix needs both because agents and workers should not inherit broad human roles.

Capability token shape:

```json
{
  "iss": "hustronix-orchestrator",
  "aud": "hustronix-agent-runtime",
  "sub": "agent:slack-signal-linker",
  "org_id": "org_123",
  "workflow_id": "wf_456",
  "decision_id": "dec_789",
  "capabilities": [
    "signal.ingest.slack",
    "execution.read",
    "task.transition:blocked"
  ],
  "resource_constraints": {
    "signal_source": "slack",
    "max_task_transitions": 3,
    "allowed_task_states": ["BLOCKED", "DONE"]
  },
  "exp": 1778500000,
  "jti": "cap_abc"
}
```

Capability rules:

- Capabilities are minted by orchestration, not by the LLM.
- They are short-lived, workflow-scoped, and revocable by `jti`.
- They carry explicit resource constraints, not just action names.
- Agents cannot exchange capabilities for broader roles.
- Ledger writes require both a route permission and a capability when the caller is an agent/runtime principal.
- Capabilities are logged as authority propagation events so incident review can reconstruct why an agent was allowed to act.

## 7. Rate Limiting System

Use Redis for distributed limits. Fixed windows fail because attackers can burst at window boundaries and because each Node instance would maintain a different counter. Sliding window or token bucket gives smoother, horizontally safe behavior.

Strategy table:

| Surface | Key | Window | Limit | Why |
| --- | --- | ---: | ---: | --- |
| Global API | `rl:global:ip:{ip}` | 60s | 600 | Stops accidental floods before auth |
| Login/register | `rl:auth:ip:{ip}` + `rl:auth:id:{emailHash}` | 15m | 30/IP, 10/id | Credential stuffing defense |
| Password reset/OTP | `rl:otp:{emailHash}` | 60m | 5 | Prevents inbox bombing and OTP brute force |
| User writes | `rl:user:{userId}:write` | 60s | 120 | Protects ledger mutations |
| Org quota | `rl:org:{orgId}:api` | 60s | plan-based | Fairness and tenant isolation |
| API key | `rl:key:{keyId}` | 60s | key policy | Limits compromised automation |
| AI inference | `rl:org:{orgId}:ai:{model}` | 1h + 1d | token budget | Denial-of-wallet protection |
| Webhooks | `rl:webhook:{provider}:{tenant}` | 60s | provider-based | Handles provider retries without floods |
| Admin/security | `rl:user:{userId}:security` | 15m | 20 | Slows sensitive changes |
| Workflow expansion | `exec:budget:{orgId}:{workflowId}:nodes` | workflow TTL | plan-based | Prevents runaway execution graphs |
| Tool calls | `tool:budget:{orgId}:{workflowId}:{tool}` | 1h | tool policy | Stops recursive or high-cost tool loops |
| Context assembly | `context:budget:{orgId}:{workflowId}` | 1h | token ceiling | Prevents silent prompt-cost explosions |
| Decision propagation | `decision:budget:{orgId}:{decisionId}` | 24h | risk policy | Caps cascading execution work |

Redis sliding-window Lua outline:

```ts
const now = Date.now();
const windowStart = now - windowMs;
await redis.zremrangebyscore(key, 0, windowStart);
const count = await redis.zcard(key);
if (count >= limit) deny;
await redis.zadd(key, now, `${now}:${requestId}`);
await redis.pexpire(key, windowMs);
```

Return headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After`

Execution economics limits:

Hustronix should treat execution as an economic graph, not just HTTP traffic. A single user request may expand into embeddings, LLM calls, signal linking, execution transitions, Slack notifications, and auditor sweeps. The limiter therefore needs graph-level budgets:

- `max_nodes_per_workflow`: hard cap on generated tasks/subtasks.
- `max_depth_per_workflow`: prevents recursive planning loops.
- `max_fanout_per_decision`: limits downstream task creation from one decision.
- `max_tool_calls_per_agent_run`: bounds tool execution abuse.
- `max_context_tokens_per_run`: caps retrieval/context assembly cost before inference.
- `max_llm_usd_per_org_per_day`: denial-of-wallet guard.
- `max_unapproved_mutations_per_workflow`: forces human approval before autonomous systems can continue mutating execution state.

When an economic budget is exceeded, the system should degrade deterministically: stop expansion, persist a blocked execution event, notify the owner/admin, and require explicit approval to continue.

Incentive-aware execution:

Cost ceilings prevent runaway spend, but autonomous execution also needs utility alignment. The system should eventually evaluate work by risk-adjusted expected value, not just by whether it is permitted and affordable.

Execution utility inputs:

- Expected outcome value and confidence.
- Execution cost in time, money, attention, and organizational disruption.
- Reversibility of the action.
- Strategic priority of the parent decision.
- Opportunity cost against other active workflows.
- Risk of false-positive execution versus false-negative inaction.
- Post-action learning value.

This should remain advisory at first. The deterministic policy layer still decides whether an action is allowed; the utility layer helps prioritize scarce execution capacity and identify actions that need human judgment.

## 8. CORS System

CORS is not authentication. It only controls browser reads. Server-to-server callers and webhooks do not rely on it.

Strategy table:

| Environment | Allowed origins | Credentials | Notes |
| --- | --- | --- | --- |
| Local | `http://localhost:3000`, `http://127.0.0.1:3000` | true | Supports Next dev cookies |
| Staging | exact staging UI origins | true | No wildcard preview unless cookie auth is disabled |
| Production | exact app domains only | true | Config must fail closed |
| Webhooks | no browser CORS dependency | false/irrelevant | Auth by signature or bearer |
| Internal services | no browser CORS dependency | false/irrelevant | Auth by service token/mTLS |

Wildcard origins are dangerous with credentials because a malicious site could read credentialed responses. Origin reflection is also dangerous: `callback(null, origin)` turns any attacker-controlled origin into an allowed origin unless it is checked against a trusted allowlist.

## 9. Redis Design

Key conventions:

| Purpose | Key | TTL |
| --- | --- | --- |
| Rate limit | `rl:{scope}:{id}:{bucket}` | window + jitter |
| Refresh family lock | `lock:refresh:{familyId}` | 5s |
| Revoked JWT | `jwt:revoked:{jti}` | access token remaining TTL |
| Session cache | `session:{sessionId}` | session TTL |
| OTP | `otp:{purpose}:{challengeId}` | 10m |
| Idempotency | `idem:{orgId}:{route}:{hash(key)}` | 24h |
| AI budget | `ai:budget:{orgId}:{yyyy-mm-dd}` | 48h |
| Workflow node budget | `exec:budget:{orgId}:{workflowId}:nodes` | workflow TTL |
| Workflow depth | `exec:budget:{orgId}:{workflowId}:depth` | workflow TTL |
| Tool call budget | `tool:budget:{orgId}:{workflowId}:{tool}` | workflow TTL |
| Capability revocation | `cap:revoked:{jti}` | capability remaining TTL |
| Service nonce | `svc:nonce:{serviceId}:{nonce}` | 5m |
| Webhook replay | `webhook:{provider}:{deliveryId}` | 24h |

Eviction:

- Use a dedicated Redis DB/cluster for security state.
- Prefer `volatile-ttl` only if every key has TTL; otherwise use `noeviction` and alert.
- Security correctness should not depend on keys surviving memory pressure silently.

Cluster:

- Hash tags keep multi-key Lua local: `rl:{orgId}:ai`, `idem:{orgId}:...`.
- Use small values and TTLs. Avoid storing raw payloads; store hashes and compact metadata.

## 10. Database Schema

PostgreSQL target:

```sql
CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email citext UNIQUE NOT NULL,
  password_hash text,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  org_id uuid REFERENCES organizations(id),
  user_id uuid REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','strategist','operator','viewer')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  org_id uuid REFERENCES organizations(id),
  refresh_family_id uuid NOT NULL,
  device_fingerprint text,
  ip inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  session_id uuid REFERENCES sessions(id),
  token_hash text UNIQUE NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id),
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text UNIQUE NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE execution_capabilities (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  workflow_id uuid NOT NULL,
  decision_id uuid,
  subject text NOT NULL,
  capabilities text[] NOT NULL,
  constraints jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_classification_labels (
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  classification text NOT NULL CHECK (
    classification IN ('public','internal','confidential','strategic','irreversible','regulated')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE workflow_budgets (
  org_id uuid REFERENCES organizations(id) NOT NULL,
  workflow_id uuid NOT NULL,
  max_nodes integer NOT NULL,
  max_depth integer NOT NULL,
  max_tool_calls integer NOT NULL,
  max_context_tokens integer NOT NULL,
  max_estimated_usd numeric(12, 4) NOT NULL,
  spent_estimated_usd numeric(12, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, workflow_id)
);

CREATE TABLE ledger_events (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('decision','execution','signal','capability')),
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','agent','service','system')),
  actor_id text NOT NULL,
  policy_version text NOT NULL,
  capability_id uuid,
  causation_event_id uuid,
  correlation_id uuid NOT NULL,
  previous_hash text,
  event_hash text NOT NULL,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ledger_events_hash ON ledger_events(event_hash);
CREATE INDEX idx_ledger_events_aggregate ON ledger_events(org_id, aggregate_type, aggregate_id, created_at);

CREATE TABLE decision_validation_runs (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  decision_id uuid NOT NULL,
  validation_type text NOT NULL CHECK (
    validation_type IN ('causal','contradiction','policy','adversarial','consensus')
  ),
  result text NOT NULL CHECK (result IN ('pass','warn','fail')),
  confidence numeric(4, 3),
  findings jsonb NOT NULL DEFAULT '[]',
  model text,
  policy_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_locks (
  org_id uuid REFERENCES organizations(id) NOT NULL,
  workflow_id uuid NOT NULL,
  lock_name text NOT NULL,
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, workflow_id, lock_name)
);

CREATE TABLE causal_edges (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  source_event_id uuid REFERENCES ledger_events(id) NOT NULL,
  target_event_id uuid REFERENCES ledger_events(id) NOT NULL,
  edge_type text NOT NULL CHECK (
    edge_type IN ('caused','supports','contradicts','supersedes','depends_on','invalidates')
  ),
  confidence numeric(4, 3) NOT NULL DEFAULT 1.0,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_event_id, target_event_id, edge_type)
);

CREATE TABLE operational_epochs (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  policy_version text NOT NULL,
  context_snapshot_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worker_attestations (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  workflow_id uuid NOT NULL,
  worker_id text NOT NULL,
  job_id uuid NOT NULL,
  runtime_image_digest text NOT NULL,
  sandbox_policy_hash text NOT NULL,
  input_hash text NOT NULL,
  output_hash text,
  capability_id uuid,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strategic_memory_items (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  source_event_id uuid REFERENCES ledger_events(id),
  content_hash text NOT NULL,
  classification text NOT NULL,
  confidence numeric(4, 3) NOT NULL,
  trust_weight numeric(4, 3) NOT NULL DEFAULT 0.5,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  decay_half_life_days integer,
  superseded_by uuid,
  conflict_set_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE epistemic_states (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  claim_hash text NOT NULL,
  truth_state text NOT NULL CHECK (truth_state IN ('supported','contradicted','ambiguous','unknown','stale')),
  confidence numeric(4, 3) NOT NULL,
  uncertainty numeric(4, 3) NOT NULL,
  evidence_event_ids uuid[] NOT NULL DEFAULT '{}',
  assumptions jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE governance_amendments (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  proposed_by uuid REFERENCES users(id) NOT NULL,
  policy_diff_hash text NOT NULL,
  simulation_result_hash text,
  approval_event_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('proposed','approved','rejected','active','rolled_back')),
  activation_epoch_id uuid REFERENCES operational_epochs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE federated_trust_contracts (
  id uuid PRIMARY KEY,
  local_org_id uuid REFERENCES organizations(id) NOT NULL,
  remote_org_id uuid NOT NULL,
  contract_type text NOT NULL CHECK (contract_type IN ('shared_workflow','attestation','delegation','data_room')),
  allowed_capabilities text[] NOT NULL DEFAULT '{}',
  constraints jsonb NOT NULL DEFAULT '{}',
  remote_public_key text,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizational_doctrine (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) NOT NULL,
  doctrine_version text NOT NULL,
  principles jsonb NOT NULL,
  mission_weights jsonb NOT NULL DEFAULT '{}',
  constitutional_constraints jsonb NOT NULL DEFAULT '[]',
  active_from timestamptz NOT NULL,
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

RLS example:

```sql
ALTER TABLE decision_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation_decisions ON decision_ledger
USING (org_id = current_setting('app.current_org_id')::uuid);
```

Middleware-only isolation is insufficient because one missed `WHERE org_id = ?` leaks data. DB-level RLS makes cross-tenant access fail closed even if an application query is wrong.

Data classification:

| Class | Examples | Access Rule | AI Context Rule |
| --- | --- | --- | --- |
| `public` | Published docs, public status | Broad org/user access | Allowed in prompts |
| `internal` | Routine tasks, non-sensitive metrics | Org members by role | Allowed with provenance |
| `confidential` | Slack conversations, meeting notes | Need explicit permission | Summarize/minimize before use |
| `strategic` | Decisions, constraints, roadmap | Strategist/Admin/Owner | Include only when required by task |
| `irreversible` | Execution approvals, kill/commit actions | Step-up + capability | Never delegated to LLM alone |
| `regulated` | PII, contractual/legal/HR data | Least privilege + audit | Redact or exclude by default |

Classification prevents AI context assembly from becoming silent privilege escalation. Retrieval must filter by both organization and classification before building prompts; higher-class data requires a matching permission/capability and a logged purpose.

Decision integrity model:

The decision ledger should evolve toward event sourcing for all irreversible or authority-bearing mutations. The current mutable row model is acceptable for early product iteration, but a production execution OS needs an append-only integrity chain.

Integrity invariants:

- Every decision/execution mutation appends a `ledger_events` row before changing read models.
- Each event hash covers canonical payload, actor, org, aggregate, previous hash, policy version, causation ID, and timestamp.
- Irreversible transitions require a signer: human approval, service identity, or capability issuer.
- Read models such as `decision_ledger` and `execution_ledger` are projections, not the source of truth.
- Event replay must deterministically reconstruct current ledger state.
- Tamper detection is a routine health check: recompute event hashes and verify signatures.

Why this matters:

- Compliance asks "who authorized what and why?"
- Incident response asks "was this execution chain modified?"
- Autonomous systems need causal replay to prove an action was not hallucinated authority.
- Enterprise customers will eventually require tamper-evident operational history.

Cryptographic provenance:

- Ingestion events store provider signature verification result, delivery ID, payload hash, and normalized record hash.
- Capability issuance is signed by the orchestrator.
- Human approvals are signed with session ID, step-up auth timestamp, and policy version.
- Service-to-service mutations are signed by workload identity.
- Ledger events include `previous_hash` and `event_hash`; high-trust deployments can periodically anchor checkpoint hashes to external storage.

Formal causal graph:

Tracking `causation_event_id` answers the immediate "what triggered this event?" question. A mature Hustronix deployment should also maintain an explicit causal DAG that models support, contradiction, dependency, invalidation, and supersession relationships across decisions, signals, executions, validations, and memory.

Causal graph invariants:

- Causal edges are typed, directed, tenant-scoped, and confidence-weighted.
- Every irreversible transition must be reachable from at least one approved decision and one valid policy evaluation.
- Contradiction edges propagate review pressure to dependent executions.
- Supersession edges invalidate stale decisions, capabilities, and context snapshots according to temporal rules.
- Replay validates both event order and graph consistency; an event chain can be intact while its causal graph is invalid.

This is the path from "we logged what happened" to "we can prove why this operational state is currently valid."

Temporal semantics:

Authority is not timeless. A capability, validation, or decision can be valid at issuance and unsafe later because the organization entered a new operational epoch.

Temporal rules:

- Every capability and validation is evaluated against an `operational_epoch`.
- Policy changes create a new epoch for future authority; high-risk active workflows must be revalidated.
- Decisions can be superseded, invalidated, or placed under review by newer contradictory evidence.
- Context snapshots carry freshness metadata; stale strategic context cannot silently drive autonomous execution.
- Replay must reconstruct state as of a timestamp and state as of the latest valid epoch.

Strategic memory governance:

Organizational memory should be treated as a living evidence system, not a permanent fact table.

- Memory has source provenance, classification, confidence, trust weight, and temporal validity.
- Confidence decays unless reinforced by fresh evidence.
- Conflicting memories are grouped and resolved by policy, human review, or higher-trust sources.
- Low-trust sources may inform hypotheses but cannot support irreversible execution alone.
- Strategic forgetting is explicit: expired or superseded memories remain auditable but are excluded from context assembly by default.

Epistemic uncertainty framework:

Confidence says "how strongly do we believe this claim?" Uncertainty says "how incomplete or ambiguous is the evidence base?" Hustronix needs both because multiple weak signals can create an apparently confident but brittle operational conclusion.

Epistemic states:

| State | Meaning | Execution Implication |
| --- | --- | --- |
| `supported` | Evidence supports the claim | May support execution if classification/policy allow |
| `contradicted` | Strong counter-evidence exists | Blocks autonomous execution |
| `ambiguous` | Evidence points in multiple directions | Requires human review or more evidence |
| `unknown` | Insufficient evidence | Cannot justify irreversible action |
| `stale` | Evidence may have expired | Requires refresh before high-risk use |

Uncertainty propagation rules:

- Combining weak evidence should not automatically create high authority.
- Contradictions increase uncertainty even when a majority of signals agree.
- Missing evidence is distinct from negative evidence.
- LLM confidence is an input to validation, not an authority score.
- High uncertainty lowers autonomous execution thresholds and increases approval requirements.

Meta-epistemic calibration:

The system should measure whether its confidence estimates are themselves reliable. A source or model that is overconfident should lose trust weight even when individual outputs look plausible.

Calibration signals:

- Prediction outcomes: did expected outcomes occur?
- Source reliability drift: is a source becoming less predictive over time?
- Model calibration error: are high-confidence predictions actually correct?
- Human override patterns: do experts repeatedly correct a source/model?
- Contradiction arrival rate: how often does new evidence overturn prior claims?
- Domain-specific reliability: a source may be reliable for engineering signals but weak for market interpretation.

Calibration should feed memory trust weights and validation thresholds. It should not directly mint or revoke authority without policy review.

Federated and cross-org trust:

The default model is strict organization isolation. Future shared workflows need explicit trust contracts rather than ad hoc exceptions.

Federation rules:

- Cross-org delegation requires a `federated_trust_contract`.
- Remote attestations must be signed and mapped into local policy before use.
- Shared workflows carry both local and remote org IDs in provenance events.
- Treaty-style constraints define allowed capabilities, data classes, expiration, and revocation.
- External evidence can support local reasoning but cannot mint local authority unless the trust contract permits it.
- A remote org's policy result is evidence; local policy still decides local execution.

Machine-interpretable doctrine:

Policies define allowed actions. Doctrine defines why certain tradeoffs matter to the organization. This should remain below constitutional constraints and above utility optimization.

Doctrine examples:

- "Prefer reversible experiments over irreversible commitments under uncertainty."
- "Protect customer trust over short-term revenue."
- "Do not increase operational load on teams already above capacity unless the decision is mission-critical."
- "Security and legal constraints outrank growth optimization."

Doctrine should be versioned, testable against historical decisions, and referenced by validation runs. It should guide prioritization and critique, not silently override policy.

Long-horizon organizational evolution:

Hustronix should preserve strategic continuity while allowing doctrine and policy to evolve. The system needs to know when an organization has changed its mind versus when it has lost coherence.

Evolution primitives:

- Doctrine evolution history: why principles changed and who approved them.
- Strategic continuity checks: whether new decisions preserve or explicitly supersede long-term commitments.
- Institutional memory drift detection: whether memory decay is changing operational identity.
- Identity persistence: stable constraints that define what the organization must not become.
- Generational replay: evaluate current decisions under prior doctrine to understand strategic drift.

Formal verification frontier:

Most Hustronix controls can be implemented with ordinary tests and audits. A small set of authority invariants are important enough to model formally once the platform starts executing high-stakes workflows.

Candidate invariants:

- No ledger mutation without a valid org-scoped principal.
- No cross-org authority propagation.
- No execution without a valid causal path from an approved decision.
- No capability can grant authority outside its issuer's authority.
- No stale operational epoch can authorize new irreversible execution.
- No emergency override can become permanent authority without review.
- No worker receipt can mutate state without a matching capability and policy version.

Candidate tools:

| Tool | Use |
| --- | --- |
| TLA+ | Model workflow locks, retries, stale capabilities, and split-brain execution |
| Alloy | Explore authority graph constraints and impossible delegation paths |
| Property-based tests | Generate random policy/capability/resource combinations |
| Replay checkers | Rebuild ledger state from events and assert invariants |

Formal methods should focus only on small authority kernels. Trying to formally verify the whole product would be expensive and slow; verifying capability propagation, org isolation, and mutation preconditions is tractable and high leverage.

## 11. Security Middleware

Implemented now:

- Request ID propagation via `X-Request-ID`.
- Structured JSON HTTP logs.
- Security headers including CSP, HSTS in production, no-sniff, frame deny, referrer policy, permissions policy.
- Exact-origin credentialed CORS.
- Small JSON body limits.
- CSRF origin/referer guard for cookie-backed mutating requests.
- Raw webhook body verification remains before JSON parsing.
- Security event persistence in `security_events`.
- Permission middleware on critical mutations.

CSRF bypass:

- Login/register/OTP because there is no privileged cookie-backed mutation yet.
- OAuth callbacks because provider redirects must work with state validation.
- Webhooks because they are not browser cookie flows and use signatures/bearers.
- Bearer/API-key requests because they are not ambient browser credentials.

CSP matters for APIs because API origins sometimes serve OAuth callback HTML, health pages, or accidental error HTML. A strict baseline limits the damage from reflected content or proxy mistakes.

Idempotency matters because Hustronix executes organizational workflows. Retrying a `commit decision` or `transition task` request should not double-create downstream work or conflicting audit history.

Reliability-security interaction:

Autonomous execution security fails through reliability edges as often as direct attacks. Retries, partial failures, stale locks, duplicate messages, and split-brain workers can accidentally bypass intended authority boundaries.

Required reliability controls:

- Exactly-once ledger mutation boundary: at-least-once jobs are acceptable only if the ledger write is idempotent.
- Idempotency keys are scoped by org, actor, route/action, resource, and semantic payload hash.
- Workflow locks use fencing tokens; stale workers with old tokens cannot commit.
- Capability TTL is checked at mutation time, not just at job start.
- Saga compensation requires its own permission/capability; rollback must not become an unguarded write path.
- Reconciliation jobs compare workflow projections against append-only events and alert on drift.
- Queue consumers record `correlation_id` and `causation_event_id` so retries preserve causal lineage.

Security rule: a retry may repeat evidence collection, but it may not mint new authority unless the original authority is still valid.

## 12. AI-Specific Protections

Required controls:

- Per-org and per-user token budgets by model tier.
- Tool allowlists per role/auth kind.
- Capability tokens for agent/runtime execution authority.
- Maximum recursion/iteration caps and wall-clock caps.
- Prompt-injection classifier on ingested signals and meeting transcripts.
- Source provenance attached to every context item.
- Human approval for high-impact execution actions.
- Agent sandbox: no arbitrary shell/network/file access from untrusted prompts.
- Context write controls: Slack/meeting content can suggest but not overwrite policy, memory, or execution authority.

Decision validation:

Hustronix should validate decision quality separately from execution permission. Authorization can say "this actor may commit"; validation asks "is this decision internally coherent, causally supported, and policy-consistent?"

Validation layers:

| Layer | Purpose | Required For |
| --- | --- | --- |
| Causal validation | Decision reasoning supports the proposed action | Commit/activate decisions |
| Contradiction detection | New decision does not conflict with active commitments | Strategic decisions |
| Policy consistency | Decision obeys org constraints and no-go rules | All ledger mutations |
| Adversarial critique | Independent model/agent tries to find failure modes | High-risk actions |
| Consensus/second pass | Multiple evaluators agree or escalate uncertainty | Irreversible execution |
| Confidence gate | Low-confidence synthesis cannot auto-execute | Agent-authored decisions |

Validation outputs should be stored in `decision_validation_runs` and referenced by the commit event. A failed validation should block autonomous execution; a warning should require human acknowledgement; a pass should still record confidence and assumptions.

Denial-of-wallet defense:

- `ai:budget:{orgId}:{date}` tracks estimated input/output tokens and cost.
- High-cost endpoints use `aiRouteLimiter`.
- Model routing defaults to fast/cheap tiers for sub-agents; premium only where decision quality justifies it.

Runtime isolation:

Agent execution should run outside the API process. The API should mint a short-lived capability token, enqueue a workflow job, and let an ephemeral worker execute inside a constrained runtime.

Isolation requirements:

- Ephemeral worker identity per job or workflow.
- Read-only root filesystem where possible.
- No ambient cloud credentials or database superuser credentials.
- Egress allowlist by tool capability; default deny outbound network.
- CPU, memory, wall-clock, and output-size limits.
- No direct Redis/Postgres access except through a narrow internal API.
- Seccomp/AppArmor/gVisor/Firecracker or equivalent sandboxing for untrusted tool execution.
- Tool execution logs include capability `jti`, workflow ID, org ID, input hash, output hash, and cost estimate.

Compromised-worker assumptions:

Runtime isolation reduces blast radius, but high-trust execution should eventually assume a worker can be malicious, not merely buggy. The orchestrator should not accept a worker's claim of completion as truth without signed evidence and policy checks.

Controls:

- Worker outputs are signed as execution receipts with job ID, image digest, sandbox policy hash, input hash, output hash, and capability ID.
- High-risk workflows require quorum: independent validator, human approval, or second worker verification before ledger mutation.
- Workers cannot self-issue capabilities or extend TTLs.
- Orchestrator verifies attestation before accepting output into the ledger.
- Suspicious worker behavior revokes active capabilities and quarantines future jobs for that worker identity.
- Hardware-backed attestation can be added later for regulated/high-trust deployments, but signed software attestations are a pragmatic first step.

Execution approval layers:

| Action | Required Control |
| --- | --- |
| Read context | Role permission + classification check |
| Ingest signal | Integration signature + source capability |
| Link signal to task | `signal:write` + workflow capability |
| Transition task | `execution:write` + state-scoped capability |
| Commit decision | Human strategist/admin + step-up for high risk |
| Kill execution | Human approval unless pre-authorized by deterministic policy |
| Call external tool | Tool-specific capability + egress policy |

## 13. Observability

Security logs are SIEM-friendly JSON:

```json
{
  "ts": "2026-05-11T05:30:00.000Z",
  "event": "security.event",
  "eventType": "auth.login_failed",
  "severity": "warning",
  "userId": "optional",
  "authKind": "session",
  "ip": "203.0.113.10",
  "requestId": "req-id",
  "metadata": { "reason": "bad_password" }
}
```

Never log:

- Passwords, OTPs, TOTP secrets, backup codes, access/refresh tokens, API keys, OAuth tokens, raw cookies, full Authorization headers, private prompts containing sensitive org data, or full webhook payloads.

Safe logging:

- Log stable IDs, token prefixes, hashes of identifiers where needed, route, status, request ID, auth kind, org ID, failure reason categories, and compact risk metadata.

Provenance events:

| Event | Must Include |
| --- | --- |
| Capability issued | issuer, subject, org, workflow, capability list, constraints hash, TTL, signature |
| Capability used | capability `jti`, action, resource, policy version, result |
| Decision committed | actor, approval/session, validation run IDs, previous event hash |
| Execution transitioned | task, previous state, next state, causation event, fencing token |
| Ingestion accepted | provider, delivery ID, signature status, payload hash, normalized hash |
| Policy denied | policy version, deny reason, evaluated inputs hash |

Provenance logs should be append-only and reconstructable. Application logs can be sampled; authority-chain events cannot.

## 14. Infrastructure Hardening

Reverse proxy:

- TLS 1.2+, HSTS, HTTP/2 request normalization, max body size, request timeout, header size limits.
- Set and trust `X-Forwarded-Proto` only from the proxy.
- Drop duplicate `Content-Length`/`Transfer-Encoding` combinations to prevent request smuggling.

Cloudflare:

- WAF managed rules, bot fight mode or rate rules on auth and AI routes, mTLS for internal endpoints, origin certificate, geo rules only if business-appropriate.

Zero-trust internal networking:

- No implicit VPC trust. Every internal HTTP/gRPC call authenticates the caller and authorizes the requested capability.
- Internal services use mTLS with workload identity where available. A future mature setup should evaluate SPIFFE/SPIRE for service identities.
- Lightweight early-stage alternative: signed internal service JWTs with `iss`, `aud`, `svc`, `scp`, `iat`, `exp`, `jti`, and nonce replay protection in Redis.
- Redis and Postgres are reachable only from approved app/worker security groups or network policies, never from public subnets or broad container networks.
- Queues should enforce producer/consumer ACLs. The public API can enqueue ingestion work, but cannot enqueue privileged ledger mutation jobs directly.
- Workers receive per-job secrets through the orchestrator, not shared static environment variables.
- Internal admin/debug endpoints require explicit service identity plus human admin auth where possible.

Service-token flow:

```text
worker -> signs service JWT for audience=hustronix-orchestrator, ttl=60s, nonce=random
orchestrator -> verifies service identity, audience, nonce, scope
orchestrator -> checks capability token/resource constraints
orchestrator -> performs ledger mutation or rejects
```

Docker:

- Run as non-root, read-only filesystem where possible, drop Linux capabilities, pin base images, scan images, do not bake `.env` into images.

Secrets:

- Use cloud secret manager or platform secrets. `.env` is acceptable for local dev only.
- Secrets should not live in containers because images are copied, cached, scanned, and retained beyond deployment lifetime.
- Rotate API keys, JWT signing keys, OAuth secrets, and webhook secrets on a schedule and after incidents.

CI/CD:

- Mask secrets, restrict deploy tokens to protected branches, avoid printing environment, run dependency and container scans, require review for migrations and auth changes.

## 15. Deployment Checklist

- `NODE_ENV=production`
- `MISSION_CONTROL_API_KEY` changed from default.
- `ALLOWED_ORIGINS` contains exact HTTPS UI origins only.
- `REQUIRE_HTTPS=true`
- `TOTP_ENCRYPTION_KEY` is 32+ random characters.
- PostgreSQL `DATABASE_URL` uses TLS and a least-privileged app role.
- Redis `REDIS_URL` uses TLS/auth and `noeviction` or alerting.
- OAuth callback URLs match production UI/API origins.
- Webhook secrets are configured per provider.
- Internal service authentication is enabled; no internal endpoint accepts anonymous VPC traffic.
- Worker/agent runtime has default-deny egress and no direct database superuser access.
- Capability token minting/revocation is tested for agent workflows.
- Classification filters are tested in API reads and AI context assembly.
- Workflow economic limits are configured per environment/plan.
- NGINX/Cloudflare forwards only trusted proxy headers.
- Security logs are shipped to SIEM/log storage.
- Backup/restore tested for auth tables and ledgers.
- RLS policies tested with cross-org negative cases.

## 16. Example TypeScript Code

JWT signing:

```ts
import jwt from "jsonwebtoken";

export function signAccessToken(claims: {
  sub: string;
  orgId: string;
  sessionId: string;
  roles: string[];
  scopes: string[];
}) {
  return jwt.sign(
    {
      sub: claims.sub,
      org_id: claims.orgId,
      sid: claims.sessionId,
      roles: claims.roles,
      scp: claims.scopes,
    },
    process.env.JWT_PRIVATE_KEY_PEM!,
    {
      algorithm: "RS256",
      issuer: "hustronix-api",
      audience: "hustronix",
      expiresIn: "10m",
      jwtid: crypto.randomUUID(),
    },
  );
}
```

Argon2id password hashing:

```ts
import argon2 from "argon2";

export async function hashPassword(plain: string) {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string) {
  return argon2.verify(hash, plain);
}
```

Refresh replay handling:

```ts
if (refresh.rotated_at || refresh.revoked_at) {
  await tx.refreshTokens.updateMany({
    where: { family_id: refresh.family_id },
    data: { revoked_at: new Date(), revoked_reason: "reuse_detected" },
  });
  await audit.security("auth.refresh_reuse_detected", "critical", { sessionId: refresh.session_id });
  throw new UnauthorizedError("refresh token replay detected");
}
```

Webhook replay guard:

```ts
const replayKey = `webhook:github:${deliveryId}`;
const firstSeen = await redis.set(replayKey, "1", "EX", 86400, "NX");
if (!firstSeen) return res.status(409).json({ error: "duplicate_delivery" });
```

Capability enforcement:

```ts
type Capability = "signal.ingest.slack" | "execution.read" | "task.transition.limited";

interface CapabilityClaims {
  org_id: string;
  workflow_id: string;
  capabilities: Capability[];
  resource_constraints: {
    allowed_task_states?: string[];
    max_task_transitions?: number;
  };
  jti: string;
  exp: number;
}

export async function requireCapability(
  claims: CapabilityClaims,
  capability: Capability,
  resource: { orgId: string; nextState?: string },
) {
  if (await redis.exists(`cap:revoked:${claims.jti}`)) throw new ForbiddenError("capability revoked");
  if (claims.org_id !== resource.orgId) throw new ForbiddenError("wrong organization");
  if (!claims.capabilities.includes(capability)) throw new ForbiddenError("missing capability");
  if (
    resource.nextState &&
    claims.resource_constraints.allowed_task_states &&
    !claims.resource_constraints.allowed_task_states.includes(resource.nextState)
  ) {
    throw new ForbiddenError("state outside capability boundary");
  }
}
```

Classification-aware context assembly:

```ts
const allowedClassesByPermission = {
  "context:read": ["public", "internal"],
  "context:read:confidential": ["public", "internal", "confidential"],
  "context:read:strategic": ["public", "internal", "confidential", "strategic"],
};

export function filterContextForPrincipal(items: ContextItem[], permissions: string[]) {
  const allowed = new Set(
    permissions.flatMap((permission) => allowedClassesByPermission[permission] ?? []),
  );
  return items.filter((item) => allowed.has(item.classification));
}
```

Hash-chained ledger event:

```ts
import crypto from "crypto";

function canonicalJson(value: unknown) {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

export function hashLedgerEvent(input: {
  orgId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  actorId: string;
  policyVersion: string;
  previousHash: string | null;
  causationEventId: string | null;
}) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(input), "utf8")
    .digest("hex");
}
```

Workflow lock with fencing:

```ts
const lock = await acquireWorkflowLock({ orgId, workflowId, lockName: "ledger-mutation" });

await tx.executionLedger.update({
  where: {
    task_id: taskId,
    fencing_token: { lt: lock.fencingToken },
  },
  data: {
    status: nextState,
    fencing_token: lock.fencingToken,
  },
});
```

Decision validation gate:

```ts
const validation = await validateDecision(decisionId, {
  checks: ["causal", "contradiction", "policy"],
});

if (validation.result === "fail") {
  throw new ForbiddenError("decision validation failed");
}

if (validation.result === "warn" && !humanApprovalId) {
  throw new ApprovalRequiredError("human acknowledgement required");
}
```

Causal graph validation:

```ts
export function assertExecutionHasValidCausalPath(graph: CausalGraph, executionEventId: string) {
  const path = graph.findPath({
    fromType: "decision.approved",
    toEventId: executionEventId,
    allowedEdges: ["caused", "supports", "depends_on"],
  });

  if (!path) throw new ForbiddenError("execution has no approved causal path");
  if (path.some((edge) => edge.confidence < 0.7)) {
    throw new ApprovalRequiredError("causal confidence below autonomous threshold");
  }
  if (graph.hasIncomingEdge(executionEventId, "invalidates")) {
    throw new ForbiddenError("execution was invalidated by newer evidence");
  }
}
```

Temporal authority check:

```ts
export function assertCapabilityFresh(capability: CapabilityClaims, epoch: OperationalEpoch) {
  if (capability.epoch_id !== epoch.id) {
    throw new ApprovalRequiredError("capability was minted under a stale operational epoch");
  }
  if (Date.now() / 1000 > capability.exp) {
    throw new ForbiddenError("capability expired");
  }
}
```

Worker attestation verification:

```ts
export async function verifyWorkerReceipt(receipt: WorkerReceipt, job: WorkflowJob) {
  if (receipt.job_id !== job.id) throw new ForbiddenError("receipt/job mismatch");
  if (receipt.input_hash !== hashJobInput(job.input)) throw new ForbiddenError("input hash mismatch");
  if (!await verifySignature(receipt.worker_id, receipt.signature, receipt)) {
    throw new ForbiddenError("invalid worker attestation");
  }
}
```

Property-style invariant test:

```ts
property("capabilities never cross organization boundaries", [fc.capability(), fc.resource()], (cap, resource) => {
  fc.pre(cap.org_id !== resource.org_id);
  expect(() => requireCapability(cap, "task.transition.limited", resource)).toThrow(ForbiddenError);
});
```

TLA+ invariant sketch:

```text
NoStaleEpochExecution ==
  \A e \in LedgerEvents :
    e.type = "execution.transition" =>
      e.epoch = CurrentEpochAt(e.created_at)

NoCrossOrgAuthority ==
  \A c \in Capabilities, r \in Resources :
    CanUse(c, r) => c.org = r.org
```

Epistemic gate:

```ts
export function requireEpistemicSupport(state: EpistemicState, action: ProposedAction) {
  if (state.truth_state === "unknown" || state.truth_state === "ambiguous") {
    throw new ApprovalRequiredError("insufficient evidence for autonomous execution");
  }
  if (state.truth_state === "contradicted" || state.truth_state === "stale") {
    throw new ForbiddenError("claim cannot support execution in its current epistemic state");
  }
  if (state.uncertainty > action.max_uncertainty) {
    throw new ApprovalRequiredError("uncertainty exceeds autonomous threshold");
  }
}
```

Federated trust check:

```ts
export function assertFederatedDelegation(contract: TrustContract, capability: string, dataClass: string) {
  if (contract.revoked_at || Date.now() > contract.valid_until.getTime()) {
    throw new ForbiddenError("federated trust contract is not active");
  }
  if (!contract.allowed_capabilities.includes(capability)) {
    throw new ForbiddenError("capability outside federated contract");
  }
  if (!contract.constraints.allowed_data_classes.includes(dataClass)) {
    throw new ForbiddenError("data class outside federated contract");
  }
}
```

Calibration update:

```ts
export function updateSourceCalibration(source: SourceReliability, outcome: PredictionOutcome) {
  const wasOverconfident = outcome.predicted_confidence > 0.8 && outcome.result === "wrong";
  return {
    ...source,
    trust_weight: wasOverconfident
      ? Math.max(0, source.trust_weight - 0.1)
      : source.trust_weight,
    calibration_error: recomputeCalibrationError(source.history.concat(outcome)),
  };
}
```

Legitimacy review gate:

```ts
export function requireLegitimacyReview(action: GovernanceAction) {
  if (action.emergency_override || action.contested || action.cross_org_impact) {
    throw new ApprovalRequiredError("legitimacy review required before finalization");
  }
}
```

## 17. Future Extensibility Roadmap

1. Move from user-as-tenant to explicit `organizations` and `organization_memberships`.
2. Add PostgreSQL RLS and a DB session variable set per request.
3. Add Redis-backed sliding-window limiters and idempotency cache.
4. Introduce JWT access tokens plus opaque rotating refresh tokens.
5. Migrate new password hashes to Argon2id while retaining bcrypt verification.
6. Add SAML/OIDC SSO through an `identity_providers` table.
7. Add policy engine hooks for ABAC without replacing the simple role-permission map.
8. Add AI budget ledger tied to org plan, model, and workflow class.
9. Add security alert sinks for Slack/SIEM/PagerDuty.
10. Add integration-specific least-privilege scopes and per-agent tool grants.
11. Split public API, ingestion workers, orchestration, agent runtime, and ledger mutation into separate service identities.
12. Add capability-token minting for workflow-scoped agent execution.
13. Add sandboxed ephemeral workers with default-deny egress for tool execution.
14. Add data classification labels and enforce them during retrieval/context assembly.
15. Add workflow graph and execution-economics budgets as first-class controls.
16. Move irreversible ledger writes to append-only event sourcing with hash-chain verification.
17. Add signed capability issuance, approvals, ingestion proofs, and execution transitions.
18. Adopt a formal policy engine with versioned policy bundles and deny explanations.
19. Add reconciliation workers for projection drift, stale capabilities, and split-brain execution detection.
20. Store decision validation runs and require them for high-risk commit/execute transitions.
21. Add a formal causal DAG engine with typed edges, confidence propagation, and contradiction invalidation.
22. Add worker execution attestations and quorum verification for high-risk autonomous workflows.
23. Add operational epochs for temporal authority, supersession, and stale-context invalidation.
24. Add strategic memory governance: decay, conflict sets, source trust, and explicit forgetting.
25. Add property-based and model-checking coverage for authority invariants.
26. Model human governance: councils, delegation chains, emergency override, and constitutional constraints.
27. Add risk-adjusted execution utility models for prioritization and incentive alignment.
28. Add epistemic uncertainty propagation for ambiguous, incomplete, stale, and contradictory evidence.
29. Add adaptive governance workflows for policy simulation, amendment, activation, and rollback.
30. Add federated trust contracts for cross-org delegation, shared workflows, and external attestations.
31. Add machine-interpretable doctrine for mission-weighted reasoning and constitutional constraints.
32. Add adversarial governance simulations for capture, collusion, and authority concentration.
33. Add meta-epistemic calibration for source/model reliability and confidence drift.
34. Add long-horizon organizational evolution tracking for doctrine drift and strategic continuity.
35. Add legitimacy review semantics for emergency, contested, and cross-org authority.
