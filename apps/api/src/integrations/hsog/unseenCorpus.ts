/**
 * Unseen / generalization corpus — situations Hustronix was never taught as HSOG scenarios.
 * No scenario_ids, playbooks, or HSOG pattern ids in the ingest payload.
 */
export type UnseenArtifact = {
  day: number;
  source: string;
  author: string;
  content: string;
  external_id: string;
};

export type UnseenScenarioTruth = {
  id: string;
  title: string;
  /** Expected emergent theme id (evaluator only). */
  expected_theme: string;
  /** Primary entity label that should appear on the situation. */
  expected_entity: string;
  first_evidence_day: number;
  /** Day enough evidence exists that decision-ready is fair. */
  decision_ready_target_day: number;
  /** Day problem is declared in the "org" narrative. */
  declaration_day: number;
  /** Day resolution evidence appears (for de-escalation tests). */
  resolve_day?: number;
  artifact_external_ids: string[];
};

export type UnseenCorpus = {
  scenarios: UnseenScenarioTruth[];
  artifacts: UnseenArtifact[];
};

function art(
  day: number,
  source: string,
  author: string,
  content: string,
  slug: string,
): UnseenArtifact {
  return {
    day,
    source,
    author,
    content,
    external_id: `unseen:${slug}:d${day}:${source}`,
  };
}

/**
 * Four novel organizational stories — names/themes absent from HSOG pattern catalog.
 */
export function buildUnseenCorpus(): UnseenCorpus {
  const artifacts: UnseenArtifact[] = [];
  const scenarios: UnseenScenarioTruth[] = [];

  // 1) HelixBio — privacy / DSAR (privacy_request)
  const helix = [
    art(10, "email", "Priya", "Legal received a DSAR privacy request from HelixBio employee records.", "helix-dsar"),
    art(12, "slack", "Omar", "HelixBio counsel asks whether EU-only data residency is enforced for exports.", "helix-res"),
    art(14, "jira", "Noor", "Compliance flags missing attestation evidence for HelixBio GDPR packet.", "helix-att"),
    art(16, "email", "Maya", "HelixBio escalates: privacy request still open; legal hold discussed.", "helix-esc"),
  ];
  artifacts.push(...helix);
  scenarios.push({
    id: "unseen_helix_privacy",
    title: "HelixBio privacy / DSAR",
    expected_theme: "privacy_request",
    expected_entity: "HelixBio",
    first_evidence_day: 10,
    decision_ready_target_day: 14,
    declaration_day: 16,
    artifact_external_ids: helix.map((a) => a.external_id),
  });

  // 2) PayOrbit — vendor payment risk
  const pay = [
    art(20, "email", "Helen", "AP notes PayOrbit invoice unpaid and past due for cloud egress fees.", "pay-inv"),
    art(22, "slack", "Ethan", "Engineering blocked: PayOrbit vendor threatens service suspension on SLA.", "pay-block"),
    art(24, "jira", "Helen", "Procurement marks PayOrbit contract at risk after payment delayed.", "pay-contract"),
    art(28, "email", "Helen", "PayOrbit invoice paid; AP hold cleared.", "pay-resolved"),
  ];
  artifacts.push(...pay);
  scenarios.push({
    id: "unseen_payorbit_vendor",
    title: "PayOrbit vendor payment risk",
    expected_theme: "vendor_risk",
    expected_entity: "PayOrbit",
    first_evidence_day: 20,
    decision_ready_target_day: 24,
    declaration_day: 24,
    resolve_day: 28,
    artifact_external_ids: pay.map((a) => a.external_id),
  });

  // 3) Northwind Campaign — budget pressure
  const camp = [
    art(30, "email", "Drew", "Marketing Northwind campaign spend is over budget vs plan.", "nw-spend"),
    art(32, "slack", "Helen", "Finance requests opex reforecast after Northwind burn rate spike.", "nw-burn"),
    art(34, "meeting", "Maya", "CFO hold on further Northwind spend approval until burn explained.", "nw-hold"),
  ];
  artifacts.push(...camp);
  scenarios.push({
    id: "unseen_northwind_budget",
    title: "Northwind campaign budget pressure",
    expected_theme: "budget_pressure",
    expected_entity: "Northwind",
    first_evidence_day: 30,
    decision_ready_target_day: 34,
    declaration_day: 34,
    artifact_external_ids: camp.map((a) => a.external_id),
  });

  // 4) LatticeOps — delivery / schedule risk (then resolves)
  const lat = [
    art(40, "jira", "Renata", "LatticeOps release blocked by flaky checkout regression.", "lat-reg"),
    art(42, "slack", "Imani", "LatticeOps launch date at risk; timeline slip likely this sprint.", "lat-slip"),
    art(44, "email", "Elena", "Cannot ship LatticeOps until QA blocker cleared.", "lat-block"),
    art(48, "slack", "Renata", "LatticeOps regression fixed; release restored and on track.", "lat-fix"),
  ];
  artifacts.push(...lat);
  scenarios.push({
    id: "unseen_lattice_delivery",
    title: "LatticeOps delivery risk",
    expected_theme: "delivery_risk",
    expected_entity: "LatticeOps",
    first_evidence_day: 40,
    decision_ready_target_day: 44,
    declaration_day: 44,
    resolve_day: 48,
    artifact_external_ids: lat.map((a) => a.external_id),
  });

  return { scenarios, artifacts };
}
