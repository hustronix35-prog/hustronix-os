import type { Signal } from "./types";

function isoMinusMinutes(m: number) {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

function isoPlusMinutes(m: number) {
  return new Date(Date.now() + m * 60 * 1000).toISOString();
}

/** Demo signals aligned with product UI reference (Slack / GitHub / Jira). */
export const signalsUnverified: Signal[] = [
  {
    id: "1",
    title: "User drop-off increased after step 2",
    description:
      "Funnel analytics show a measurable spike in abandonment between onboarding step 2 and 3 across mobile web.",
    source: "slack",
    channel: "#growth",
    categoryTag: "User Report",
    author: "Neha Sharma",
    tag: "#growth",
    received: "2 minutes ago",
    detectedAt: isoMinusMinutes(2),
    graceEndsAt: isoPlusMinutes(18),
    expiresLabel: "18m",
    urgent: true,
    workspace: "Acme Growth",
    messageId: "msg_8f2a…c91",
    priority: "High",
  },
  {
    id: "2",
    title: "Checkout experiment PR merged without gate",
    description:
      "Branch feature/checkout-exp landed in main; no linked execution task in the ledger.",
    source: "github",
    channel: "repo / checkout-flow",
    categoryTag: "Code Change",
    author: "Ravi Mehta",
    received: "14 minutes ago",
    detectedAt: isoMinusMinutes(14),
    graceEndsAt: isoPlusMinutes(10 * 60),
    expiresLabel: "10h",
    urgent: true,
    priority: "High",
  },
  {
    id: "3",
    title: "Sprint goal blocked by dependency chain",
    description: "PLAT-442 cannot proceed until infra ticket resolves DNS cutover.",
    source: "jira",
    channel: "PLAT-442",
    categoryTag: "Bug Report",
    author: "Priya Nair",
    received: "32 minutes ago",
    detectedAt: isoMinusMinutes(32),
    graceEndsAt: isoPlusMinutes(6 * 60),
    expiresLabel: "6h",
    priority: "Medium",
  },
  {
    id: "4",
    title: "Enterprise trial reported SSO latency",
    description: "Support thread escalates: SAML response times exceed SLA during peak IST.",
    source: "slack",
    channel: "#support-escalations",
    categoryTag: "User Report",
    author: "Arjun Kumar",
    received: "48 minutes ago",
    detectedAt: isoMinusMinutes(48),
    graceEndsAt: isoPlusMinutes(3 * 60),
    expiresLabel: "3h",
    priority: "High",
  },
  {
    id: "5",
    title: "Pricing feedback consolidated in CRM",
    description: "Enterprise lead left structured objections in linked Notion doc.",
    source: "notion",
    channel: "Sales / Pricing",
    categoryTag: "Doc Update",
    author: "Marketing Ops",
    received: "1 hour ago",
    detectedAt: isoMinusMinutes(60),
    graceEndsAt: isoPlusMinutes(12 * 60),
    expiresLabel: "12h",
    priority: "Low",
  },
];

export const signalInspectorDetail = {
  suggestedTitle: "Optimize onboarding funnel",
  suggestedDescription:
    "Improve activation rate and reduce drop-offs between steps 2–3; align with active conversion vow.",
  suggestedDecision: "Optimize onboarding funnel",
  matchPct: 92,
  impactLoad: "High",
  confidence: 72,
  sourceReliability: "High",
};
