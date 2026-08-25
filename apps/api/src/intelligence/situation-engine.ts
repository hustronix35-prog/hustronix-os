/**
 * Progressive situation engine — Signal → Situation → Decision readiness.
 *
 * Stages: AWARENESS → FORMING → ELEVATED → DECISION_READY → (DRAFT decision)
 * Does NOT create a decision on first keyword hit.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { mutationCreateDraftDecision } from "../security/mutation-handlers.js";
import { createOrgDependency } from "../org/intelligence.js";
import { SITUATION_PATTERNS, type SituationPattern } from "./situation-patterns.js";
import {
  indexSignalEntities,
  linkEntitiesToSituation,
  situationPrimaryEntityKeys,
  situationEntityLabels,
  signalSharesSituationEntity,
} from "./situation-graph.js";
import { computeReadiness } from "./readiness.js";
import {
  boundedGateDeltas,
  explainReadinessPrior,
  getReadinessPrior,
  learningPatternId,
} from "./readiness-learning.js";
import { buildEvidenceCluster } from "./evidence-cluster.js";
import {
  inferDependenciesFromText,
  persistInferredDependencies,
} from "./dependency-infer.js";
import { extractEntities, type ExtractedEntity } from "./entity-resolver.js";
import {
  clustersForSignal,
  inferCausalCluster,
  shouldAttachEvidence,
  situationTitleForCluster,
} from "./situation-fingerprint.js";
import { evaluateSituationCoherence } from "./situation-coherence.js";
import { DETECT_ENGINE_VERSION, markSignalsProcessed } from "./signal-processing.js";

export type SituationStage =
  | "AWARENESS"
  | "FORMING"
  | "ELEVATED"
  | "DECISION_READY"
  | "DECIDED"
  | "RESOLVED";

export type Trajectory = "IMPROVING" | "STABLE" | "WORSENING";

/** Facet vocabularies — multi-hop evidence dimensions per pattern. */
export const PATTERN_FACETS: Record<string, Record<string, string[]>> = {
  customer_churn_risk: {
    support: [
      "support ticket",
      "support tickets",
      "ingestion delay",
      "ingestion delays",
      "serious complaints",
      "complaints",
      "complaint",
      "support escalation",
      "escalat",
    ],
    health: [
      "health score",
      "cs lowers",
      "renewal risk",
      "health decline",
      "health dropped",
      "declined",
      "deteriorat",
      "account health",
    ],
    sales: [
      "promises",
      "nexusai will help",
      "sales promises",
      "will help",
      "sales tells",
      "renewal conversation",
      "renewal concern",
      "renewal",
    ],
    sponsor: ["executive sponsor", "sponsor changes", "sponsor has stopped", "sponsor"],
    competitor: [
      "competitor mentioned",
      "competitor",
      "alternative vendor",
      "evaluating an alternative",
      "another vendor",
    ],
    product: ["connector timeout", "recurring", "flowops connector"],
  },
  product_launch_slip: {
    product: ["nexusai", "nexus ai", "prd", "launch"],
    engineering: ["architecture", "retrieval", "evidence", "decision trail", "decision trails"],
    gate: ["launch gate", "launch readiness", "checklist", "yellow"],
    risk: ["slip", "slipping", "blocker", "quality risk", "p1 bug", "missing evidence"],
  },
  security_incident: {
    access: ["access review", "admin exception", "expired admin"],
    detection: ["siem", "unusual export", "sev1", "sev 1", "security alert"],
    audit: [
      "audit evidence",
      "audit readiness",
      "evidence register",
      "enterprise audit",
      "incomplete evidence",
      "audit packet",
      "evidence incomplete",
      "access evidence",
    ],
    tooling: ["support engineer", "support tooling", "support access"],
  },
  infrastructure_outage: {
    reliability: ["signalgrid", "reliability", "partition", "deferred"],
    ops: ["ingestion", "sla", "kafka", "lag", "outage"],
    customer: ["customer", "delay", "exceeds"],
  },
  sales_forecast_miss: {
    forecast: ["forecast", "q3", "coverage", "pipeline", "coverage gap", "forecast confidence"],
    crm: ["crm", "commit stage", "stale", "stale risk", "approval threshold", "discounts"],
    accounts: ["acme", "northstar", "renewal"],
  },
  hiring_freeze: {
    freeze: ["hiring freeze", "headcount"],
    exceptions: ["grc analyst", "sre", "backfill", "limited exceptions"],
    finance: ["burn pressure", "burn", "budget"],
  },
  enterprise_deal_red_flags: {
    deal: ["sentryline", "enterprise", "deal", "opportunity as commit"],
    audit: ["audit-ready", "audit-complete", "recommendation trail", "ai recommendation"],
    residency: ["residency", "data residency", "contract language"],
  },
  feature_quality_regression: {
    feature: ["flowops", "permission", "nested", "flag", "feature flag", "kaldera"],
    qa: ["qa", "regression", "edge case", "nested approval"],
    risk: ["ga customer", "rollback", "accidentally enabled", "tickets spike", "spike"],
  },
};

/**
 * Extra gates before DECISION_READY — progressive intelligence, not first-keyword.
 * requiredAny: at least one of these facet sets must be fully present.
 */
export const READY_GATES: Record<
  string,
  { minFacets: number; minEvidence: number; minDistinctDays: number; requiredAny?: string[][] }
