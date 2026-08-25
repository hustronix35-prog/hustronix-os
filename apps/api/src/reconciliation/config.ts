/** Env flags for Phase 1 reconciliation. LLM extract is off by default. */

function envFlag(name: string, defaultOn: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return defaultOn;
  return !["0", "false", "off", "no"].includes(v.toLowerCase());
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const reconciliationConfig = {
  enabled: () => envFlag("RECONCILIATION_ENABLED", true),
  /** Phase 1: heuristic extract only unless explicitly enabled. */
  llmExtract: () => envFlag("RECONCILIATION_LLM", false),
  escalate: () => envFlag("RECONCILIATION_ESCALATE", true),
  authorityMargin: () => envNum("RECONCILIATION_AUTHORITY_MARGIN", 1.35),
  autoResolveMinScore: () => envNum("RECONCILIATION_AUTO_MIN_SCORE", 0.55),
  escalateConfidenceBelow: () => envNum("RECONCILIATION_ESCALATE_CONFIDENCE", 0.7),
};

/** Default half-lives (hours) when authority rule omits freshness_half_life_hours. */
export const DEFAULT_HALF_LIFE_HOURS: Record<string, number> = {
  TASK_STATUS: 72,
  IMPLEMENTATION: 168,
  CODE_INTEGRATION: 72,
  OWNERSHIP: 336,
  DEADLINE: 48,
  DECISION: 720,
  DEPENDENCY: 72,
  LAUNCH_READINESS: 48,
  CUSTOMER_READINESS: 48,
  "*": 168,
};
