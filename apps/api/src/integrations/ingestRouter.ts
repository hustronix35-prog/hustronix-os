import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

/**
 * Ingest Router — the single, normalized entry point for every external signal
 * source. Slack / GitHub / Jira / CRM / Meeting / manual all funnel through
 * this module so we get one place for:
 *
 *   - Idempotency (per-source `external_id` dedup)
 *   - Tenant resolution (provider team_id -> hustronix user_id)
 *   - Source enum mapping (provider -> SOURCE_BUCKETS)
 *   - Schema-stable `external_signals` insert
 *   - Triggering of the existing intelligence pipeline (auditor.onWrite)
 *
 * Everything downstream (detector, enricher, auto-linker, hybrid search,
 * operational queries, reports) consumes the resulting `external_signals` row,
 * so we never branch on source past this layer. New providers add a transform
 * in `webhookTransforms.ts` and call `ingestExternal` here.
 *
 * What this is NOT:
 *   - Not a queue. SQLite is fast enough for our throughput; if we ever
 *     outgrow it we can swap the in-process call for a BullMQ/SQS push and
 *     keep the same API.
 *   - Not a scheduler. Cron only does drift sweeps; ingest is event-driven.
 *   - Not a knowledge graph. We never enrich entities here — see `enrich.ts`.
 */

/**
 * Source buckets the schema CHECK constraint allows after the Phase 5
 * migration. Every new provider gets its own bucket so dashboards can group
 * by source cleanly without parsing `source_subtype`.
 */
export type IngestSource =
  | "SLACK"
  | "GITHUB"
  | "JIRA"
  | "MICROSOFT"
  | "GOOGLE"
  | "GMAIL"
  | "NOTION"
  | "LINEAR"
  | "MANUAL";

/** Provider id -> source bucket. Anything not listed defaults to MANUAL. */
const SOURCE_BUCKETS: Record<string, IngestSource> = {
  slack: "SLACK",
  github: "GITHUB",
  jira: "JIRA",
  microsoft: "MICROSOFT",
  google: "GOOGLE",
  gmail: "GMAIL",
  notion: "NOTION",
  linear: "LINEAR",
  meeting: "MANUAL",
  zoom: "MANUAL",
  meet: "MANUAL",
  hubspot: "MANUAL",
  salesforce: "MANUAL",
  pipedrive: "MANUAL",
  crm: "MANUAL",
  email: "MANUAL",
  manual: "MANUAL",
};

export interface IngestRecord {
  /** Provider key, e.g. `github`, `jira`, `hubspot`, `meeting`. Maps to a bucket. */
  provider: string;
  /** Optional finer-grain subtype, e.g. `github.pull_request.opened`, `meeting.commitment`. */
  subtype?: string;
  /** Tenant scope. `null` means "unknown — let resolver figure it out". */
  userId: string | null;
  /** Provider-side opaque tenant key (team_id, repo, workspace). Used for dedup partitioning. */
  tenantKey?: string;
  /** Human-readable signal text — what the auditor + detector reason over. */
  content: string;
  /** Stable owner string, e.g. `slack:U123`, `github:octocat`, `meeting:alice@hx.com`. */
  owner: string;
  /** Idempotency key from the upstream provider. If duplicate, ingest is skipped. */
  externalId?: string;
  /** Optional ISO timestamp; otherwise `CURRENT_TIMESTAMP`. */
  detectedAt?: string;
  /** Free-form provider context (channel, repo, attendees…). Stored as JSON. */
  meta?: Record<string, unknown>;
}

export interface IngestResult {
  signalId: string;
  duplicate: boolean;
  source: IngestSource;
  subtype: string | null;
}

function bucketFor(provider: string): IngestSource {
  return SOURCE_BUCKETS[provider.toLowerCase()] ?? "MANUAL";
}

/**
 * Resolve a tenant for the ingest call. Order:
 *   1. Explicit `userId`.
 *   2. (slack only) `oauth_connections` lookup via `tenantKey` (team_id).
 *   3. `system` tenant — caller MUST be authenticated as system or we won't
 *      be in this branch.
 *
 * Returns null if no tenant can be resolved (caller should drop the signal
 * with a no-op 200 to avoid leaking the existence of unmapped tenants).
 */
export function resolveTenant(rec: IngestRecord): string | null {
  if (rec.userId && rec.userId.trim()) return rec.userId.trim();
  if (rec.provider.toLowerCase() === "slack" && rec.tenantKey) {
    const t = db.getSlackTenantForTeam(rec.tenantKey);
    if (t) return t.user_id;
  }
  /** Fallback: assume system tenant only when explicitly authorized; caller must opt-in. */
  return null;
}

/**
 * Insert one normalized record. Returns existing signalId on duplicate
 * `external_id`; never throws on dedup. Throws on schema/DB failure so the
 * webhook caller can return 500 and let the provider retry.
 */
export function ingestExternal(
  rec: IngestRecord,
  opts: { allowSystemFallback?: boolean } = {},
): IngestResult {
  const userId = resolveTenant(rec) ?? (opts.allowSystemFallback ? "system" : null);
  if (!userId) {
    throw new IngestError("no_tenant", `No tenant for provider=${rec.provider} key=${rec.tenantKey ?? "(none)"}`);
  }

  const source = bucketFor(rec.provider);
  const subtype = rec.subtype ?? rec.provider.toLowerCase();

  /** Generic per-source idempotency. Slack still uses its own slack_event_receipts table for legacy reasons. */
  if (rec.externalId) {
    const isDup = !db.tryInsertExternalEventId(source, rec.externalId, rec.tenantKey ?? "");
    if (isDup) {
      const existing = findExistingByExternalId(source, rec.externalId);
      return {
        signalId: existing?.id ?? "(unknown)",
        duplicate: true,
        source,
        subtype,
      };
    }
  }

  const id = uuidv4();
  const ingestMeta = rec.meta ? safeJson({ ...rec.meta, provider: rec.provider }) : safeJson({ provider: rec.provider });

  db.insertExternalSignal({
    id,
    userId,
    source,
    content: rec.content.trim(),
    owner: rec.owner,
    detectedAt: rec.detectedAt,
    sourceSubtype: subtype,
    externalId: rec.externalId,
    ingestMeta,
  });

  return { signalId: id, duplicate: false, source, subtype };
}

/** Bulk variant. Reports per-record failures without aborting the batch. */
export function ingestExternalBatch(
  records: IngestRecord[],
  opts: { allowSystemFallback?: boolean } = {},
): { results: IngestResult[]; errors: { record: IngestRecord; error: string }[] } {
  const results: IngestResult[] = [];
  const errors: { record: IngestRecord; error: string }[] = [];
  for (const r of records) {
    try {
      results.push(ingestExternal(r, opts));
    } catch (e) {
      errors.push({ record: r, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results, errors };
}

function findExistingByExternalId(source: IngestSource, externalId: string): { id: string } | null {
  const r = db.rawGet(
    `SELECT id FROM external_signals WHERE source = ? AND external_id = ? LIMIT 1`,
    [source, externalId],
  ) as { id: string }[];
  return r[0] ?? null;
}

function safeJson(o: unknown): string {
  try {
    return JSON.stringify(o);
  } catch {
    return "{}";
  }
}

export class IngestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}
