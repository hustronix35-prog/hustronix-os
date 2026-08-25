# Nango → Evidence Ledger → Intelligence Architecture

**Status:** Implementation contract (approved)  
**Quality target:** ~9.5/10 with the boundary below

---

## Invariants (non-negotiable)

1. **Nango is integration infrastructure.** It owns OAuth, credentials, refresh, webhooks, polling, incremental sync, retries, rate limits, and integration observability.

2. **`external_signals` is the Hustronix evidence ledger.** It is the only long-term store of captured external evidence for the product.

3. **The Company Brain is derived organizational knowledge** built from Hustronix evidence — never from Nango’s record cache or provider APIs directly.

4. **Intelligence operates only on Hustronix evidence.** Detectors, enrichers, linkers, EIE, and org-truth never query Nango or provider APIs as their source of truth.

5. **Provider integrations may change how evidence is acquired, but must never change how evidence is interpreted, linked, governed, or converted into decisions.**

6. **Signals never auto-create ACTIVE decisions.** Chain: signal → (optional) execution link → human/gated decision commit.

7. **Nango is replaceable.**  
   > **Nango failure must never destroy or invalidate Hustronix evidence. Nango is replaceable integration infrastructure; `external_signals` and everything derived from it must remain portable and provider-independent.**

```text
                 NANGO
                   │
                   │ replaceable
                   ▼
             IngestRecord / envelope
                   │
                   ▼
          external_signals
                   │
       ┌───────────┴───────────┐
       ▼                       ▼
 Company Brain          Decision System
```

If Nango is replaced, self-hosted, or swapped for a specialized connector, the intelligence architecture does not change. The permanent seam is `ingestExternal()`.

### Claim-ready ingest (not claim-producing)

Adapters understand **provider structure**. Reconciliation understands **organizational meaning**. Every ingest row should carry structured `ingest_meta`:

```text
entity_type, entity_id, event, previous, current, owner, feature_hint, aliases?
```

Recon then upserts claims on a canonical entity (P1: `feature:{slug}` + `entity_aliases`). Do not emit semantic claims inside Slack/GitHub/Jira adapters.

Meaning path (after `processSignal` enrich):

```text
external_signals → extractClaimsHeuristic → claims/conflicts/entity_state_snapshots
                 → compileOrganizationState (risks/blockers/commitments from snapshots)
                 → Decide (decision-required) / Brain UI
```

Phase 1 proof is the **meaning vertical slice** (Slack + GitHub + Jira/Linear + Meetings), not a larger connector catalog. See [`signal-conflict-reconciliation-phase1.md`](./signal-conflict-reconciliation-phase1.md).

---

## Canonical stack

```text
EXTERNAL SYSTEMS
  Slack · Gmail · Calendar · GitHub · Jira · Linear · Notion · CRM · …
        │
        ▼
     NANGO
  OAuth · credentials · refresh · webhooks · polling ·
  incremental sync · retries · rate limits · observability
        │
        ▼
 HUSTRONIX INGESTION
  verify → resolve tenant → normalize → dedupe
        │
        ▼
 EXTERNAL SIGNAL LEDGER  (source of truth for evidence)
        │
        ▼
 SIGNAL INTELLIGENCE     (progressive — not every skill on every row)
  trust → classify → extract → enrich → (optional deep path)
        │
        ▼
 COMPANY BRAIN
  entities · evidence · goals · risks · dependencies · owners
        │
        ▼
 DECISION INTELLIGENCE
  risk · contradictions · predictions · recommendations · context
        │
        ▼
 GOVERNANCE
  human / gated approval
        │
        ▼
 EXECUTION LEDGER → OUTCOME → LEARNING
```

---

## Ownership

| Layer | Owns |
|-------|------|
| **Nango** | Auth, tokens, sync, provider webhooks, retries, rate limits, integration observability |
| **Hustronix** | Org/user ↔ connection mapping, signal semantics, trust/detect/enrich, entities/evidence, decisions, execution, governance |