> = {
  customer_churn_risk: {
    minFacets: 2,
    minEvidence: 4,
    minDistinctDays: 2,
    requiredAny: [
      ["health", "competitor"],
      ["health", "sponsor"],
      ["health", "support"],
      ["health", "support", "sales"],
      ["health", "support", "product"],
      ["health", "sponsor", "product"],
      ["health", "support", "sales", "sponsor"],
      ["support", "sales"],
      ["support", "sponsor"],
      ["support", "competitor"],
      ["sponsor", "competitor"],
      ["sales", "competitor"],
    ],
  },
  security_incident: {
    minFacets: 2,
    minEvidence: 3,
    minDistinctDays: 2,
    // Declaration is audit_evidence_missing (d51) — do not wait for SIEM (d74)
    requiredAny: [
      ["access", "audit"],
      ["access", "tooling"],
      ["access", "detection"],
      ["audit", "detection"],
    ],
  },
  hiring_freeze: {
    minFacets: 2,
    minEvidence: 3,
    minDistinctDays: 2,
    requiredAny: [["freeze", "exceptions"], ["freeze", "finance"]],
  },
  product_launch_slip: {
    minFacets: 3,
    minEvidence: 5,
    minDistinctDays: 3,
    requiredAny: [
      ["product", "engineering", "gate"],
      ["product", "risk", "gate"],
      ["product", "engineering", "risk", "gate"],
      ["product", "gate", "risk"],
    ],
  },
  infrastructure_outage: { minFacets: 2, minEvidence: 4, minDistinctDays: 2 },
  sales_forecast_miss: { minFacets: 2, minEvidence: 3, minDistinctDays: 2 },
  enterprise_deal_red_flags: { minFacets: 2, minEvidence: 3, minDistinctDays: 2 },
  feature_quality_regression: {
    minFacets: 2,
    minEvidence: 3,
    minDistinctDays: 2,
    requiredAny: [
      ["feature", "qa"],
      ["feature", "risk"],
      ["qa", "risk"],
    ],
  },
};

const STAGE_ORDER: SituationStage[] = [
  "AWARENESS",
  "FORMING",
  "ELEVATED",
  "DECISION_READY",
  "DECIDED",
  "RESOLVED",
];

function stageRank(s: SituationStage): number {
  return STAGE_ORDER.indexOf(s);
}

function worseningHints(text: string): boolean {
  return /drop|declin|worsen|risk high|competitor|blocked|blocking|exceeds|failed|sev1|\byellow\b|\bred\b|slip|regression|spike|complaint|outage|escalat|returned overnight|still blocking/i.test(
    text,
  );
}

function improvingHints(text: string): boolean {
  if (/blocking|blocked|outage returned|fail again|still blocking|deferred reliability/i.test(text)) {
    return false;
  }
  // Do not treat lone "green" as resolve — launch gates say "Product green; Engineering yellow"
  return /resolved|restored|on track|fixed|closed|mitigated|cleared|rollback completes|paid|fully green|\brecover(?:y|ing|ed)?\b|improving|corrective action|confirms improvement|metrics recovering|back on track|queue cleared/i.test(
    text,
  );
}

