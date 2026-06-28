# Belief Engine

**Beliefs** are assumptions distinct from verified **facts**. They attach to strategy/market entities and evolve with evidence.

## Schema

- `beliefs` — statement, status (`PROPOSED` | `CONFIRMED` | `REFUTED` | `SUPERSEDED`), dynamic confidence, factors JSON
- `belief_evidence` — typed links (`SUPPORTS` | `CONTRADICTS` | `OBSERVED_IN`)

## Lifecycle

1. **Promotion** — on ACTIVE decision commit, `ranked_hypotheses` from institutional v3 memos become beliefs.
2. **Evidence** — `applyEvidence()` recomputes confidence via `computeDynamicConfidence()`.
3. **Conflict** — contradicting evidence on a `CONFIRMED` belief emits `BELIEF_CONFLICT` auditor signal.

## APIs

- `GET /api/beliefs` — list tenant beliefs (optional `?status=`)
- `GET /api/beliefs/:id/explain` — confidence factors + evidence chain (mirrors memory fact explain)

## Module

`apps/api/src/beliefs/belief-engine.ts`

## Compression

Weekly job may surface high-confidence beliefs as doctrine **candidates** (human review required).
