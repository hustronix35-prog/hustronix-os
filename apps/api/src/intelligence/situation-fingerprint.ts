/**
 * Situation identity: tenant + pattern + primary entity + causal cluster.
 * Cluster is an operational thread, not extra pattern keywords.
 */
export type CausalCluster = "renewal" | "implementation" | "billing" | "quality" | "";

type Thread = { id: Exclude<CausalCluster, "">; re: RegExp };

const THREADS: Thread[] = [
  { id: "implementation", re: /\bimplementation\b|\bconnector\b|\bgo-live\b|\bonboarding\b|milestone slipped|siem export/i },
  { id: "billing", re: /\bbilling\b|\binvoice\b|\bdispute\b|\boverage charge\b/i },
  { id: "quality", re: /\bproduct quality\b|\bquality issue\b|\bdefect density\b/i },
  { id: "renewal", re: /\brenewal\b|\bchurn\b|health score|alternative vendor|executive sponsor|sponsor stopped/i },
];

export function detectCausalThreads(content: string): Exclude<CausalCluster, "">[] {
  const text = String(content || "");
  const hits: Exclude<CausalCluster, "">[] = [];
  for (const t of THREADS) {
    if (t.re.test(text) && !hits.includes(t.id)) hits.push(t.id);
  }
  return hits;
}

/**
 * Identity cluster for a new situation.
 * Renewal/churn stays the default (empty) identity so existing entity isolation is unchanged.
 * Distinct operational threads (implementation, billing, …) get their own cluster.
 */
export function inferCausalCluster(content: string): CausalCluster {
  const threads = detectCausalThreads(content);
  const exclusive = threads.filter((t) => t !== "renewal");
  if (exclusive.length === 1 && !threads.includes("renewal")) return exclusive[0];
  return "";
}

/** Clusters this signal may attach to (mixed linking signals join both threads). */
export function clustersForSignal(content: string): CausalCluster[] {
  const threads = detectCausalThreads(content);
  const exclusive = threads.filter((t) => t !== "renewal") as CausalCluster[];
  if (exclusive.length === 1 && !threads.includes("renewal")) return exclusive;
  const out = new Set<CausalCluster>([""]);
  for (const e of exclusive) out.add(e);
  return [...out];
}

export function causalContextCompatible(situationCluster: string | null | undefined, content: string): boolean {
  const sit = (situationCluster || "") as CausalCluster;
  return clustersForSignal(content).includes(sit);
}

/** sim_day or YYYYMMDD — reject attachments that are not temporally plausible. */
export function temporalRelationshipPlausible(
  situationDay: number | null | undefined,
  signalDay: number | null | undefined,
  maxSpan = 90,
): boolean {
  if (situationDay == null || signalDay == null) return true;
  const a = Number(situationDay);
  const b = Number(signalDay);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (a > 20000101 && b > 20000101) {
    const ad = ymdToUtc(a);
    const bd = ymdToUtc(b);
    if (!ad || !bd) return true;
    return Math.abs(ad.getTime() - bd.getTime()) <= maxSpan * 86400000;
  }
  return Math.abs(a - b) <= maxSpan;
}

function ymdToUtc(n: number): Date | null {
  const s = String(n);
  if (s.length !== 8) return null;
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function situationTitleForCluster(
  patternTitle: string,
  entityLabel: string | null | undefined,
  cluster: string,
): string {
  const who = entityLabel ? ` — ${entityLabel}` : "";
  if (cluster === "implementation") return `Implementation delay${who}`;
  if (cluster === "billing") return `Billing dispute${who}`;
  if (cluster === "quality") return `Product quality${who}`;
  return entityLabel ? `${patternTitle} — ${entityLabel}` : patternTitle;
}

export type AttachDecision = {
  attach: boolean;
  reason: string;
};

/**
 * Evidence attaches only when entity, pattern, causal context, and time all agree.
 */
export function shouldAttachEvidence(opts: {
  entityCompatible: boolean;
  patternCompatible: boolean;
  situationCluster: string | null | undefined;
  content: string;
  situationDay?: number | null;
  signalDay?: number | null;
}): AttachDecision {
  if (!opts.entityCompatible) return { attach: false, reason: "entity_mismatch" };
  if (!opts.patternCompatible) return { attach: false, reason: "pattern_mismatch" };
  if (!causalContextCompatible(opts.situationCluster, opts.content)) {
    return { attach: false, reason: "causal_mismatch" };
  }
  if (!temporalRelationshipPlausible(opts.situationDay, opts.signalDay)) {
    return { attach: false, reason: "temporal_mismatch" };
  }
  return { attach: true, reason: "compatible" };
}
