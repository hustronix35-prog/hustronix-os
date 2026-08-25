/**
 * Final situation coherence gate before minting a decision.
 * Additional AND on existing READY_GATES — never a substitute, never a bypass.
 */
import { db } from "../database.js";
import { buildEvidenceCluster } from "./evidence-cluster.js";
import { causalContextCompatible, detectCausalThreads } from "./situation-fingerprint.js";

export type CoherenceCheck = {
  ok: boolean;
  reasons: string[];
  checks: {
    evidence_sufficient: boolean;
    temporal_coherence: boolean;
    entity_coherence: boolean;
    causal_coherence: boolean;
    no_major_contradiction: boolean;
    impact_credible: boolean;
    required_facets: boolean;
  };
};

export function evaluateSituationCoherence(userId: string, situationId: string): CoherenceCheck {
  const sit = (
    db.rawGet(
      `SELECT id, user_id, pattern_id, primary_entity_key, causal_cluster, evidence_count,
              entities_json, teams_json, people_json, first_observed_day, last_updated_day, facets_json
         FROM situations WHERE id = ? AND user_id = ?`,
      [situationId, userId],
    ) as Array<{
      id: string;
      user_id: string;
      pattern_id: string;
      primary_entity_key: string | null;
      causal_cluster?: string | null;
      evidence_count: number;
      entities_json: string | null;
      teams_json: string | null;
      people_json: string | null;
      first_observed_day: number | null;
      last_updated_day: number | null;
      facets_json: string | null;
    }>
  )[0];

  const fail = (reasons: string[]): CoherenceCheck => ({
    ok: false,
    reasons,
    checks: {
      evidence_sufficient: false,
      temporal_coherence: false,
      entity_coherence: false,
      causal_coherence: false,
      no_major_contradiction: false,
      impact_credible: false,
      required_facets: false,
    },
  });
  if (!sit) return fail(["situation_missing"]);

  const cluster = buildEvidenceCluster(userId, situationId, 3);
  const evidence_sufficient = cluster.evidence_count >= 3 || sit.evidence_count >= 3;
  const temporal_coherence =
    cluster.distinct_days >= 1 &&
    (cluster.temporal_span_days === 0 || cluster.temporal_span_days < 400);
  const entity_coherence = Boolean(sit.primary_entity_key) || cluster.entity_count >= 1;
  const snippets = cluster.timeline.map((t) => t.snippet);
  const mixedExclusive = snippets.some((sn) => {
    const threads = detectCausalThreads(sn);
    const exclusive = threads.filter((t) => t !== "renewal");
    return exclusive.length === 1 && !causalContextCompatible(sit.causal_cluster, sn);
  });
  const causal_coherence =
    sit.pattern_id !== "customer_churn_risk" && !sit.causal_cluster ? true : !mixedExclusive;
  const no_major_contradiction = cluster.contradiction_score <= 0.45;
  let teams: string[] = [];
  let people: string[] = [];
  try {
    teams = sit.teams_json ? JSON.parse(sit.teams_json) : [];
  } catch {
    teams = [];
  }
  try {
    people = sit.people_json ? JSON.parse(sit.people_json) : [];
  } catch {
    people = [];
  }
  const impact_credible = cluster.entity_count >= 1 || teams.length > 0 || people.length > 0;
  let facets: string[] = cluster.facets;
  try {
    const extra = sit.facets_json ? JSON.parse(sit.facets_json) : [];
    if (Array.isArray(extra)) facets = [...new Set([...facets, ...extra.map(String)])];
  } catch {
    /* ignore */
  }
  const gateFacets = facets.filter((f) => f && f !== "keyword");
  const required_facets = gateFacets.length >= 1 || cluster.evidence_count >= 3;

  const checks = {
    evidence_sufficient,
    temporal_coherence,
    entity_coherence,
    causal_coherence,
    no_major_contradiction,
    impact_credible,
    required_facets,
  };
  const reasons = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return { ok: reasons.length === 0, reasons, checks };
}
