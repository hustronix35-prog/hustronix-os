export const currentDecision = {
  title: "Resolve System Over Capacity",
  description:
    "Restore system load to under 100% to ensure execution efficiency and reduce risk of failure.",
  confidence: 88,
  owner: "Rohit Verma",
  created: "19 May 2024",
  priority: "HIGH" as const,
  timeActive: "2h 34m",
};

export const capacityStatus = {
  headline: "OVER CAPACITY",
  sub: "ACTION REQUIRED",
  loadPct: 132,
  warning:
    "System load is 132% of total capacity. Performance degradation and failure risk high.",
};

export const executionsSummary = {
  total: 11,
  active: 8,
  blocked: 3,
};

export const mcExecutionsTable = [
  {
    id: "e1",
    name: "Reduce High-Weight Executions",
    owner: "Arjun Patel",
    initials: "AP",
    status: "ACTIVE" as const,
    due: "Today 6:00 PM",
    linked: "Resolve System Over Capacity",
  },
  {
    id: "e2",
    name: "Scale EU inference pool",
    owner: "Priya Sharma",
    initials: "PS",
    status: "BLOCKED" as const,
    due: "Overdue",
    linked: "Resolve System Over Capacity",
  },
  {
    id: "e3",
    name: "Drain legacy job queue",
    owner: "Vikram Singh",
    initials: "VS",
    status: "ACTIVE" as const,
    due: "Tomorrow 9:00 AM",
    linked: "Resolve System Over Capacity",
  },
];

export const mcSignalsPreview = [
  {
    source: "Slack" as const,
    title: "#product-alerts",
    body: "User reports API latency issues across regions…",
    remaining: "18m 32s remaining",
  },
  {
    source: "GitHub" as const,
    title: "#1842",
    body: "Memory leak in execution engine…",
    remaining: "42m 15s remaining",
  },
];
