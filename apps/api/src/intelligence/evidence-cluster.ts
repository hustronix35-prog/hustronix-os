/**
 * Evidence cluster metrics for a Situation — coverage, not just signal count.
 * Distinct days come from the live event timeline. sim_day is test-only metadata.
 */
import { db } from "../database.js";

export type EvidenceCluster = {
  evidence_count: number;
  facet_count: number;
  facets: string[];
  distinct_days: number;
  source_count: number;
  sources: string[];
  entity_count: number;
  entities: string[];
  people: string[];
  timeline: Array<{ day: number | null; facet: string | null; snippet: string }>;
  coverage_score: number;
  /** 0–1 share of evidence that contradicts the dominant trajectory. */
  contradiction_score: number;
  /** Average evidence weight. */
  avg_weight: number;
  temporal_span_days: number;
  supporting_count: number;
  contradicting_count: number;
};

function calendarDayKey(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(`${m[1]}${m[2]}${m[3]}`);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return Number(`${y}${mo}${da}`);
}

/** Production uses detected_at / received_at. sim_day is counted only when tests supply it. */
export function evidenceDayKey(row: {
  sim_day?: number | null;
  detected_at?: string | null;
  received_at?: string | null;
}): number | null {
  const sim = row.sim_day != null ? Number(row.sim_day) : NaN;
  if (Number.isFinite(sim) && sim > 0) return sim;
  return calendarDayKey(row.detected_at) ?? calendarDayKey(row.received_at);
}

export function buildEvidenceCluster(
  userId: string,
  situationId: string,
  facetTarget: number,
): EvidenceCluster {
  const evidence = db.rawGet(
    `SELECT se.signal_id, se.facet, se.sim_day, se.snippet, se.weight, s.source, s.owner,
            s.detected_at, s.received_at
     FROM situation_evidence se
     LEFT JOIN external_signals s ON s.id = se.signal_id
     WHERE se.situation_id = ?
     ORDER BY COALESCE(s.detected_at, s.received_at, se.created_at) ASC`,
    [situationId],
  ) as Array<{
    signal_id: string;
    facet: string | null;
    sim_day: number | null;
    snippet: string | null;
    weight: number | null;
    source: string | null;
    owner: string | null;
    detected_at: string | null;
    received_at: string | null;
  }>;

  const facets = new Set<string>();
  const days = new Set<number>();
  const sources = new Set<string>();
  const people = new Set<string>();
  let weightSum = 0;
  let improveN = 0;
  let worsenN = 0;
  for (const e of evidence) {
    if (e.facet) {
      for (const p of e.facet.split(",")) {
        const f = p.trim();
        if (f && f !== "keyword") facets.add(f);
      }
    }
    const day = evidenceDayKey(e);
    if (day != null) days.add(day);
    if (e.source) sources.add(String(e.source).toLowerCase());
    if (e.owner) people.add(e.owner);
    weightSum += e.weight != null ? Number(e.weight) : 1;
    const sn = (e.snippet || "").toLowerCase();
    if (/resolved|restored|fixed|closed|mitigated|cleared|on track|recover|improving|confirmed improvement/.test(sn)) {
      improveN += 1;
    }
    if (/blocked|delay|risk|fail|breach|drop|slip|escalat|complaint|outage|worsen/.test(sn)) {
      worsenN += 1;
    }
  }

  const ents = db.rawGet(
    `SELECT entity_label, entity_type FROM situation_entities WHERE situation_id = ?`,
    [situationId],
  ) as { entity_label: string; entity_type: string }[];

  const timeline = evidence.slice(0, 20).map((e) => ({
    day: evidenceDayKey(e),
    facet: e.facet,
    snippet: (e.snippet || "").slice(0, 160),
  }));

  const dayList = [...days].sort((a, b) => a - b);
  const temporal_span_days =
    dayList.length >= 2 ? dayList[dayList.length - 1] - dayList[0] : dayList.length ? 1 : 0;

  const facetCov = Math.min(1, facets.size / Math.max(facetTarget, 1));
  const dayCov = Math.min(1, days.size / 4);
  const srcCov = Math.min(1, sources.size / 3);
  const chainCov = Math.min(1, temporal_span_days / 10);
  const coverage_score =
    Math.round((0.4 * facetCov + 0.2 * dayCov + 0.2 * srcCov + 0.2 * chainCov) * 1000) / 1000;

  const totalPolar = improveN + worsenN;
  const contradiction_score =
    totalPolar > 0 ? Math.min(1, (Math.min(improveN, worsenN) * 2) / totalPolar) : 0;

  return {
    evidence_count: evidence.length,
    facet_count: facets.size,
    facets: [...facets],
    distinct_days: days.size,
    source_count: sources.size,
    sources: [...sources],
    entity_count: ents.length,
    entities: ents.map((e) => e.entity_label),
    people: [...people].slice(0, 16),
    timeline,
    coverage_score,
    contradiction_score: Math.round(contradiction_score * 1000) / 1000,
    avg_weight: evidence.length ? Math.round((weightSum / evidence.length) * 100) / 100 : 0,
    temporal_span_days,
    supporting_count: Math.max(improveN, worsenN),
    contradicting_count: Math.min(improveN, worsenN),
  };
}