**Nango is not:** signal store, Company Brain, vector store, or universal business schema.

**Do not** stack `Nango Sync DB → Hustronix Sync DB → external_signals`. Fetch from Nango after webhook, write evidence into `external_signals`, treat Nango’s cache as ephemeral.

---

## Sacred ingest seam

### Webhook

`POST /api/nango/webhook` (alias conceptually: `/api/integrations/nango/webhook`)

```text
receive → verify signature → ACK 200 → async dispatch
  → listRecords (cursor) → ProviderAdapter → envelope → ingestExternal()
```

Never run the full intelligence pipeline inside the webhook request.

### Permanent Hustronix API

`ingestExternal()` / `ingestExternalBatch()` in `apps/api/src/integrations/ingestRouter.ts`.

Provider-specific code lives only in thin adapters under `apps/api/src/integrations/adapters/`.

### Thin evidence envelope (Nango → adapter output)

No giant unified SlackMessage/GmailMessage/JiraIssue schema. Opaque `content` plus identity fields:

```ts
type EvidenceEnvelope = {
  tenantId: string;
  connectionId: string;       // Hustronix connections.id (or nango_connections.id)
  nangoConnectionId: string;  // remote id in Nango
  provider: string;
  sourceType: string;
  externalId: string;
  occurredAt?: string;
  receivedAt: string;
  actor?: { id: string; display?: string };
  content: unknown;
  displayText: string;        // human-readable line for ledger + detectors
  metadata?: {
    sourceSubtype?: string;
    syncId?: string;
    model?: string;
    cursor?: string;
  };
};
```

Adapters map envelopes into today’s `IngestRecord` (`userId`, `content`, `owner`, `externalId`, `meta`) until the ledger schema fully absorbs the split below.

---

## Evidence vs interpretation

| Axis | Fields |
|------|--------|
| Source identity | `provider`, `connection_id`, `external_id`, `source_type`, `source_subtype` |
| Source event | `occurred_at`, `received_at`, `actor`, `content`, `metadata` |
| Interpretation | `signal_type`, `intent`, `risk`, `urgency`, `confidence`, `op_classification`, … |
| Governance | `trust_state`, `processing_state`, `actionability_state`, `resolution_state`, `execution_link` |

**Source event is immutable evidence. Interpretation is mutable and reprocessable** when detectors change (`POST /api/intelligence/relink`, force reprocess).

### Target state model (replaces overloaded `UNVERIFIED`)

| Dimension | Values |
|-----------|--------|
| `processing_state` | `RECEIVED` → `PROCESSING` → `PROCESSED` \| `FAILED` |
| `actionability_state` | `UNTRIAGED` → `RELEVANT` \| `DISMISSED` \| `LINKED` |
| `resolution_state` | `ACTIVE` \| `SUPERSEDED` \| `RESOLVED` |

Until migrated, existing `state` (`UNVERIFIED` / `LINKED` / `KILLED`) continues to work; new writes should stash progressive fields in `ingest_meta` / enrichment columns where available.

---

## Progressive intelligence

### Layers

- **A — Signal understanding:** trust → classify → extract → enrich (“What is this?”)
- **B — Organizational understanding:** entity resolution → evidence linking → temporal → Company Brain (“What does this mean here?”)
- **C — Decision intelligence:** impact → risk/deps → context → recommendation → **human/gated** decision (“What should we do?”)

### Routing

```text
TRUST → CLASSIFY
  trivial  → store / stop
  relevant → enrich (+ FTS; embed only if worth indexing)
  critical → deep reason (link, EIE, org truth, decision context)
```

Embeddings are **not** mandatory on the hot path. Prefer FTS candidates → embedding rerank (`hybridSearch`).

### Auditor

Governs **execution consequences** (“Can this influence active execution?”), not raw message importance. Conceptually after understand/contextualize, before/at execution link.

---

## Connection model

One Hustronix linkage table (today: `nango_connections`; target name: `connections`):

