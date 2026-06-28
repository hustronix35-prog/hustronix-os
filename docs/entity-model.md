# Entity Model

The **Company Brain** is entity-centric: signals, facts, beliefs, and outcomes attach to typed entities.

## Entity types

`company`, `team`, `decision`, `task`, `customer`, `competitor`, `metric`, `feature`, `commitment`, `meeting`, `person`, `project`

## Storage

- Table: `entities` (`tenant_id`, `type`, `label`, `ref_id`, `metadata_json`, `confidence`, `freshness_at`)
- Relationships: `evidence_edges` (and incremental graph patches)

## Rules

1. Every durable knowledge item links to ≥1 entity (directly or via `ref_id` on ledger rows).
2. Organization state is a **projection** over the entity subgraph.
3. Auto-link scoring prioritizes entity overlap.

## APIs

- `GET /api/entities`
- `GET /api/entities/:id/neighbors`
- `GET /api/entities/:id/timeline`

## Confidence

Entity `confidence` uses `computeDynamicConfidence()` — evidence count, source quality, decay, contradiction penalty, freshness, human verification boost. Explain factors in `/explain` endpoints.
