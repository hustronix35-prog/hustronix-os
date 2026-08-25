import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

type AuthoritySeed = {
  source: string;
  claim_dimension: string;
  authority: number;
  reliability_prior: number;
  freshness_half_life_hours: number | null;
};

const GLOBAL_SEEDS: AuthoritySeed[] = [
  { source: "github", claim_dimension: "IMPLEMENTATION", authority: 0.95, reliability_prior: 0.97, freshness_half_life_hours: 72 },
  { source: "github", claim_dimension: "CODE_INTEGRATION", authority: 0.98, reliability_prior: 0.97, freshness_half_life_hours: 48 },
  { source: "github", claim_dimension: "TASK_STATUS", authority: 0.55, reliability_prior: 0.7, freshness_half_life_hours: 72 },
  { source: "github", claim_dimension: "DECISION", authority: 0.2, reliability_prior: 0.5, freshness_half_life_hours: 720 },
  { source: "jira", claim_dimension: "TASK_STATUS", authority: 0.88, reliability_prior: 0.85, freshness_half_life_hours: 72 },
  { source: "jira", claim_dimension: "OWNERSHIP", authority: 0.85, reliability_prior: 0.8, freshness_half_life_hours: 336 },
  { source: "jira", claim_dimension: "IMPLEMENTATION", authority: 0.55, reliability_prior: 0.7, freshness_half_life_hours: 168 },
  { source: "jira", claim_dimension: "DEADLINE", authority: 0.7, reliability_prior: 0.7, freshness_half_life_hours: 48 },
  { source: "linear", claim_dimension: "TASK_STATUS", authority: 0.88, reliability_prior: 0.85, freshness_half_life_hours: 72 },
  { source: "linear", claim_dimension: "OWNERSHIP", authority: 0.85, reliability_prior: 0.8, freshness_half_life_hours: 336 },
  { source: "linear", claim_dimension: "IMPLEMENTATION", authority: 0.55, reliability_prior: 0.7, freshness_half_life_hours: 168 },
  { source: "slack", claim_dimension: "TASK_STATUS", authority: 0.4, reliability_prior: 0.55, freshness_half_life_hours: 48 },
  { source: "slack", claim_dimension: "IMPLEMENTATION", authority: 0.4, reliability_prior: 0.55, freshness_half_life_hours: 72 },
  { source: "slack", claim_dimension: "DEPENDENCY", authority: 0.7, reliability_prior: 0.65, freshness_half_life_hours: 48 },
  { source: "slack", claim_dimension: "CUSTOMER_READINESS", authority: 0.72, reliability_prior: 0.65, freshness_half_life_hours: 48 },
  { source: "slack", claim_dimension: "LAUNCH_READINESS", authority: 0.55, reliability_prior: 0.55, freshness_half_life_hours: 48 },
  { source: "slack", claim_dimension: "DECISION", authority: 0.45, reliability_prior: 0.5, freshness_half_life_hours: 168 },
  { source: "slack", claim_dimension: "DEADLINE", authority: 0.5, reliability_prior: 0.55, freshness_half_life_hours: 48 },
  { source: "meeting", claim_dimension: "DECISION", authority: 0.85, reliability_prior: 0.8, freshness_half_life_hours: 720 },
  { source: "meeting", claim_dimension: "LAUNCH_READINESS", authority: 0.8, reliability_prior: 0.75, freshness_half_life_hours: 48 },
  { source: "meeting", claim_dimension: "CUSTOMER_READINESS", authority: 0.75, reliability_prior: 0.7, freshness_half_life_hours: 48 },
  { source: "meeting", claim_dimension: "DEADLINE", authority: 0.78, reliability_prior: 0.75, freshness_half_life_hours: 72 },
  { source: "manual", claim_dimension: "*", authority: 0.6, reliability_prior: 0.6, freshness_half_life_hours: 168 },
];

export function seedGlobalAuthorityRules(): void {
  const existing = db.rawGet(
    `SELECT COUNT(*) AS c FROM source_authority_rules WHERE tenant_id = '*'`,
    [],
  ).at(0) as { c: number } | undefined;
  if (existing && existing.c > 0) return;

  for (const s of GLOBAL_SEEDS) {
    db.rawRun(
      `INSERT OR IGNORE INTO source_authority_rules (
        id, tenant_id, source, claim_dimension, claim_predicate,
        authority, reliability_prior, freshness_half_life_hours, enabled
      ) VALUES (?, '*', ?, ?, '*', ?, ?, ?, 1)`,
      [
        uuidv4(),
        s.source,
        s.claim_dimension,
        s.authority,
        s.reliability_prior,
        s.freshness_half_life_hours,
      ],
    );
  }
}

export interface AuthorityLookup {
  authority: number;
  reliability: number;
  halfLifeHours: number;
}

export function lookupAuthority(
  tenantId: string,
  source: string,
  dimension: string,
): AuthorityLookup {
  const src = String(source || "manual").toLowerCase();
  const rows = db.rawGet(
    `SELECT authority, reliability_prior, freshness_half_life_hours, claim_dimension, tenant_id
     FROM source_authority_rules
     WHERE enabled = 1
       AND source = ?
       AND tenant_id IN (?, '*')
       AND (claim_dimension = ? OR claim_dimension = '*')
     ORDER BY
       CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
       CASE WHEN claim_dimension = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [src, tenantId, dimension, tenantId, dimension],
  ) as Array<{
    authority: number;
    reliability_prior: number;
    freshness_half_life_hours: number | null;
    claim_dimension: string;
    tenant_id: string;
  }>;

  const hit = rows.at(0);
  if (hit) {
    return {
      authority: clamp01(hit.authority),
      reliability: clamp01(hit.reliability_prior),
      halfLifeHours:
        hit.freshness_half_life_hours != null && hit.freshness_half_life_hours > 0
          ? hit.freshness_half_life_hours
          : 168,
    };
  }
  return { authority: 0.5, reliability: 0.6, halfLifeHours: 168 };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
