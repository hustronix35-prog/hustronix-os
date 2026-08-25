/**
 * Canonical evidence object for Talk, Teams, situation detail, memos, and audit.
 * One representation: Claim → Situation → Evidence → Signal → Source → Timestamp.
 */
import { db } from "../database.js";

export type EvidenceReference = {
  signalId: string;
  source: string;
  sourceLocation: string | null;
  timestamp: string | null;
  author: string | null;
  snippet: string;
  facet: string | null;
  confidence: number;
};

const SOURCE_LABEL: Record<string, string> = {
  SLACK: "Slack",
  GITHUB: "GitHub",
  JIRA: "Jira",
  MICROSOFT: "Microsoft 365",
  GOOGLE: "Google",
  GMAIL: "Gmail",
  NOTION: "Notion",
  LINEAR: "Linear",
  MANUAL: "Manual",
  CRM: "CRM",
  MEETING: "Meeting",
  INCIDENT: "Incident",
  HRIS: "HRIS",
  FINANCE: "Finance",
};

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sourceLabel(source: string | null | undefined): string {
  const key = String(source || "").toUpperCase();
  return SOURCE_LABEL[key] || (source ? String(source) : "Signal");
}

function formatTimestamp(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : String(ts);
  }
  return d.toISOString();
}

export function formatEvidenceWhen(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function locationFromMeta(meta: Record<string, unknown>, owner: string | null): string | null {
  const channel =
    meta.channel ||
    meta.channel_name ||
    meta.slack_channel ||
    meta.repo ||
    meta.project ||
    meta.space ||
    meta.location;
  if (typeof channel === "string" && channel.trim()) {
    const c = channel.trim();
    return c.startsWith("#") || c.includes("/") ? c : `#${c}`;
  }
  if (owner && /#\w+/.test(owner)) {
    const m = owner.match(/#\w+/);
    return m ? m[0] : owner;
  }
  return null;
}

export function toEvidenceReference(row: {
  signal_id?: string | null;
  id?: string | null;
  source?: string | null;
  owner?: string | null;
  content?: string | null;
  snippet?: string | null;
  facet?: string | null;
  weight?: number | null;
  detected_at?: string | null;
  received_at?: string | null;
  ingest_meta?: string | null;
}): EvidenceReference {
  const meta = parseMeta(row.ingest_meta);
  const snippet = String(row.snippet || row.content || "")
    .replace(/\s+/g, " ")
    .trim();
  const ts = row.detected_at || row.received_at || (typeof meta.occurred_at === "string" ? meta.occurred_at : null);
  const author =
    (typeof meta.author === "string" && meta.author) ||
    (typeof meta.user === "string" && meta.user) ||
    row.owner ||
    null;
  const weight = row.weight != null ? Number(row.weight) : 1;
  return {
    signalId: String(row.signal_id || row.id || ""),
    source: sourceLabel(row.source),
    sourceLocation: locationFromMeta(meta, row.owner || null),
    timestamp: formatTimestamp(ts),
    author,
    snippet: snippet.slice(0, 240),
    facet: row.facet || null,
    confidence: Math.max(0, Math.min(1, Number.isFinite(weight) ? weight : 1)),
  };
}

/** Human line: Slack #engineering · Aug 17 — “snippet” */
export function formatEvidenceLine(ev: EvidenceReference): string {
  const loc = ev.sourceLocation ? ` ${ev.sourceLocation}` : "";
  const when = formatEvidenceWhen(ev.timestamp);
  const head = `${ev.source}${loc}${when ? ` · ${when}` : ""}`;
  const quote = ev.snippet ? `“${ev.snippet.slice(0, 160)}”` : ev.signalId;
  return `${head} — ${quote}`;
}

export function loadEvidenceReferences(situationId: string, limit = 12): EvidenceReference[] {
  const rows = db.rawGet(
    `SELECT se.signal_id, se.facet, se.weight, se.snippet,
            s.source, s.owner, s.content, s.detected_at, s.received_at, s.ingest_meta
       FROM situation_evidence se
       LEFT JOIN external_signals s ON s.id = se.signal_id
      WHERE se.situation_id = ?
      ORDER BY COALESCE(s.detected_at, s.received_at, se.created_at) ASC
      LIMIT ?`,
    [situationId, limit],
  ) as Array<{
    signal_id: string;
    facet: string | null;
    weight: number | null;
    snippet: string | null;
    source: string | null;
    owner: string | null;
    content: string | null;
    detected_at: string | null;
    received_at: string | null;
    ingest_meta: string | null;
  }>;
  return rows.map(toEvidenceReference);
}

export function loadEvidenceReferencesBySignalIds(signalIds: string[], limit = 8): EvidenceReference[] {
  const ids = [...new Set(signalIds.map(String).filter(Boolean))].slice(0, limit);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.rawGet(
    `SELECT id, source, owner, content, detected_at, received_at, ingest_meta
       FROM external_signals WHERE id IN (${placeholders})`,
    ids,
  ) as Array<{
    id: string;
    source: string | null;
    owner: string | null;
    content: string | null;
    detected_at: string | null;
    received_at: string | null;
    ingest_meta: string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => toEvidenceReference({ ...r!, signal_id: r!.id, snippet: r!.content }));
}
