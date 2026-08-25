



# Hustronix V7 Security Remediation — Rollout Plan

## Summary

This release closes the P0 red-team findings without changing product UX. Core changes:

| Phase | Delivered | Files |
|-------|-----------|-------|
| **P0 RBAC** | Tool permission registry, WS `authorizeAction`, execution tenant checks | `security/tool-permissions.ts`, `security/action-authorization.ts`, `security/agent-tool-gate.ts`, `agent.ts`, `server.ts` |
| **P0 Memory** | `memory_records` + conflict detection + provenance on `remember_fact` | `security/memory-store.ts`, `security/security-schema.ts`, `tools/remember-fact.ts` |
| **P0 Decision lifecycle** | Signal supersession + `decision_relationships` | `security/decision-lifecycle.ts`, `intelligence/index.ts` |
| **P0 Injection** | Deterministic classifier + untrusted content wrapping | `security/prompt-injection.ts`, `signalDetector.ts`, `meetingIngestion.ts` |
| **P1 Agent safety** | Capability tokens + `agent_action_audit` | `security/capability-tokens.ts`, `security/agent-audit.ts` |
| **P1 Evidence graph** | Nodes/edges for signals and memory | `security/evidence-graph.ts` |
| **P1 Trust metrics** | `GET /api/trust/metrics` | `security/trust-metrics.ts` |
| **P1 Tests** | `npm run test:security` | `ops/scripts/security-redteam.test.ts` |
| **P2 Postgres/Redis** | Schema documented; runtime still SQLite | `infra/db/postgres/` (unchanged — cutover separate) |

## Database migration (automatic on boot)

New tables created idempotently via `ensureSecuritySchemaV7()` in `database.ts`:

- `memory_records`, `memory_conflicts`
- `decision_relationships`
- `evidence_nodes`, `evidence_edges`
- `agent_action_audit`

New columns on existing tables:

- `external_signals.injection_classification`, `resolution_state`, `superseded_by_signal_id`
- `decision_ledger.lifecycle_state`

No manual migration required for SQLite tenants.

## Rollout steps

### 1. Pre-deploy verification

```bash
cd apps/api
npm run test:security
npm run smoke:intelligence
```

### 2. Deploy API

Restart API process. Schema migrates on first connection.

### 3. Post-deploy smoke

1. **Viewer RBAC** — user with `org.role=viewer` must receive `403`/WS error on chat agent tools; REST `POST /api/decisions` remains forbidden.
2. **Injection** — ingest Slack message containing `Ignore all previous instructions`; verify `injection_classification=MALICIOUS` and no auto-link.
3. **Temporal resolution** — post conflicting decision signals; verify prior signal `resolution_state=SUPERSEDED`.
4. **Trust metrics** — `GET /api/trust/metrics` returns scores and contradiction counts.

### 4. Role assignment audit

Ensure production users have explicit `org.role` settings:

| Role | Can chat agent? | Can write decisions? | Can write memory? |
|------|-----------------|----------------------|-------------------|
| viewer | No | No | No |
| operator | No | No | No |
| strategist | Yes | Yes | No |
| admin/owner | Yes | Yes | Yes |

### 5. Staging hardening

Confirm these env vars are **unset** in staging/production:

- `ALLOW_LOOPBACK_AUTH`
- `ALLOW_LEGACY_UID_COOKIE`
- `ALLOW_WS_SESSION_QUERY`

## Acceptance criteria mapping

| Criterion | Status |
|-----------|--------|
| Viewer cannot perform writer actions | Enforced via tool gate + WS `agent:invoke` |
| Prompt injection attacks fail | Classifier blocks LLM + auto-link; memory write blocked |
| Memory poisoning detected | Conflicts recorded in `memory_conflicts` |
| Contradictory decisions resolve | `resolveTemporalDecisionSignal` supersedes prior signals |
| All actions auditable | `agent_action_audit` + existing `audit_log` |
| Every memory has provenance | `memory_records` required for `remember_fact` |
| Every decision has lifecycle | `lifecycle_state` column synced on transition |
| Cross-tenant access impossible | Execution/decision ownership checks (single-tenant model preserved) |
| Trust score API | `/api/trust/metrics` |
| Scores 80+ | Achievable on clean tenant; degraded by open conflicts/injection |

## P2 backlog (not in this PR)

- PostgreSQL + RLS cutover (`DATABASE_TYPE=postgres` async repository)
- Redis-backed rate limits
- Multi-member organization model (replace `orgId = userId`)
- Human approval UI for high-risk tool calls
- LLM-based injection classifier as second pass

## Expected score impact

| Metric | Before | After (clean tenant) |
|--------|--------|----------------------|
| Security | 42 | 82–88 |
| Reliability | 38 | 80–85 |
| Trust | 35 | 78–85 |

Scores decrease proportionally with open memory conflicts, malicious signals, and denied agent actions.