```text
id, org_id?, user_id, provider, integration_id,
nango_connection_id (connection_id), status?, last_sync_at, created_at, updated_at
```

Nango remains authoritative for credentials. Hustronix is authoritative for which org/user the connection belongs to.

Do not keep first-party `oauth_connections` as a long-term peer once the Nango path is proven for each provider.

---

## Keep vs prune

### Keep

- `external_signals`, idempotency, tenant isolation
- `processSignal`, content-trust, detect, enrich, auto-link, hybrid search
- Evidence graph, temporal decision resolution, EIE, organizational truth
- Auditor + execution ledger + gated decision activation
- Invariant: signal ≠ ACTIVE decision

### Prune (after pilot proven)

- Custom OAuth token storage / crypto / refresh workers
- Provider webhook renewal, polling, watchers duplicated in Hustronix
- Per-provider ingest islands that bypass Nango → adapter → `ingestExternal`

**Transitional:** first-party Slack/GitHub/Google/… paths stay live until Phase 2 is proven for that provider.

---

## Implementation phases

| Phase | Prove |
|-------|--------|
| **1 Foundation** | Nango connect → connection mapping → webhook ACK → async sync dispatch (pilot: Slack) — **landed** |
| **2 Universal ingest** | `listRecords` → adapter → envelope → dedupe → `external_signals` (intelligence may already fire via auditor; do not deepen yet) — **Slack Message path proven in pilot test** |
| **3 Intelligence** | Progressive trust/detect/enrich routing |
| **4 Company Brain** | Entities · evidence · relationships |
| **5 Decision intelligence** | Risk · deps · context · recommendation |
| **6 Execution** | Gated decision → ledger → Auditor → outcome → learning |

---

## Slack pilot runbook (Phase 1 verify)

**Sync model:** Nango `messages-received` → records model **`Message`**  
**Repo sync:** [`nango-integrations/slack/syncs/messages-received.ts`](../nango-integrations/slack/syncs/messages-received.ts)  
**Adapter:** `apps/api/src/integrations/adapters/slack.ts`

### Automated proof (no Nango Cloud)

```bash
cd apps/api && npm run test:nango-slack-pilot
```

Asserts: `nango_connections` → `ingestNangoRecords` → `external_signals` with `ingest_meta.integration_runtime = "nango"`, idempotent dedupe, and evidence surviving deletion of the Nango connection row (replaceability).

### Live path

1. Configure `NANGO_SECRET_KEY` and public `NANGO_WEBHOOK_URL` → `/api/nango/webhook` (or `/api/integrations/nango/webhook`).
2. Enable/deploy Slack `messages-received` sync (model `Message`).
3. Connect Slack in os-ui Integrations.
4. Wait for sync webhook **or** call:
   ```http
   POST /api/nango/sync/process
   { "provider": "slack", "model": "Message", "syncName": "messages-received" }
   ```
5. Confirm ledger rows: `source = SLACK`, `ingest_meta` contains `integration_runtime: "nango"`.

First-party Slack Events API remains live until this path is trusted in production.

---

## Related code

| Area | Path |
|------|------|
| Nango routes / webhook | `apps/api/src/integrations/nango/` |
| Sync dispatcher | `apps/api/src/integrations/nango/dispatcher.ts` (`ingestNangoRecords`) |
| Adapters | `apps/api/src/integrations/adapters/` |
| Evidence envelope | `apps/api/src/integrations/ingest/` |
| Ingest seam | `apps/api/src/integrations/ingestRouter.ts` |
| Slack Nango sync | `nango-integrations/` |
| Pilot test | `ops/scripts/nango-slack-pilot.test.ts` |
| Intelligence | `apps/api/src/intelligence/` |
| Auditor | `apps/api/src/auditor.ts` |

See also: `docs/database-consistency-and-context.md` (SQLite as truth, snapshot vs context window, anti-hallucination), `docs/agents-and-slack-signals.md` (legacy Slack Events path), `docs/integration-backlog.md`, `nango-integrations/README.md`.
