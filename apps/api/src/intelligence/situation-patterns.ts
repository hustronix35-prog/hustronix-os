/** Situation pattern catalog — content heuristics, not corpus scenario labels. */

export type SituationPattern = {
  id: string;
  title: string;
  /** Content must match at least this many distinct keywords (case-insensitive). */
  minHits: number;
  keywords: string[];
  vow: string;
  constraints: string[];
  teams: { from: string; to: string; work: string; status?: "ON_TRACK" | "AT_RISK" | "DELAYED" }[];
  tasks: { owner: string; success_condition: string; weight?: number }[];
};

export const SITUATION_PATTERNS: SituationPattern[] = [
  {
    id: "product_launch_slip",
    title: "Product launch / GA risk",
    minHits: 2,
    keywords: [
      "nexusai",
      "nexus ai",
      "launch",
      "ga ",
      " evidence",
      "decision trail",
      "decision trails",
      "retrieval",
      "retrieval trace",
      "architecture review",
      "quality risk",
      "launch gate",
      "launch readiness",
      "slip",
      "slipping",
    ],
    vow: "Hold product GA until decision-trail evidence links pass the launch gate.",
    constraints: ["Do not ship without retrieval-trace coverage", "Do not silently slip customer dates"],
    teams: [
      { from: "engineering", to: "product", work: "Evidence-trail coverage", status: "AT_RISK" },
      { from: "security", to: "product", work: "Launch gate review", status: "AT_RISK" },
    ],
    tasks: [
      { owner: "Imani", success_condition: "Launch checklist green including evidence links" },
      { owner: "Renata", success_condition: "P1 evidence-link bug closed with regression tests" },
    ],
  },
  {
    id: "customer_churn_risk",
    title: "Customer renewal / churn risk",
    minHits: 2,
    keywords: [
      "renewal",
      "health score",
      "churn",
      "competitor",
      "ingestion delay",
      "cs lowers",
      "complaints",
      "complaint",
      "support escalation",
      "executive sponsor",
      "alternative vendor",
      "renewal conversation",
      "account team",
    ],
    vow: "Save the at-risk renewal by closing ingestion latency and the overpromise gap.",
    constraints: ["Do not discount without CFO review", "Do not hide health-score drop from exec"],
    teams: [
      { from: "engineering backend", to: "customer success", work: "Ingestion SLA for renewal", status: "AT_RISK" },
    ],
    tasks: [
      { owner: "Jordan", success_condition: "Customer health plan + weekly exec update" },
      { owner: "Ethan", success_condition: "Ingestion SLA restored for affected customer" },
    ],
  },
  {
    id: "security_incident",
    title: "Security incident / audit exception",
    minHits: 2,
    keywords: [
      "sev1",
      "sev 1",
      "exfil",
      "exfiltration",
      "admin exception",
      "access review",
      "audit readiness",
      "enterprise audit",
      "siem",
      "unusual export",
      "audit evidence",
      "incomplete evidence",
      "evidence incomplete",
      "audit packet",
      "support tooling",
      "support access",
      "support engineer",
      "data exposure",
    ],
    vow: "Close the SEV1 support access exception and complete audit evidence before customer packets go out.",
    constraints: ["Do not grant new admin exceptions without expiry", "Do not claim no-exfil without evidence"],
    teams: [
      { from: "security", to: "sales", work: "Audit packet for enterprise deal", status: "DELAYED" },
    ],
    tasks: [
      { owner: "Omar", success_condition: "SEV1 closed with confirmed scope" },
      { owner: "Noor", success_condition: "Expired admin exception remediated + evidence register updated" },
    ],
  },
  {
    id: "infrastructure_outage",
    title: "Infrastructure / ingestion outage",
    minHits: 2,
    keywords: ["signalgrid", "ingestion", "partition", "sla", "kafka", "kafka lag", "outage", "reliability", "deferred"],
    vow: "Restore ingestion SLA and finish the deferred partitioning work.",
    constraints: ["Do not mute lag alerts without owner", "Do not defer reliability for launch again"],
    teams: [
      { from: "engineering backend", to: "customer success", work: "Ingestion SLA recovery", status: "AT_RISK" },
    ],
    tasks: [
      { owner: "Ethan", success_condition: "Ingestion delay under SLA for all affected customers" },
      { owner: "Priya", success_condition: "Partitioning tickets un-deferred with dates" },
    ],
  },
  {
    id: "sales_forecast_miss",
    title: "Forecast / coverage miss",
    minHits: 2,
    keywords: ["forecast", "q3", "coverage", "crm", "commit stage", "northstar", "pipeline", "coverage gap", "forecast confidence", "stale risk"],
    vow: "Rebuild the forecast from current renewal risk, not stale CRM green.",
    constraints: ["Do not keep commit stage when CS health is red", "Do not surprise CEO on coverage"],
    teams: [
      { from: "finance", to: "executive", work: "Coverage gap briefing", status: "ON_TRACK" },
      { from: "sales", to: "finance", work: "Forecast restatement", status: "AT_RISK" },
    ],
    tasks: [
      { owner: "Marcus", success_condition: "Forecast restated with current risk fields" },
      { owner: "Helen", success_condition: "Coverage gap briefed to exec" },
    ],
  },
  {
    id: "hiring_freeze",
    title: "Hiring freeze / headcount exceptions",
    minHits: 2,
    keywords: [
      "hiring freeze",
      "hris",
      "backfill",
      "headcount",
      "grc analyst",
      "sre role",
      "burn pressure",
      "limited exceptions",
    ],
    vow: "Enforce hiring freeze with only documented GRC analyst + SRE exceptions.",
    constraints: ["No unapproved backfills", "Exceptions require exec + finance"],
    teams: [
      { from: "hr ops", to: "security", work: "GRC + SRE exceptions", status: "ON_TRACK" },
    ],
    tasks: [
      { owner: "Leah", success_condition: "Freeze policy published in HRIS + Confluence" },
      { owner: "Helen", success_condition: "GRC + SRE exceptions documented" },
    ],
  },
  {
    id: "enterprise_deal_red_flags",
    title: "Enterprise deal / audit-ready trails",
    minHits: 2,
    keywords: [
      "sentryline",
      "residency",
      "data residency",
      "audit-ready",
      "audit-complete",
      "recommendation trail",
      "commit until",
      "custom residency",
      "contract language",
    ],
    vow: "Do not mark the enterprise deal as commit until AI recommendation trails are audit-ready.",
    constraints: ["No custom residency without legal + security", "No commit on incomplete traces"],
    teams: [
      { from: "security", to: "sales", work: "Audit-complete trace checklist", status: "DELAYED" },
    ],
    tasks: [
      { owner: "Noor", success_condition: "Audit-complete trace checklist signed" },
      { owner: "Caleb", success_condition: "Residency requirement dispositioned" },
    ],
  },
  {
    id: "feature_quality_regression",
    title: "Feature quality / flag regression",
    minHits: 2,
    keywords: ["flowops", "nested-approval", "nested approval", "feature flag", "kaldera", "qa", "edge case", "regression"],
    vow: "Keep the nested-approval flag off for GA customers until QA edge cases pass.",
    constraints: ["Do not re-enable flag for GA customers without QA sign-off"],
    teams: [
      { from: "qa support", to: "product", work: "Nested-approval QA coverage", status: "ON_TRACK" },
    ],
    tasks: [
      { owner: "Skye", success_condition: "Nested approval groups covered by tests" },
      { owner: "Chris", success_condition: "Feature flag remains off outside beta" },
    ],
  },
];
