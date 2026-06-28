# Organization State

Hustronix compiles **OrganizationState** as a deterministic projection over the entity graph, decision ledger, memory facts, beliefs, and doctrine — not free-form chat memory.

## Sections

Each section carries `confidence`, `freshness_at`, and typed `items`:

- `objectives`, `priorities`, `activeDecisions`, `blockers`, `commitments`, `risks`
- `facts` (VERIFIED memory only), `beliefs`, `doctrine`, `externalContext`
- `teams[]` capacity slice
- `meta.version` monotonic compile version

## Incremental patches

Ledger events debounce (500ms) into `patchOrganizationState()` — O(affected entities), not full-org recompile.

Full rebuild: `POST /api/state/rebuild` (owner) or corruption recovery.

## Domain merge (Phase 4)

Specialist agents write **`domain_state_patches`** (`engineering`, `sales`, `marketing`). `mergeDomainStates()` applies patches with:

1. Constitutional **doctrine** wins over domain prose
2. **ACTIVE** decision precedence over domain blockers

Coordinator compiles merged state for prompts via `formatOrganizationStateForPrompt()`.

## Versioning

`organization_state_versions` stores Git-like snapshots with parent diff. APIs:

- `GET /api/state/current`
- `GET /api/state/versions`
- `GET /api/state/diff?v1=&v2=`
- `POST /api/state/rollback?toVersion=` (owner, audited)

## Digital twin (Phase 5)

`computeDigitalTwin()` attaches team metrics (morale, velocity, focus, communication load, dependency risk, learning rate) to state responses where exposed.