function lastPolarSnippet(
  evidence: { snippet: string | null }[],
): string {
  for (let i = evidence.length - 1; i >= 0; i--) {
    const sn = evidence[i].snippet || "";
    if (worseningHints(sn) || improvingHints(sn)) return sn;
  }
  return evidence.length ? evidence[evidence.length - 1].snippet || "" : "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Phrase match, or word-boundary for short tokens (avoids "hris"∈"Chris"). */
function textHasKeyword(content: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  const lower = content.toLowerCase();
  if (kw.includes(" ") || kw.length >= 6) {
    return lower.includes(kw);
  }
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(kw)}(?:[^a-z0-9]|$)`, "i").test(lower);
}

function facetsFor(patternId: string, content: string): string[] {
  const map = PATTERN_FACETS[patternId];
  if (!map) return [];
  const hit: string[] = [];
  for (const [facet, kws] of Object.entries(map)) {
    if (kws.some((k) => textHasKeyword(content, k))) hit.push(facet);
  }
  return hit;
}

function keywordHits(pattern: SituationPattern, content: string): string[] {
  return pattern.keywords.filter((k) => textHasKeyword(content, k));
}

/** Multi-word phrases count double — a single strong phrase can open awareness. */
function keywordStrength(hits: string[]): number {
  return hits.reduce((n, k) => n + (k.trim().includes(" ") ? 2 : 1), 0);
}

export function gatesAllowReady(
  patternId: string,
  facetSet: Set<string>,
  evidenceCount: number,
  distinctDays: number,
  prior?: { min_evidence_delta: number; min_distinct_days_delta: number } | null,
): boolean {
  const { minEvidenceDelta: extraEv, minDistinctDaysDelta: extraDays } = boundedGateDeltas(prior);
  const gate = READY_GATES[patternId];
  if (!gate) {
    return facetSet.size >= 3 && evidenceCount >= 4 + extraEv && distinctDays >= 2 + extraDays;
  }
  if (facetSet.size < gate.minFacets) return false;
  if (evidenceCount < gate.minEvidence + extraEv) return false;
  if (distinctDays < gate.minDistinctDays + extraDays) return false;
  if (gate.requiredAny?.length) {
    const ok = gate.requiredAny.some((need) => need.every((f) => facetSet.has(f)));
    if (!ok) return false;
  }
  return true;
}

export type SituationRow = {
  id: string;
  user_id: string;
  pattern_id: string;
  title: string;
  stage: SituationStage;
  confidence: number;
  trajectory: Trajectory;
  first_observed_day: number | null;
  last_updated_day: number | null;
  awareness_day: number | null;
  forming_day: number | null;
  elevated_day: number | null;
  decision_ready_day: number | null;
  decision_id: string | null;
  potential_impact: string | null;
  evidence_count: number;
  explanation: string | null;
  facets_json: string | null;
  people_json: string | null;
  teams_json: string | null;
  primary_entity_key?: string | null;
  primary_entity_type?: string | null;
  primary_entity_label?: string | null;
  causal_cluster?: string | null;
};

const UNBOUND_ENTITY_KEY = "_unbound";

/** Org-wide patterns stay unbound unless a customer is explicitly in scope. */
const ORG_WIDE_PATTERNS = new Set(["security_incident", "hiring_freeze"]);

function customerKeysInContent(content: string): string[] {
  return extractEntities(content).filter((e) => e.type === "customer").map((e) => e.key);
}

/** Reject multi-customer snippets on entity-scoped situations (e.g. "Northstar and Atlas renewals"). */
function bindsSingleCustomer(content: string, entityKey: string): boolean {
  if (entityKey === UNBOUND_ENTITY_KEY) return true;
  const custs = customerKeysInContent(content);
  if (!custs.length) return true;
  if (custs.length > 1) return false;
  return custs[0] === entityKey;
}

/** Product/customer-scoped situations reject signals that never name the bound entity. */
function signalMentionsBoundEntity(
  content: string,
  entityKey: string,
  entity: ExtractedEntity | null,
  patternId: string,
): boolean {
  if (entityKey === UNBOUND_ENTITY_KEY || !entity) return true;
  if (extractEntities(content).some((e) => e.key === entityKey)) return true;
  return pickPrimaryEntity(patternId, extractEntities(content), content)?.key === entityKey;
}

function pickPrimaryEntity(
  patternId: string,
  ents: ExtractedEntity[],
  content: string,
): ExtractedEntity | null {
  const customers = ents.filter((e) => e.type === "customer");
  const products = ents.filter((e) => e.type === "product");
  const projects = ents.filter((e) => e.type === "project");
  if (ORG_WIDE_PATTERNS.has(patternId)) {
    return customers[0] || null;
  }
  if (
    patternId === "customer_churn_risk" ||
    patternId === "sales_forecast_miss" ||
    patternId === "enterprise_deal_red_flags"
  ) {
    return customers[0] || products[0] || projects[0] || null;
  }
  if (patternId === "product_launch_slip") {
    const nexus = products.find((p) => p.key === "nexusai");
    if (nexus) return nexus;
    if (
      /\bnexus(?:ai)?\b/i.test(content) ||
      /\b(rollout|launch readiness|launch gate|the release|ga slip|launch blocked|launch checklist)\b/i.test(content)
    ) {
      return { key: "nexusai", label: "NexusAI", type: "product" };
    }
    return projects[0] || customers[0] || null;
  }
  if (patternId === "feature_quality_regression" || patternId === "infrastructure_outage") {
    return products[0] || projects[0] || customers[0] || null;
  }
  return customers[0] || products[0] || projects[0] || null;
}

function getSituation(
  userId: string,
  patternId: string,
  entityKey: string,
  cluster = "",
): SituationRow | undefined {
  const rows = db.rawGet(
    `SELECT * FROM situations WHERE user_id = ? AND pattern_id = ? AND COALESCE(primary_entity_key, '') = ? AND COALESCE(causal_cluster, '') = ?`,
    [userId, patternId, entityKey, cluster || ""],
  ) as SituationRow[];
  return rows[0];
}

function inferTrajectory(
  evidenceSnippets: string[],
  blobParts: string[],
  prev: Trajectory,
): Trajectory {
  const texts = evidenceSnippets.filter(Boolean);
  const allText = [...blobParts, ...texts].join(" ");
  const mid = Math.max(1, Math.floor(texts.length / 2));
  const early = texts.slice(0, mid);
  const late = texts.slice(mid);
  const recent = texts.slice(-4).join(" ") + " " + blobParts.slice(-2).join(" ");
  const isImprove = (t: string) => improvingHints(t);
  const isWorsenOnly = (t: string) => worseningHints(t) && !improvingHints(t);
  const improveN = texts.filter(isImprove).length;
  const worsenN = texts.filter(isWorsenOnly).length;
  const lateImprove = late.filter(isImprove).length > late.filter(isWorsenOnly).length && late.some(isImprove);
  const lateWorsen = late.filter(isWorsenOnly).length > late.filter(isImprove).length;
  const earlyWorsen = early.some(isWorsenOnly) || worseningHints(early.join(" "));

  if (/\byellow\b|\bred\b|slip|sev1|regression|spike|blocked/i.test(recent) && !lateImprove) {
    return "WORSENING";
  }
  if (earlyWorsen && lateImprove && improveN >= 2) return "IMPROVING";
  if (lateWorsen && worsenN > improveN) return "WORSENING";
  if (improveN > 0 && worsenN > 0 && Math.abs(improveN - worsenN) <= 1 && !lateImprove) return "STABLE";
  const latestText = blobParts.slice(-1).join(" ") || texts.slice(-1).join(" ") || "";
  if (latestText && isWorsenOnly(latestText)) return "WORSENING";
  if (improvingHints(recent) && !isWorsenOnly(recent)) return "IMPROVING";
  if (worseningHints(recent) && !improvingHints(recent)) return "WORSENING";
  if (worseningHints(allText) && !improvingHints(recent)) return "WORSENING";
  return prev || "STABLE";
}

function listEvidence(situationId: string) {
  return db.rawGet(
    `SELECT se.signal_id, se.facet, se.sim_day, se.snippet
     FROM situation_evidence se
     LEFT JOIN external_signals s ON s.id = se.signal_id
     WHERE se.situation_id = ?
     ORDER BY COALESCE(s.detected_at, s.received_at, se.created_at) ASC`,
    [situationId],
  ) as { signal_id: string; facet: string | null; sim_day: number | null; snippet: string | null }[];
}

function computeStage(
  patternId: string,
  facetSet: Set<string>,
  evidenceCount: number,
  distinctDays: number,
  confidence: number,
  trajectory: Trajectory,
  readinessReady: boolean,
  prior?: { min_evidence_delta: number; min_distinct_days_delta: number } | null,
): SituationStage {
  const facetCount = facetSet.size;
  if (
    (readinessReady ||
      (gatesAllowReady(patternId, facetSet, evidenceCount, distinctDays, prior) && confidence >= 0.55)) &&
    trajectory !== "IMPROVING"
  ) {
    return "DECISION_READY";
  }
  if (
    (facetCount >= 3 && evidenceCount >= 3 && distinctDays >= 2) ||
    (facetCount >= 2 && trajectory === "WORSENING" && evidenceCount >= 3 && distinctDays >= 2)
  ) {
    return "ELEVATED";
  }
  if (facetCount >= 2 || (facetCount >= 1 && evidenceCount >= 2 && distinctDays >= 2)) {
    return "FORMING";
  }
  if (facetCount >= 1 || evidenceCount >= 1) return "AWARENESS";
  return "AWARENESS";
}

function impactHints(text: string): boolean {
  return /renewal|sev1|sla|churn|slip|blocked|exceeds|competitor|exception/i.test(text);
}

function bumpOwners(owners: string[]) {
  for (const owner of owners) {
    try {
      db.rawRun(
        `INSERT INTO owner_reputation (owner, failed_executions, successful_executions, reputation_modifier, is_locked)
         VALUES (?, 0, 2, 3.0, 0)
         ON CONFLICT(owner) DO UPDATE SET reputation_modifier = MAX(reputation_modifier, 2.5), is_locked = 0`,
        [owner],
      );
    } catch {
      /* ignore */
    }
  }
}

export type ProgressiveDetectOpts = {
  /** Simulation day for timeline milestones (customer-path chrono). */
  simDay?: number;
  /** Entity + polarity only — skip HSOG pattern catalog and theme lexicon. */
  openWorld?: boolean;
  /** Re-scan already processed signals (tests / forced reconcile). */
  fullRescan?: boolean;
};

type SignalRow = {
  id: string;
  content: string;
  state: string;
  owner: string;
  source: string | null;
  day_key: number | null;
  cursor_ts: string | null;
};

export type ProgressiveDetectResult = {
  scanned: number;
  situations: Array<{
    pattern_id: string;
    stage: SituationStage;
    confidence: number;
    trajectory: Trajectory;
    evidence_count: number;
    facets: string[];
    decision_id: string | null;
    created_decision: boolean;
    stage_changed: boolean;
  }>;
  created_decisions: number;
  updated: number;
};

const DETECT_BATCH_SIZE = 500;

function fetchSignalBatch(
  userId: string,
  cursorTs: string | null,
  cursorId: string | null,
  limit = DETECT_BATCH_SIZE,
  fullRescan = false,
): SignalRow[] {
  const expr = `COALESCE(s.received_at, s.detected_at)`;
  const whereCursor = cursorTs
    ? `AND (
        ${expr} > ?
        OR (${expr} = ? AND s.id > ?)
      )`
    : "";
  const incremental = !fullRescan && process.env.HUSTRONIX_DETECT_FULL !== "1";
  const join = incremental
    ? `LEFT JOIN signal_processing sp ON sp.signal_id = s.id AND sp.engine_version = ?`
    : "";
  const unprocessed = incremental ? `AND sp.signal_id IS NULL` : "";
  const params: unknown[] = incremental ? [DETECT_ENGINE_VERSION, userId] : [userId];
  if (cursorTs) params.push(cursorTs, cursorTs, cursorId || "");
  params.push(limit);
  return db.rawGet(
    `SELECT s.id, s.content, s.state, s.owner, s.source,
            CAST(strftime('%Y%m%d', COALESCE(s.detected_at, s.received_at)) AS INTEGER) AS day_key,
            ${expr} AS cursor_ts
     FROM external_signals s
     ${join}
     WHERE s.user_id = ?
       AND s.state IN ('UNVERIFIED','GRACE','LINKED')
       ${unprocessed}
       ${whereCursor}
     ORDER BY ${expr} ASC, s.id ASC
     LIMIT ?`,
    params,
  ) as SignalRow[];
}

function mergeSituationResult(
  out: ProgressiveDetectResult,
  next: ProgressiveDetectResult["situations"][number],
): void {
  const idx = out.situations.findIndex(
    (s) => s.pattern_id === next.pattern_id && s.decision_id === next.decision_id && s.stage === next.stage,
  );
  if (idx >= 0) out.situations[idx] = next;
  else out.situations.push(next);
}

function processSignalBatch(
  userId: string,
  signals: SignalRow[],
  simDay: number | null,
  out: ProgressiveDetectResult,
): void {
  // Index all signals into entity graph first (candidates, not situations yet)
  for (const s of signals) {
    indexSignalEntities(userId, s.id, s.content || "", simDay);
  }
  // Infer cross-team deps from language on this pass
  for (const s of signals.slice(-80)) {
    persistInferredDependencies(
      userId,
      inferDependenciesFromText(s.content || "").map((d) => ({
        ...d,
        evidence: [s.id],
        confidence: d.confidence ?? 0.7,
      })),
    );
  }

  for (const pattern of SITUATION_PATTERNS) {
    type MatchRow = {
      id: string;
      facets: string[];
      kws: string[];
      owner: string;
      content: string;
      weight: number;
      reason: string;
    };
    const groups = new Map<
      string,
      { entityKey: string; cluster: string; entity: ExtractedEntity | null; matched: MatchRow[] }
    >();
    const addMatch = (entityKey: string, entity: ExtractedEntity | null, m: MatchRow, cluster: string) => {
      const gk = `${entityKey}::${cluster || ""}`;
      let g = groups.get(gk);
      if (!g) {
        g = { entityKey, cluster: cluster || "", entity, matched: [] };
        groups.set(gk, g);
      } else if (!g.entity && entity) {
        g.entity = entity;
      }
      if (!g.matched.some((x) => x.id === m.id)) g.matched.push(m);
    };

    for (const s of signals) {
      const kws = keywordHits(pattern, s.content || "");
      const strength = keywordStrength(kws);
      const facets = facetsFor(pattern.id, s.content || "");
      const ents = extractEntities(s.content || "");
      const primary = pickPrimaryEntity(pattern.id, ents, s.content || "");
      const entityKey = primary?.key || UNBOUND_ENTITY_KEY;
      if (!bindsSingleCustomer(s.content || "", entityKey)) continue;
      if (!signalMentionsBoundEntity(s.content || "", entityKey, primary, pattern.id)) continue;
      if (pattern.id === "infrastructure_outage") {
        const text = s.content || "";
        const hasInfraCue = /outage|partition|kafka|signalgrid|reliability|deferred reliability|exceeds sla|ingestion back within sla/i.test(
          text,
        );
        const hasInfraProduct = ents.some((e) => e.type === "product" && /signalgrid|kafka/i.test(e.key));
        if (!hasInfraCue && !hasInfraProduct) continue;
      }

      let reason: string | null = null;
      let weight = 1;
      if (strength >= Math.max(1, pattern.minHits || 1)) {
        reason = "keyword";
        weight = 1;
      } else if (
        primary &&
        (facets.length > 0 ||
          strength >= 1 ||
          (pattern.id === "product_launch_slip" && primary.type === "product"))
      ) {
        reason = "entity";
        weight = 0.9;
      } else if (facets.length >= 2) {
        reason = "facet";
        weight = 0.85;
      } else if (
        pattern.id === "customer_churn_risk" &&
        primary?.type === "customer" &&
        inferCausalCluster(s.content || "") &&
        (improvingHints(s.content || "") || worseningHints(s.content || ""))
      ) {
        reason = "cluster";
        weight = 0.85;
      }
      if (!reason) continue;
      const row: MatchRow = {
        id: s.id,
        facets: facets.length ? facets : strength > 0 ? ["keyword"] : [],
        kws,
        owner: s.owner,
        content: s.content || "",
        weight,
        reason,
      };
      const clusters =
        pattern.id === "customer_churn_risk" ? clustersForSignal(s.content || "") : [""];
      for (const cluster of clusters) {
        addMatch(entityKey, primary, row, cluster);
      }
    }

    for (const group of groups.values()) {
      const matched = group.matched;
      if (!matched.length) continue;
      const entityKey = group.entityKey;
      const causalCluster = group.cluster;

      const allFacets = new Set(matched.flatMap((m) => m.facets));
      const realFacets = [...allFacets].filter((f) => f !== "keyword" && f !== "entity");
      const facetCount = realFacets.length || (allFacets.has("keyword") ? 1 : 0);

      let sit = getSituation(userId, pattern.id, entityKey, causalCluster);
      if (!sit) {
        const seed = matched.filter((m) => m.reason === "keyword" || m.reason === "facet" || m.reason === "cluster");
        if (!seed.length) continue;
        const id = uuidv4();
        const title = situationTitleForCluster(pattern.title, group.entity?.label, causalCluster);
        try {
          db.rawRun(
            `INSERT INTO situations (
              id, user_id, pattern_id, title, stage, confidence, trajectory,
              first_observed_day, last_updated_day, awareness_day, evidence_count,
              potential_impact, recommended_actions_json, teams_json, people_json, facets_json, explanation,
              primary_entity_key, primary_entity_type, primary_entity_label, causal_cluster
            ) VALUES (?, ?, ?, ?, 'AWARENESS', 0.35, 'STABLE', ?, ?, ?, 0, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`,
            [
              id,
              userId,
              pattern.id,
              title,
              simDay,
              simDay,
              simDay,
              `Potential impact: ${pattern.title}`,
              JSON.stringify(pattern.tasks.map((t) => t.success_condition)),
              JSON.stringify(pattern.teams.map((t) => `${t.from}→${t.to}`)),
              JSON.stringify(realFacets),
              `Awareness: early signals related to ${pattern.title}.`,
              entityKey,
              group.entity?.type || null,
              group.entity?.label || null,
              causalCluster || "",
            ],
          );
        } catch {
          db.rawRun(
            `INSERT INTO situations (
              id, user_id, pattern_id, title, stage, confidence, trajectory,
              first_observed_day, last_updated_day, awareness_day, evidence_count,
              potential_impact, recommended_actions_json, teams_json, people_json, facets_json, explanation
            ) VALUES (?, ?, ?, ?, 'AWARENESS', 0.35, 'STABLE', ?, ?, ?, 0, ?, ?, ?, '[]', ?, ?)`,
            [
              id,
              userId,
              pattern.id,
              title,
              simDay,
              simDay,
              simDay,
              `Potential impact: ${pattern.title}`,
              JSON.stringify(pattern.tasks.map((t) => t.success_condition)),
              JSON.stringify(pattern.teams.map((t) => `${t.from}→${t.to}`)),
              JSON.stringify(realFacets),
              `Awareness: early signals related to ${pattern.title}.`,
            ],
          );
        }
        db.rawRun(
          `INSERT INTO situation_events (id, situation_id, user_id, kind, detail, sim_day)
           VALUES (?, ?, ?, 'AWARENESS', ?, ?)`,
          [uuidv4(), id, userId, "Situation opened at awareness", simDay],
        );
        sit = getSituation(userId, pattern.id, entityKey, causalCluster);
        if (!sit) continue;
        out.updated += 1;
        for (const m of seed) {
          linkEntitiesToSituation(userId, sit.id, extractEntities(m.content), simDay);
        }
      }

      const keys2 = situationPrimaryEntityKeys(sit.id);
      const already = new Set(matched.map((m) => m.id));
      for (const s of signals) {
        if (already.has(s.id)) continue;
        const facets = facetsFor(pattern.id, s.content || "");
        const ents = extractEntities(s.content || "");
        const primary = pickPrimaryEntity(pattern.id, ents, s.content || "");
        if (entityKey !== UNBOUND_ENTITY_KEY && primary?.key && primary.key !== entityKey) continue;
        if (entityKey === UNBOUND_ENTITY_KEY && primary) continue;
        if (!bindsSingleCustomer(s.content || "", entityKey)) continue;
        if (!signalMentionsBoundEntity(s.content || "", entityKey, group.entity, pattern.id)) continue;
        const share = ents.some((e) => keys2.has(e.key)) || signalSharesSituationEntity(s.id, keys2);
        const polarity = improvingHints(s.content || "") || worseningHints(s.content || "");
        if (!(share && (facets.length || polarity))) continue;
        if (sit!.causal_cluster || pattern.id === "customer_churn_risk") {
          const verdict = shouldAttachEvidence({
            entityCompatible: true,
            patternCompatible: true,
            situationCluster: sit!.causal_cluster || causalCluster,
            content: s.content || "",
            situationDay: sit!.last_updated_day || sit!.first_observed_day,
            signalDay: s.day_key,
          });
          if (!verdict.attach) continue;
        }
        matched.push({
            id: s.id,
            facets: facets.length ? facets : ["entity"],
            kws: [],
            owner: s.owner,
            content: s.content || "",
            weight: 0.9,
            reason: "entity",
          });
      }

      let newEvidence = 0;
      const blobParts: string[] = [];
      for (const m of matched) {
        const existing = (
          db.rawGet(
            `SELECT id FROM situation_evidence WHERE situation_id = ? AND signal_id = ?`,
            [sit!.id, m.id],
          ) as { id: string }[]
        )[0];
        if (existing) continue;
        const facetLabel =
          m.facets.filter((f) => f !== "keyword" && f !== "entity").join(",") ||
          m.facets[0] ||
          null;
        try {
          db.rawRun(
            `INSERT INTO situation_evidence
              (id, situation_id, signal_id, facet, weight, sim_day, snippet, attach_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), sit!.id, m.id, facetLabel, m.weight, simDay, m.content.slice(0, 240), m.reason],
          );
        } catch {
          db.rawRun(
            `INSERT INTO situation_evidence
              (id, situation_id, signal_id, facet, weight, sim_day, snippet)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), sit!.id, m.id, facetLabel, m.weight, simDay, m.content.slice(0, 240)],
          );
        }
        newEvidence += 1;
        blobParts.push(m.content);
        linkEntitiesToSituation(userId, sit!.id, extractEntities(m.content), simDay);
      }

      const cluster = buildEvidenceCluster(
        userId,
        sit!.id,
        Object.keys(PATTERN_FACETS[pattern.id] || {}).length || 3,
      );
      const evidence = listEvidence(sit!.id);
      const evidenceCount = cluster.evidence_count || evidence.length;
      const distinctDays = Math.max(cluster.distinct_days, 1);
      const facetSet = new Set(cluster.facets);
      for (const f of realFacets) facetSet.add(f);
      const fCount = facetSet.size || facetCount;

      const allText = [...blobParts, ...evidence.map((e) => e.snippet || "")].join(" ");
      const recentText = evidence
        .slice(-4)
        .map((e) => e.snippet || "")
        .concat(blobParts.slice(-2))
        .join(" ");
      const lastChronologicalSnippet = evidence.length ? evidence[evidence.length - 1].snippet || "" : "";
      const lastPolar = lastPolarSnippet(evidence);
      const lastStillWorsening = lastPolar && worseningHints(lastPolar) && !improvingHints(lastPolar);
      const clearRecovery =
        !!lastPolar &&
        improvingHints(lastPolar) &&
        /resolved|restored|fixed|closed|mitigated|cleared|back on track|confirms improvement|on track per|queue cleared/i.test(
          lastPolar,
        );
      let trajectory: Trajectory = inferTrajectory(
        evidence.map((e) => e.snippet || ""),
        blobParts,
        sit!.trajectory || "STABLE",
      );
      if (lastStillWorsening) trajectory = "WORSENING";

      let confidence = Math.min(
        0.95,
        0.28 +
          fCount * 0.1 +
          Math.min(evidenceCount, 8) * 0.035 +
          (distinctDays >= 2 ? 0.08 : 0) +
          Math.min(cluster.source_count, 3) * 0.04 +
          Math.min(cluster.entity_count, 4) * 0.03,
      );
      if (trajectory === "WORSENING") confidence = Math.min(0.95, confidence + 0.06);
      if (trajectory === "IMPROVING") confidence = Math.max(0.2, confidence - 0.18);
      if (cluster.contradiction_score > 0) {
        confidence = Math.max(0.2, confidence - cluster.contradiction_score * 0.15);
      }

      const prior = getReadinessPrior(userId, learningPatternId(pattern.id));
      const gateOk =
        trajectory !== "IMPROVING" &&
        gatesAllowReady(pattern.id, facetSet, evidenceCount, distinctDays, prior);
      const readiness = computeReadiness({
        facetCount: fCount,
        facetTarget: Object.keys(PATTERN_FACETS[pattern.id] || {}).length || 3,
        evidenceCount,
        distinctDays,
        sourceCount: cluster.source_count,
        entityCount: cluster.entity_count,
        trajectory,
        confidence,
        gateOk,
        impactHint: impactHints(allText),
        prior,
      });

      const prevStage = sit!.stage;
      let nextStage = computeStage(
        pattern.id,
        facetSet,
        evidenceCount,
        distinctDays,
        confidence,
        trajectory,
        readiness.ready && trajectory !== "IMPROVING",
        prior,
      );
      if (trajectory === "IMPROVING" && prevStage !== "DECIDED" && prevStage !== "RESOLVED") {
        if (/resolved|restored|fixed|closed|mitigated|cleared/i.test(recentText) || clearRecovery) {
          if (!lastStillWorsening && (clearRecovery || cluster.contradiction_score <= 0.35)) {
            nextStage = "RESOLVED";
          }
        } else if (stageRank(prevStage) > stageRank("AWARENESS")) {
          nextStage = STAGE_ORDER[Math.max(0, stageRank(prevStage) - 1)] as SituationStage;
          if (nextStage === "DECISION_READY" || nextStage === "DECIDED") nextStage = "ELEVATED";
        }
      } else if (
        stageRank(nextStage) < stageRank(prevStage) &&
        prevStage !== "DECIDED" &&
        prevStage !== "RESOLVED"
      ) {
        nextStage = prevStage;
      }
      if (prevStage === "RESOLVED") {
        const latestAttached = blobParts.slice(-1).join(" ") || lastChronologicalSnippet;
        const freshWorsening =
          newEvidence > 0 &&
          worseningHints(latestAttached) &&
          !improvingHints(latestAttached);
        if ((trajectory === "WORSENING" || freshWorsening || lastStillWorsening) && newEvidence > 0) {
          if (freshWorsening || lastStillWorsening) trajectory = "WORSENING";
          nextStage = computeStage(
            pattern.id,
            facetSet,
            evidenceCount,
            distinctDays,
            confidence,
            trajectory,
            false,
            prior,
          );
          if (nextStage === "RESOLVED" || nextStage === "DECIDED") nextStage = "FORMING";
          if (nextStage === "DECISION_READY") nextStage = "ELEVATED";
        } else {
          nextStage = "RESOLVED";
        }
      } else if (sit!.decision_id && nextStage !== "RESOLVED") {
        nextStage = "DECIDED";
      }

      if (
        nextStage === "DECISION_READY" &&
        pattern.id === "customer_churn_risk" &&
        cluster.contradiction_score > 0.45
      ) {
        nextStage = "ELEVATED";
      }
      if (nextStage === "DECISION_READY") {
        const coh = evaluateSituationCoherence(userId, sit!.id);
        if (!coh.ok) nextStage = "ELEVATED";
      }

      const stageChanged = nextStage !== prevStage;
      const milestoneCols: string[] = [];
      const milestoneParams: unknown[] = [];
      if (simDay != null) {
        const rank = stageRank(nextStage);
        if (sit!.awareness_day == null && rank >= stageRank("AWARENESS")) {
          milestoneCols.push("awareness_day = COALESCE(awareness_day, ?)");
          milestoneParams.push(simDay);
        }
        if (sit!.forming_day == null && rank >= stageRank("FORMING")) {
          milestoneCols.push("forming_day = COALESCE(forming_day, ?)");
          milestoneParams.push(simDay);
        }
        if (sit!.elevated_day == null && rank >= stageRank("ELEVATED")) {
          milestoneCols.push("elevated_day = COALESCE(elevated_day, ?)");
          milestoneParams.push(simDay);
        }
        if (sit!.decision_ready_day == null && rank >= stageRank("DECISION_READY")) {
          milestoneCols.push("decision_ready_day = COALESCE(decision_ready_day, ?)");
          milestoneParams.push(simDay);
        }
      }

      const entityLabels = situationEntityLabels(sit!.id);
      const explanationParts = [
        `${nextStage}: ${pattern.title}.`,
        `Facets: ${[...facetSet].join(", ") || "none"}.`,
        `Entities: ${entityLabels.slice(0, 8).join(", ") || "none"}.`,
        `Sources: ${cluster.sources.join(", ") || "n/a"}.`,
        `Evidence: ${evidenceCount} signals across ${distinctDays} day(s).`,
        `Coverage: ${Math.round(cluster.coverage_score * 100)}%.`,
        `Readiness: ${Math.round(readiness.score * 100)}%.`,
        `Trajectory: ${trajectory}.`,
        `Confidence: ${Math.round(confidence * 100)}%.`,
      ];
      if (prior.min_evidence_delta || prior.min_distinct_days_delta || prior.score_floor_delta) {
        explanationParts.push(prior.explanation);
        explanationParts.push(`Calibration: ${JSON.stringify(explainReadinessPrior(prior, readiness.score))}.`);
      }
      const explanation = explanationParts.join(" ");

      db.rawRun(
        `UPDATE situations SET
          stage = ?, confidence = ?, trajectory = ?,
          last_updated_day = COALESCE(?, last_updated_day),
          first_observed_day = COALESCE(first_observed_day, ?),
          evidence_count = ?,
          facets_json = ?,
          people_json = ?,
          entities_json = ?,
          sources_json = ?,
          timeline_json = ?,
          readiness_score = ?,
          explanation = ?,
          updated_at = CURRENT_TIMESTAMP
          ${milestoneCols.length ? ", " + milestoneCols.join(", ") : ""}
         WHERE id = ?`,
        [
          nextStage,
          confidence,
          trajectory,
          simDay,
          simDay,
          evidenceCount,
          JSON.stringify([...facetSet]),
          JSON.stringify(cluster.people),
          JSON.stringify(entityLabels),
          JSON.stringify(cluster.sources),
          JSON.stringify(cluster.timeline),
          readiness.score,
          explanation,
          ...milestoneParams,
          sit!.id,
        ],
      );

      if (stageChanged) {
        db.rawRun(
          `INSERT INTO situation_events (id, situation_id, user_id, kind, detail, sim_day)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), sit!.id, userId, nextStage, `Stage ${prevStage} → ${nextStage}`, simDay],
        );
        out.updated += 1;
      } else if (newEvidence > 0) {
        out.updated += 1;
      }

      let decisionId = sit!.decision_id;
      let createdDecision = false;

      if (nextStage === "DECISION_READY" && !decisionId && trajectory !== "IMPROVING") {
        bumpOwners(pattern.tasks.map((t) => t.owner));
        for (const edge of pattern.teams) {
          try {
            createOrgDependency(userId, {
              fromTeam: edge.from,
              fromWork: edge.work,
              toTeam: edge.to,
              toWork: pattern.title,
              status: edge.status || "AT_RISK",
              source: "pattern",
            });
          } catch {
            /* ignore */
          }
        }
        const draft = mutationCreateDraftDecision(userId, {
          vow: pattern.vow,
          expected_outcomes: [
            { metric: pattern.title, target: "Resolve with linked evidence" },
            { metric: "Evidence coverage", target: `${evidenceCount}+ supporting signals` },
          ],
          constraints: pattern.constraints,
          materializeTasks: false,
          tasks: pattern.tasks.map((t) => ({
            type: "ACTION",
            owner: t.owner,
            weight: t.weight ?? 1,
            success_condition: t.success_condition,
          })),
          institutional_reasoning: {
            institutional_version: 3,
            source: "situation_detect",
            situation_id: pattern.id,
            situation_object_id: sit!.id,
            title: pattern.title,
            stage: "DECISION_READY",
            confidence,
            trajectory,
            facets: [...facetSet],
            signal_ids: evidence.map((e) => e.signal_id).slice(0, 40),
            explanation,
            readiness_score: readiness.score,
            coverage_score: cluster.coverage_score,
            entities: entityLabels.slice(0, 12),
          },
          reversal_conditions: "New contradictory evidence or executive override",
        });
        decisionId = draft.id;
        createdDecision = true;
        out.created_decisions += 1;
        db.rawRun(
          `UPDATE situations SET decision_id = ?, stage = 'DECIDED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [decisionId, sit!.id],
        );
        db.rawRun(
          `INSERT INTO situation_events (id, situation_id, user_id, kind, detail, sim_day)
           VALUES (?, ?, ?, 'DECIDED', ?, ?)`,
          [uuidv4(), sit!.id, userId, `DRAFT decision ${decisionId}`, simDay],
        );
      }

      if (decisionId) {
        for (const e of evidence) {
          try {
            db.enrichSignal(e.signal_id, {
              relatedDecisionId: decisionId,
              intent: `situation:${pattern.id}`,
              confidence,
              opClassification: "decision_signal",
            });
          } catch {
            /* ignore */
          }
        }
      }

      sit = getSituation(userId, pattern.id, entityKey, causalCluster) || sit;
      mergeSituationResult(out, {
        pattern_id: pattern.id,
        stage: sit.stage,
        confidence: sit.confidence,
        trajectory: sit.trajectory,
        evidence_count: sit.evidence_count,
        facets: [...facetSet],
        decision_id: sit.decision_id,
        created_decision: createdDecision,
        stage_changed: stageChanged,
      });
    }
  }
}

/**
 * Scan signals, accumulate into situation objects, escalate stages.
 * Creates DRAFT decision only at DECISION_READY (once).
 */
export function runProgressiveSituationEngine(
  userId: string,
  opts?: ProgressiveDetectOpts,
): ProgressiveDetectResult {
  const simDay = opts?.simDay ?? null;
  const out: ProgressiveDetectResult = {
    scanned: 0,
    situations: [],
    created_decisions: 0,
    updated: 0,
  };
  const fullRescan = opts?.fullRescan === true || process.env.HUSTRONIX_DETECT_FULL === "1";
  let cursorTs: string | null = null;
  let cursorId: string | null = null;
  while (true) {
    const signals = fetchSignalBatch(userId, cursorTs, cursorId, DETECT_BATCH_SIZE, fullRescan);
    if (!signals.length) break;
    out.scanned += signals.length;
    processSignalBatch(userId, signals, simDay, out);
    markSignalsProcessed(signals.map((s) => s.id));
    const last = signals[signals.length - 1];
    cursorTs = last.cursor_ts || null;
    cursorId = last.id;
    if (signals.length < DETECT_BATCH_SIZE) break;
  }

  return out;
}

export function listSituationsForUser(userId: string): SituationRow[] {
  return (db.rawGet(
    `SELECT * FROM situations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`,
    [userId],
  ) || []) as SituationRow[];
}

export function getSituationDetail(userId: string, situationId: string) {
  const sit = (
    db.rawGet(`SELECT * FROM situations WHERE id = ? AND user_id = ?`, [situationId, userId]) as SituationRow[]
  )[0];
  if (!sit) return null;
  const evidence = listEvidence(sit.id);
  const events = db.rawGet(
    `SELECT kind, detail, sim_day, created_at FROM situation_events WHERE situation_id = ? ORDER BY created_at ASC`,
    [sit.id],
  );
  return { situation: sit, evidence, events };
}
