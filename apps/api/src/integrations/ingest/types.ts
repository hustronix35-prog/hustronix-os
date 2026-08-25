/**
 * Evidence envelope — Nango/adapter → Hustronix ingest boundary.
 * Provider-independent; Nango (or any future integration runtime) is replaceable.
 * See docs/nango-to-signals-architecture.md.
 */

export type EvidenceActor = {
  id: string;
  display?: string;
};

export type EvidenceEnvelope = {
  /** Hustronix tenant (user_id today). */
  tenantId: string;
  /** Local nango_connections.id */
  connectionId: string;
  /** Remote Nango connection id */
  nangoConnectionId: string;
  provider: string;
  sourceType: string;
  externalId: string;
  occurredAt?: string;
  receivedAt: string;
  actor?: EvidenceActor;
  /** Opaque provider/sync payload — immutable evidence. */
  content: unknown;
  /** Human-readable line for ledger + detectors. */
  displayText: string;
  metadata?: {
    sourceSubtype?: string;
    syncId?: string;
    model?: string;
    cursor?: string;
    entity_type?: string;
    entity_id?: string;
    event?: string;
    previous?: string | null;
    current?: string | null;
    owner?: string;
    feature_hint?: string;
    aliases?: string[];
    /** Integration runtime stamp. Default `nango` when omitted. */
    runtime?: string;
  };
};
