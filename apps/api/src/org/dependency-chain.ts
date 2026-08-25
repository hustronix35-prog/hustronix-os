/**
 * Directed dependency graph over org_dependencies.
 * Canonical: from = waiter, to = blocker.
 */
import { db } from "../database.js";
import {
  loadEvidenceReferencesBySignalIds,
  type EvidenceReference,
} from "../intelligence/evidence-reference.js";

export type DependencyEdge = {
  id: string;
  fromTeam: string;
  toTeam: string;
  fromWork: string;
  toWork: string;
  status: string;
  edgeType: string;
  confidence: number;
  evidence: EvidenceReference[];
  situationId: string | null;
};

function normTeam(t: string): string {
  return String(t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseEvidenceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === "string" && v) return [v];
  } catch {
    if (raw.trim()) return [raw.trim()];
  }
  return [];
}

export function loadDependencyEdges(userId: string, limit = 200): DependencyEdge[] {
  const rows = db.rawGet(
    `SELECT id, from_team, from_work, to_team, to_work, status, edge_type,
            evidence_json, confidence_0_1, situation_id
       FROM org_dependencies WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC LIMIT ?`,
    [userId, limit],
  ) as Array<{
    id: string;
    from_team: string;
    from_work: string | null;
    to_team: string;
    to_work: string | null;
    status: string;
    edge_type: string | null;
    evidence_json: string | null;
    confidence_0_1: number | null;
    situation_id: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    fromTeam: r.from_team,
    toTeam: r.to_team,
    fromWork: r.from_work || "",
    toWork: r.to_work || "",
    status: r.status,
    edgeType: r.edge_type || "waits_on",
    confidence: r.confidence_0_1 != null ? Number(r.confidence_0_1) : 0.7,
    evidence: loadEvidenceReferencesBySignalIds(parseEvidenceIds(r.evidence_json)),
    situationId: r.situation_id || null,
  }));
}

/** Walk blockers upstream: waiter → blocker → blocker's blocker. */
export function walkUpstream(edges: DependencyEdge[], startTeam: string, maxHops = 8): DependencyEdge[] {
  const start = normTeam(startTeam);
  const byFrom = new Map<string, DependencyEdge[]>();
  for (const e of edges) {
    const k = normTeam(e.fromTeam);
    const list = byFrom.get(k) || [];
    list.push(e);
    byFrom.set(k, list);
  }
  const out: DependencyEdge[] = [];
  const seen = new Set<string>();
  let cur = start;
  for (let i = 0; i < maxHops; i++) {
    const next =
      (byFrom.get(cur) || []).find((e) => e.status !== "ON_TRACK" && e.evidence.length > 0) ||
      (byFrom.get(cur) || []).find((e) => e.status !== "ON_TRACK") ||
      (byFrom.get(cur) || [])[0];
    if (!next) break;
    const key = `${normTeam(next.fromTeam)}>${normTeam(next.toTeam)}`;
    if (seen.has(key)) break;
    seen.add(key);
    out.push(next);
    cur = normTeam(next.toTeam);
  }
  return out;
}

/** Teams that wait on this blocker, directly or through a chain. */
export function walkDownstream(edges: DependencyEdge[], blockerTeam: string, maxHops = 8): string[] {
  const blocker = normTeam(blockerTeam);
  const byTo = new Map<string, DependencyEdge[]>();
  for (const e of edges) {
    const k = normTeam(e.toTeam);
    const list = byTo.get(k) || [];
    list.push(e);
    byTo.set(k, list);
  }
  const out: string[] = [];
  const seen = new Set<string>([blocker]);
  const queue = [blocker];
  let hops = 0;
  while (queue.length && hops < maxHops) {
    hops += 1;
    const cur = queue.shift()!;
    for (const e of byTo.get(cur) || []) {
      const waiter = e.fromTeam;
      const key = normTeam(waiter);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(waiter);
      queue.push(key);
    }
  }
  return out;
}
