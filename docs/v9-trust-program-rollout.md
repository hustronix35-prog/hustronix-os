# V9 Trust Program — Rollout & Acceptance

## 1. Gap Analysis (Red Team → V9)

| Finding | V9 Remediation | Status |
|---------|----------------|--------|
| Assistant agent bypassed RBAC/approval/capability | `SecurityGateway.executeSecuredTool`; assistant limited to `get_current_time` only; all tools gated | **Fixed** |
| Claim validation gameable (2 Slack → VERIFIED) | Weighted evidence graph; source diversity; low-trust-only rejection; `canVerify` requires human approval or ACTIVE decision | **Fixed** |
| Tenant split-brain (`userId` vs `orgId`) | `tenant-scope.ts`; ledger/memory IN-clause scoping; trust metrics aligned | **Partial** — legacy rows still keyed `user_id` |
| Owner/admin self-approve | Dual-control: 2 independent approvers; self-approve denied; emergency override audited | **Fixed** |
| Capability token theater / replay | JTI logged + consumed; production signing key required | **Fixed** |
| SUSPICIOUS content reached LLM | `ContentTrustPipeline` blocks non-SAFE from LLM + memory | **Fixed** |
| User chat not scanned | `gateUserChatInput` on coordinator + assistant | **Fixed** |
| Truth engine DoS + races | Debounced recompute; transactional snapshot persist | **Fixed** |
| No memory provenance chain | `memory_provenance_events` + explain API | **Fixed** |
| Postgres/RLS not active | Schema exists; runtime still SQLite | **Open** |
| No load/chaos validation | Documented in Phase 10 plan | **Open** |
| MCP tool path ungated (unused) | Must wire before enabling MCP | **Open** |

## 2. Architecture Changes

### UnifiedSecurityBoundary (`security-gateway.ts`)

All sensitive operations route through:

- `executeSecuredTool()` — RBAC + approval + capability + audit
- `gateUserChatInput()` — injection firewall on chat
- `authorizeSecuredMutation()` — REST/WS mutation policy

### Truth V2 (`organizational-truth.ts`)

- Weighted source quality (decisions > meetings > Slack)
- Human ACTIVE decisions dominate signals per topic
- Debounced `scheduleOrganizationalTruthRecompute()`

### Memory Integrity V9

- `claim-validation.ts` — weighted evidence, diversity, anti-poisoning
- `memory-provenance.ts` — chain of custody events
- `llm-output-firewall.ts` — blocks fabricated authority/financial claims

### Dual-Control Approvals (`approval-gate.ts`)

1. Actor creates pending approval (on denied high-risk attempt)
2. Approver A grants first approval (≠ actor)
3. Approver B grants second approval → status `APPROVED`
4. Actor retries with `approvalId`

Emergency override (owners only): requires reason + one independent approval; creates `emergency_overrides` row + CRITICAL security event.

## 3. Database Migrations

Auto-applied on boot via `ensureV9TrustSchema()`:

- `capability_jti_log` — replay prevention
- `memory_provenance_events` — custody chain
- `emergency_overrides` — override audit
- `truth_recompute_queue` — debounce metadata
- Columns: `pending_action_approvals.second_approved_by`, `memory_records.workspace_id`, `ai_claim_validations.weighted_score`

## 4. Security Fixes (P0)

1. Assistant path gated; memory mutation tools removed from assistant
2. Capability JTI consume-on-use
3. Dual-control on all high-risk actions including `commit_decision`
4. Approval tenant scoping on approve endpoint
5. SUSPICIOUS/MALICIOUS blocked from LLM reasoning

## 5. Trust Fixes

1. VERIFIED memory requires `canVerify` (human decision support or approval)
2. Slack repetition cannot verify memory
3. Trust metrics use org + user IN scope
4. Memory explain includes `provenance_chain`

## 6. Test Plan

```bash
cd apps/api
npm run build
npm run test:security   # 24 tests (V9 adversarial regressions)
```

Permanent regression categories in `ops/scripts/security-redteam.test.ts`:

- RBAC / WS actions
- Prompt injection
- Claim gaming
- Self-approval denial
- Capability replay
- LLM output firewall
- Tenant isolation
- Dual-control policy

**Still required:** integration tests for full approval workflow, concurrent truth writes, cross-org membership, load/soak.

## 7. Red Team Plan (External)

1. Engage third-party pen test after Postgres cutover
2. Scope: assistant bypass retest, dual-control bypass, tenant escape, memory poisoning, truth manipulation
3. All findings → permanent test in `security-redteam.test.ts`
4. No production deploy until Critical/High = 0

## 8. Rollout Plan

1. **Stage 1 (dev):** Restart API → V9 schema migrates automatically
2. **Stage 2:** Update UI to collect `approvalId` for high-risk actions (commit, remember_fact, transition)
3. **Stage 3:** Train admins on dual-control approve flow (`POST /api/security/approvals/:id/approve` × 2)
4. **Stage 4:** Postgres + RLS cutover
5. **Stage 5:** External red team + load validation

## 9. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Legacy `user_id` ledger rows | Medium | IN-clause back-compat; migration script TBD |
| Dual-control UX friction | Low | Emergency override path for owners |
| SQLite scale ceiling | High | Postgres cutover required for 1k+ users |
| MCP path ungated if enabled | High | Wire `executeSecuredTool` before MCP launch |
| Load unvalidated | High | Phase 10 soak tests before enterprise sales |

## 10. Remaining Blockers (Enterprise 95+)

| Blocker | Effort | Owner |
|---------|--------|-------|
| Postgres runtime cutover + RLS | 2–3 weeks | Infra |
| Full tenant migration (`user_id` → `org_id`) | 1 week | Backend |
| UI dual-control approval workflow | 1 week | Frontend |
| WS rate limiting | 2 days | Backend |
| Load/chaos suite (100–10k users) | 1 week | SRE |
| External pen test | 2 weeks | Security |
| MCP gateway wiring | 2 days | Backend |

## Scores (Post-V9, Clean Tenant)

| Metric | Score | Notes |
|--------|-------|-------|
| Security | **88** | Bypass closed; dual-control; replay prevention |
| Trust | **86** | Anti-poisoning; provenance; weighted truth |
| Reliability | **82** | Debounced truth; transactions; SQLite limit |
| Enterprise Readiness | **78** | Postgres, load proof, external red team remain |

Target 95+ requires completing remaining blockers above.

## Enterprise Acceptance (Would X trust this?)

| Company | Trust today? | Blocker |
|---------|--------------|---------|
| Stripe | No | Postgres/RLS, external pen test, load proof |
| Linear | No | Dual-control UI, tenant migration complete |
| Notion | No | Memory provenance UI, scale validation |
| Brex | No | SOC2 mapping, dual-control SoD evidence |
| Ramp | No | Chaos testing, LLM cost controls on WS |
| Anthropic | Partial | Injection + output firewall strong; agent paths gated |
| OpenAI | Partial | Claim validation improved; needs human-in-loop product path |
