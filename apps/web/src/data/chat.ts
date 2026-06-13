export const chatContext = {
  title: "Improve outbound conversion",
  description:
    "Align messaging with updated ICP and reduce drop-off in first-touch sequences.",
  signalsTotal: 7,
  signalsBySource: [
    { name: "Slack", count: 2 },
    { name: "Meetings", count: 1 },
    { name: "Docs & Notes", count: 2 },
    { name: "CRM", count: 2 },
  ],
  memory: [
    "ICP has shifted toward mid-market SaaS in EU.",
    "Prior experiment: shorter subject lines +12% reply rate.",
  ],
};

export const chatTimeline = [
  {
    type: "signal" as const,
    time: "10:21 AM",
    source: "Slack",
    text: "AEs reporting longer cycles on outbound sequences.",
  },
  {
    type: "signal" as const,
    time: "10:47 AM",
    source: "Meeting Notes",
    text: "Call summary: prospects confused by value prop in slide 3.",
  },
  {
    type: "synthesis" as const,
    time: "11:05 AM",
    text: "Pattern detected across 5 signals",
    bullets: [
      "Messaging not aligned with updated ICP.",
      "Objections cluster on pricing page clarity.",
    ],
  },
  {
    type: "decision" as const,
    time: "11:18 AM",
    text: "Refine outbound messaging for EU mid-market.",
    confidence: 87,
  },
  {
    type: "execution" as const,
    time: "11:22 AM",
    text: "Action Created — sequence refresh + landing tweaks.",
  },
];

export const decisionInspector = {
  title: "Refine outbound messaging",
  why: "Signals consistently point to ICP drift and unclear value framing in top-of-funnel assets.",
  factors: [
    "Slack + CRM agree on longer cycles.",
    "Meeting notes cite slide-level confusion.",
    "Historical tests favor concise subject lines.",
  ],
  impact: "High",
  roi: "Projected +9–14% qualified replies over 14 days.",
  confidence: 87,
};
