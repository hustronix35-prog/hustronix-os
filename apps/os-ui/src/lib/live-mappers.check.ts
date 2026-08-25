import {
  focusFromExecutions,
  founderDecisionBrief,
  parseSignalContent,
  readableLedgerText,
  recsFromLedgerDecisions,
  signalHeadline,
} from "./live-mappers.ts";

const prose = readableLedgerText(
  '[{"metric":"SignalGrid ingestion outage","target":"Resolve with cited evidence"}]',
);
if (!prose.includes("SignalGrid ingestion outage") || prose.includes("[{")) {
  throw new Error(`readableLedgerText still dumps JSON: ${prose}`);
}
if (readableLedgerText("plain vow text") !== "plain vow text") {
  throw new Error("plain text passthrough");
}
const sameVow = focusFromExecutions([
  { task_id: "t1", owner: "a", weight: 1, status: "ACTIVE", success_condition: null, last_update: "", decision_vow: "Hold NexusAI 2.0 GA" },
  { task_id: "t2", owner: "b", weight: 1, status: "BLOCKED", success_condition: null, last_update: "", decision_vow: "Hold NexusAI 2.0 GA" },
]);
if (sameVow.length !== 1 || sameVow[0].id !== "t1" || sameVow[0].status !== "Blocked") {
  throw new Error(`focusFromExecutions should collapse shared vows: ${JSON.stringify(sameVow)}`);
}
const crm = parseSignalContent(
  '[hubspot:deal.propertyChange] objectId=acme_industrials {"summary":"Acme renewal decision due.","health_note":"Acme renewal decision due.\\nGround truth: fact_acme_churn_risk\\nEntities: acme_industrials","scenario":"customer_churn_risk"}',
);
if (crm.event !== "hubspot:deal.propertyChange") throw new Error(`event: ${crm.event}`);
if (crm.title !== "Acme renewal decision due.") throw new Error(`title: ${crm.title}`);
if (crm.body) throw new Error(`body should be folded into facts: ${crm.body}`);
if (!crm.facts.some((f) => f.label === "Object" && f.value === "acme_industrials")) {
  throw new Error(`missing object fact: ${JSON.stringify(crm.facts)}`);
}
if (!crm.facts.some((f) => f.label === "Scenario" && f.value === "Customer Churn Risk")) {
  throw new Error(`missing scenario: ${JSON.stringify(crm.facts)}`);
}
if (!crm.facts.some((f) => f.label === "Ground truth" && f.value === "fact_acme_churn_risk")) {
  throw new Error(`missing ground truth: ${JSON.stringify(crm.facts)}`);
}
if (signalHeadline(crm.title).includes("{")) throw new Error("headline leaked JSON");

const detectMemo = JSON.stringify({
  institutional_version: 3,
  source: "situation_detect",
  situation_id: "customer_churn_risk",
  situation_object_id: "87fe70a2-aaaa-bbbb-cccc-ddddeeeeffff",
  title: "Customer renewal / churn risk",
  stage: "DECISION_READY",
  confidence: 0.95,
  trajectory: "WORSENING",
  facets: ["support", "sales"],
  signal_ids: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "11111111-2222-3333-4444-555555555555"],
  explanation:
    "DECISION_READY: Customer renewal / churn risk. Facets: support, sales. Entities: Atlas (customer), Support (team), Engineering (team), Sales (team). Sources: slack, gmail, crm, jira. Evidence: 7 signals across 7 day(s). Coverage: 72%. Readiness: 81%. Trajectory: WORSENING. Confidence: 95%.",
  entities: ["Atlas (customer)", "Support (team)", "Engineering (team)", "Sales (team)"],
  proposed_tasks: [
    { owner: "Jordan", type: "ACTION", success_condition: "Customer health plan + weekly exec update" },
    { owner: "Ethan", type: "ACTION", success_condition: "Ingestion SLA restored for affected customer" },
  ],
});
const brief = founderDecisionBrief(detectMemo);
for (const leak of ["situation_id", "DECISION_READY", "[object Object]", "87fe70a2-aaaa", "aaaaaaaa-bbbb"]) {
  if (brief.summary.includes(leak) || brief.happening.includes(leak)) {
    throw new Error(`founder brief leaked ${leak}: ${brief.summary}`);
  }
}
if (!/atlas/i.test(brief.happening) || !/getting worse/i.test(brief.happening)) {
  throw new Error(`happening not founder-readable: ${brief.happening}`);
}
if (!brief.why.some((line) => /slack/i.test(line) && /7/.test(line))) {
  throw new Error(`why missing evidence/sources: ${JSON.stringify(brief.why)}`);
}
if (!brief.who.includes("Atlas") || brief.who.some((name) => /\(customer\)/i.test(name))) {
  throw new Error(`who not human: ${JSON.stringify(brief.who)}`);
}
if (!brief.next.some((line) => /Jordan/i.test(line) && /health plan/i.test(line))) {
  throw new Error(`next missing tasks: ${JSON.stringify(brief.next)}`);
}
if (brief.confidencePct !== 95) throw new Error(`confidence: ${brief.confidencePct}`);
if (brief.impact !== "Atlas") throw new Error(`impact: ${brief.impact}`);

