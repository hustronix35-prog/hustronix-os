# Temporal State

Hustronix answers **past**, **current**, and **future** organizational truth.

| Mode | Source | Questions |
|------|--------|-----------|
| Past | `organization_state_versions` + ledger history | What changed? What was true last month? |
| Current | Latest `OrganizationState` compile | Operational truth |
| Future | Causal simulator projections | What if we increase prices? |

## APIs

- `GET /api/state/versions` — version history
- `GET /api/state/diff?v1=&v2=` — entity-level diff between versions
- `getStateAt(tenantId, timestamp)` — nearest version ≤ t (`apps/api/src/state/temporal.ts` when enabled)

## Context routing

Adaptive context builder loads temporal slices when queries contain temporal intent ("last quarter", "since commit", "what changed").

## Rollback

`POST /api/state/rollback?toVersion=` restores a prior snapshot (owner-only, audited `STATE_ROLLBACK`).
