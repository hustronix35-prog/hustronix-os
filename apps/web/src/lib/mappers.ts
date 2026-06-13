import type { ExecutionRow, Signal, SignalSource } from "@/data/types";
import { formatRelativeAgo } from "@/lib/parse-api-date";

export type ApiExecution = {
  task_id: string;
  owner: string;
  weight?: number;
  status: string;
  success_condition: string | null;
  failure_condition: string | null;
  blocked_reasons: string | null;
  last_update?: string;
  decision_vow?: string;
};

export type ApiSignal = {
  id: string;
  source: string;
  content: string | null;
  owner?: string | null;
  detected_at: string;
  grace_expires_at: string | null;
  state: string;
};

function ownerInitials(owner: string): string {
  const p = owner.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return `${p[0][0]!}${p[1][0]!}`.toUpperCase();
  return owner.slice(0, 2).toUpperCase() || "—";
}

/** When the task was last listed/updated in the execution ledger. */
function formatListedAt(iso?: string): { due: string; dueTone: ExecutionRow["dueTone"] } {
  const { label, tone } = formatRelativeAgo(iso);
  return { due: label, dueTone: tone };
}

function mapExecStatus(db: string): ExecutionRow["status"] {
  if (db === "DONE" || db === "KILLED") return "COMPLETED";
  if (db === "ACTIVE") return "ACTIVE";
  if (db === "BLOCKED") return "BLOCKED";
  return "PENDING";
}

export function mapExecution(row: ApiExecution): ExecutionRow {
  const desc =
    row.failure_condition ||
    (row.blocked_reasons ? `Blocked: ${row.blocked_reasons}` : "") ||
    row.success_condition ||
    "—";
  const { due, dueTone } = formatListedAt(row.last_update);
  return {
    id: row.task_id,
    task: row.success_condition || row.task_id,
    description: desc,
    owner: row.owner,
    ownerInitials: ownerInitials(row.owner),
    weight: Number(row.weight ?? 1),
    status: mapExecStatus(row.status),
    due,
    dueTone,
    decision: row.decision_vow || "—",
  };
}

function mapSource(src: string): SignalSource {
  const u = src.toLowerCase();
  if (u === "slack") return "slack";
  if (u === "github") return "github";
  if (u === "jira") return "jira";
  return "notion";
}

function formatExpires(graceIso: string | null): string {
  if (!graceIso) return "—";
  const end = new Date(graceIso).getTime();
  if (Number.isNaN(end)) return graceIso;
  const sec = Math.max(0, Math.floor((end - Date.now()) / 1000));
  if (sec <= 0) return "Expired";
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function categoryForSource(s: SignalSource): string {
  if (s === "slack") return "User Report";
  if (s === "github") return "Code Change";
  if (s === "jira") return "Bug Report";
  return "Doc Update";
}

function formatReceivedShort(iso: string): string {
  return formatRelativeAgo(iso).label;
}

export function mapSignal(row: ApiSignal): Signal {
  const title = (row.content || "").slice(0, 80) || row.id;
  const source = mapSource(row.source);
  return {
    id: row.id,
    title,
    description: row.content || "",
    source,
    author: row.owner || undefined,
    categoryTag: categoryForSource(source),
    received: formatReceivedShort(row.detected_at),
    detectedAt: row.detected_at,
    graceEndsAt: row.grace_expires_at,
    expiresLabel: formatExpires(row.grace_expires_at),
    urgent: row.state === "GRACE",
  };
}