const dumped = readableLedgerText(detectMemo);
if (dumped.includes("situation_id") || dumped.includes("[object Object]") || dumped.includes("DECISION_READY")) {
  throw new Error(`readableLedgerText still dumps internals: ${dumped}`);
}

const rec = recsFromLedgerDecisions([
  {
    id: "87fe70a2-aaaa-bbbb-cccc-ddddeeeeffff",
    vow: "Save the at-risk renewal by closing ingestion latency and the overpromise gap",
    status: "DRAFT",
    confidence: 0.95,
    created_at: new Date().toISOString(),
    expected_outcomes: '[{"metric":"Customer renewal / churn risk","target":"Resolve with linked evidence"}]',
    decision_reasoning: detectMemo,
  } as Parameters<typeof recsFromLedgerDecisions>[0][number],
])[0];
if (!rec) throw new Error("missing rec");
if (rec.impactDetail === rec.decisionId?.slice(0, 8) || rec.explanation.includes("[object Object]")) {
  throw new Error(`rec still technical: ${JSON.stringify(rec)}`);
}
if (rec.impact !== "Atlas") throw new Error(`rec impact: ${rec.impact}`);

const talkMemo = JSON.stringify({
  institutional_version: 3,
  ranked_hypotheses: [
    { id: "h_primary", statement: "Atlas renewal is a real organizational issue that requires a governed decision." },
    { id: "h_instrumentation", statement: "The observed signals may reflect instrumentation or process noise rather than the stated risk." },
  ],
  evidence_graph: [{ description: "Day 12: Acme opened tickets about ingestion delays." }],
  recommended_actions: [{ label: "Restore the ingestion SLA for Atlas" }],
  title: "Customer renewal / churn risk",
  trajectory: "WORSENING",
  confidence_0_1: 0.62,
  entities: ["Atlas"],
});
const talk = founderDecisionBrief(talkMemo);
if (!talk.why.some((line) => /ingestion delays/i.test(line))) {
  throw new Error(`talk why missing snippet: ${JSON.stringify(talk.why)}`);
}
if (!talk.alternatives.some((line) => /noise/i.test(line))) {
  throw new Error(`talk alternatives: ${JSON.stringify(talk.alternatives)}`);
}

const jira = parseSignalContent(
  "[jira:issue_updated] NEX-445 status=In Progress assignee=jordan@hustronix.io\nAcme opens support tickets about SignalGrid ingestion delays.\nGround truth: fact_acme_ingestion_latency",
);
if (jira.title !== "Acme opens support tickets about SignalGrid ingestion delays.") {
  throw new Error(`jira title: ${jira.title}`);
}
if (!jira.facts.some((f) => f.label === "Issue" && f.value === "NEX-445")) {
  throw new Error(`jira issue: ${JSON.stringify(jira.facts)}`);
}

console.log("live-mappers.check ok");
