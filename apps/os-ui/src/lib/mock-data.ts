import type {
  Alert,
  Decision,
  EntityCount,
  FocusItem,
  KGEdge,
  KGNode,
  Metric,
  Recommendation,
  ScheduleItem,
} from "./types";

export const profile = {
  name: "Spandan Patil",
  role: "CEO",
  email: "spandan.patil@hustronix.com",
  initials: "SP",
  phone: "+91 98765 43210",
  department: "Executive",
  bio: "Building Hustronix into the operating system for executive decision-making.",
};

export const homeMetrics: Metric[] = [
  { label: "Critical Decision", value: 1, subtitle: "Needs your input", status: "critical", icon: "alert" },
  { label: "Risks", value: 2, subtitle: "Require attention", status: "high", icon: "warning" },
  { label: "Approvals", value: 3, subtitle: "Waiting for you", status: "pending", icon: "check" },
  { label: "Upcoming Meeting", value: 1, subtitle: "Today at 4:00 PM", status: "info", icon: "calendar" },
];

export const homeAlerts: Alert[] = [
  {
    title: "Mobile Launch is at risk",
    severity: "Critical",
    description: "QA progress is at 18% vs required 80%.",
    tags: ["Mobile Launch", "QA"],
    time: "2h ago",
    action: "Review",
    group: "Today",
  },
  {
    title: "Acme Corp renewal at risk",
    severity: "High",
    description: "No meaningful activity for 11 days.",
    tags: ["Acme Corp"],
    time: "4h ago",
    action: "Review",
    group: "Today",
  },
  {
    title: "Engineering capacity exceeded",
    severity: "Medium",
    description: "Team is over capacity by 18%.",
    tags: ["Engineering"],
    time: "6h ago",
    action: "Review",
    group: "Today",
  },
  {
    title: "Security alert resolved",
    severity: "Info",
    description: "Unusual login attempt blocked for 2 users.",
    tags: ["Security"],
    time: "8h ago",
    action: "View",
    group: "Today",
  },
];

export const focusItems: FocusItem[] = [
  { title: "Mobile Launch", status: "At Risk", statusTone: "at-risk", progress: 18, due: "Due Aug 21", icon: "rocket" },
  { title: "Hiring Plan", status: "Approval pending", statusTone: "pending", progress: 60, due: "Due Jul 10", icon: "users" },
  { title: "Pricing Strategy", status: "In Progress", statusTone: "info", progress: 70, due: "Due Jul 15", icon: "tag" },
  { title: "Acme Renewal", status: "At Risk", statusTone: "at-risk", progress: 40, due: "Due Jul 18", icon: "building" },
];

export const scheduleItems: ScheduleItem[] = [
  { time: "10:00 AM", title: "Product Review" },
  { time: "12:00 PM", title: "1:1 with CTO" },
  { time: "4:00 PM", title: "Board Meeting", badge: "AI Brief Ready", highlight: true },
  { time: "6:00 PM", title: "Investor Call" },
];

export const homePrompts = [
  "What changed overnight?",
  "Why is the launch at risk?",
  "Prepare board meeting brief",
  "Show customer risks",
];

export const chatStarters = [
  { id: "worry", title: "What's worrying me", prompt: "What's worrying me right now?", icon: "alert" },
  { id: "sales", title: "Increase sales", prompt: "How can I increase sales?", icon: "search" },
  { id: "teach", title: "Teach me sales", prompt: "Teach me enterprise sales.", icon: "file" },
  { id: "northstar", title: "Northstar at risk", prompt: "Why is Northstar at risk?", icon: "gavel" },
  { id: "month", title: "This month", prompt: "What should we prioritize this month?", icon: "clock" },
  { id: "churn", title: "Brainstorm churn", prompt: "Brainstorm ways to reduce churn.", icon: "tasks" },
  { id: "missing", title: "What are we missing?", prompt: "What are we missing?", icon: "file" },
] as const;

export const chatSeedRecents = [
  {
    id: "seed:q3",
    title: "Why is the Q3 launch delayed?",
    summary: "Analysed 48 signals • 3 risks identified",
    when: "10:24 AM",
  },
  {
    id: "seed:campaign",
    title: "Review the marketing campaign performance",
    summary: "Analysed 32 signals • Summary ready",
    when: "Yesterday",
  },
  {
    id: "seed:hiring",
    title: "Prepare decision: Increase hiring budget",
    summary: "Prepared draft • Awaiting your review",
    when: "Yesterday",
  },
  {
    id: "seed:deps",
    title: "Show me all critical dependencies",
    summary: "Analysed 20 dependencies",
    when: "2 days ago",
  },
];

export const chatCapabilities = [
  "Analyse signals",
  "Identify risks",
  "Recommend decisions",
  "Create tasks",
  "Brief executives",
  "Execute after you approve",
];

export const chatDemoFindings = [
  "Payment API credentials still pending from Finance (blocked 4 days)",
  "QA capacity is below the 80% completion gate for launch",
  "Marketing launch assets are waiting on a confirmed date",
];

export const chatDemoBlocker = {
  chain: ["Finance", "API Credentials", "Engineering"],
  href: "/execute",
};

export const chatDemoActions = [
  {
    id: "demo:creds",
    label: "Provide API credentials",
    owner: "Priya Nair",
    role: "Finance",
    impact: "Unblocks Engineering",
    priority: "High" as const,
  },
  {
    id: "demo:realloc",
    label: "Reallocate 2 engineers to QA",
    owner: "Marcus Chen",
    role: "Eng Lead",
    impact: "Unblocks QA",
    priority: "High" as const,
  },
  {
    id: "demo:date",
    label: "Update launch date in roadmap",
    owner: "Aisha Khan",
    role: "PMO",
    impact: "Aligns Marketing",
    priority: "Medium" as const,
  },
  {
    id: "demo:notify",
    label: "Notify marketing team",
    owner: "Jordan Lee",
    role: "Marketing",
    impact: "Stakeholder sync",
    priority: "Medium" as const,
  },
];

export const entityTabs = [
  { label: "All", href: "/brain", count: null },
  { label: "Graph", href: "/brain/graph", count: null },
  { label: "People", href: "/brain/people", count: null },
  { label: "Projects", href: "/brain/projects", count: null },
  { label: "Decisions", href: "/decide", count: null },
  { label: "Meetings", href: "/brain/meetings", count: null },
  { label: "Customers", href: "/brain/customers", count: null },
  { label: "Documents", href: "/brain/documents", count: null },
  { label: "Signals", href: "/signals", count: null },
];

export const entityCounts: EntityCount[] = [
  { label: "People", count: 128, href: "/brain/people", icon: "users", tone: "purple" },
  { label: "Projects", count: 34, href: "/brain/projects", icon: "folder", tone: "info" },
  { label: "Customers", count: 56, href: "/brain/customers", icon: "building", tone: "low" },
  { label: "Decisions", count: 87, href: "/brain/decisions", icon: "gavel", tone: "medium" },
  { label: "Meetings", count: 142, href: "/brain/meetings", icon: "calendar", tone: "cyan" },
  { label: "Documents", count: 645, href: "/brain/documents", icon: "file", tone: "high" },
];

export const kgNodes: KGNode[] = [
  {
    id: "init-mobile", kind: "initiative", tone: "red", center: true,
    title: "Mobile Launch", subtitle: "Strategic Initiative",
    x: 50, y: 50,
    pill: { label: "At Risk", tone: "critical" }, risky: true,
    why: "QA completion is 18% against a required 80%. A slip here puts $180K of Q3 revenue at risk.",
    impact: "High", confidence: "91%",
  },
  {
    id: "goal-arr", kind: "goal", tone: "gold",
    title: "Board Goal", subtitle: "Grow ARR 30%",
    x: 50, y: 9,
    why: "The mobile launch is the largest single contributor to this year's ARR target.",
    impact: "High", confidence: "72%",
  },
  {
    id: "sig-cust", kind: "signal", tone: "green",
    title: "Customer Feedback", subtitle: "NPS dropped 12%",
    x: 21, y: 22, risky: true,
    why: "Sentiment is trending down ahead of launch, concentrated in mobile onboarding.",
    impact: "Medium", confidence: "68%",
  },
  {
    id: "sig-qa", kind: "signal", tone: "blue",
    title: "QA Progress", subtitle: "18% complete",
    x: 79, y: 22, risky: true,
    why: "QA is the binding constraint on the launch date. It is blocking the go / no-go decision.",
    impact: "High", confidence: "94%",
  },
  {
    id: "init-pricing", kind: "initiative", tone: "purple",
    title: "Pricing Strategy", subtitle: "Review in progress",
    x: 12, y: 50,
    why: "Launch pricing is still unresolved, so the mobile launch depends on this review closing.",
    impact: "Medium", confidence: "61%",
  },
  {
    id: "init-marketing", kind: "initiative", tone: "orange",
    title: "Marketing Plan", subtitle: "Campaign in review",
    x: 88, y: 50,
    why: "Go-to-market timing is pinned to the launch date and moves with it.",
    impact: "Medium", confidence: "70%",
  },
  {
    id: "sig-eng", kind: "signal", tone: "blue",
    title: "Engineering Capacity", subtitle: "Overloaded",
    x: 21, y: 79, risky: true,
    why: "The team is 18% over capacity across two active initiatives, slowing QA burn-down.",
    impact: "High", confidence: "83%",
  },
  {
    id: "cust-acme", kind: "customer", tone: "green",
    title: "Acme Corp Renewal", subtitle: "At Risk · $190K",
    x: 79, y: 79, risky: true,
    why: "Acme's renewal is tied to mobile parity. Eleven days of no engagement raises churn risk.",
    impact: "High", confidence: "82%",
  },
  {
    id: "dec-launch", kind: "decision", tone: "gold",
    title: "Launch Decision", subtitle: "Pending",
    x: 50, y: 92,
    pill: { label: "Pending", tone: "pending" },
    why: "Awaiting your approval. Committing writes an auditable entry to the decision ledger.",
    impact: "High", confidence: "71%",
  },
];

export const kgEdges: KGEdge[] = [
  { from: "goal-arr", to: "init-mobile", kind: "drives", label: "drives", pct: "72%" },
  { from: "sig-cust", to: "init-mobile", kind: "influences", label: "influences", pct: "68%" },
  { from: "sig-qa", to: "init-mobile", kind: "blocks", label: "blocking", pct: "94%" },
  { from: "init-pricing", to: "init-mobile", kind: "depends", label: "depends on", pct: "61%" },
  { from: "init-mobile", to: "init-marketing", kind: "related", label: "related to", pct: "70%" },
  { from: "sig-eng", to: "init-mobile", kind: "influences", label: "impacted by", pct: "83%" },
  { from: "init-mobile", to: "cust-acme", kind: "affects", label: "affects", pct: "82%" },
  { from: "dec-launch", to: "init-mobile", kind: "requires", label: "requires decision", pct: "71%" },
];

export const recentlyAccessed = [
  { title: "Mobile Launch Decision", meta: "Decision · 2h ago", icon: "gavel" },
  { title: "Q2 Board Meeting", meta: "Meeting · Yesterday", icon: "calendar" },
  { title: "Acme Corp Renewal", meta: "Customer · 1d ago", icon: "building" },
  { title: "Hiring Plan - Engineers", meta: "Document · 2d ago", icon: "file" },
  { title: "Pricing Strategy Doc", meta: "Document · 3d ago", icon: "file" },
];

export const brainInsights = [
  "3 decisions from last month are missing execution updates.",
  "Acme Corp shows increasing risk based on engagement signals.",
  "Engineering capacity is the top constraint for 2 active initiatives.",
];

export const dataSources = [
  { name: "Slack", status: "Connected" },
  { name: "Jira", status: "Connected" },
  { name: "Google Drive", status: "Connected" },
  { name: "Notion", status: "Disconnected" },
  { name: "Gmail", status: "Connected" },
];

export const recentActivity = [
  {
    title: "QA Progress Update",
    type: "Signal",
    updated: "2h ago",
    connected: "Mobile Launch, Engineering Capacity",
  },
  {
    title: "Board Meeting - May 31",
    type: "Meeting",
    updated: "5h ago",
    connected: "Mobile Launch, Pricing Strategy",
  },
  {
    title: "Acme Corp - No activity",
    type: "Signal",
    updated: "6h ago",
    connected: "Acme Corp Renewal",
  },
];

export const peopleRows = [
  { person: "Aisha Khan", role: "VP Engineering", team: "Engineering", focus: "Mobile Launch", load: "118%", status: "Overloaded" },
  { person: "Marcus Chen", role: "CTO", team: "Leadership", focus: "Architecture", load: "92%", status: "Healthy" },
  { person: "Priya Nair", role: "Head of Product", team: "Product", focus: "Roadmap", load: "88%", status: "Healthy" },
  { person: "Jordan Lee", role: "QA Lead", team: "Quality", focus: "Beta Release", load: "105%", status: "At Risk" },
  { person: "Sofia Alvarez", role: "Account Exec", team: "Sales", focus: "Acme Renewal", load: "76%", status: "Healthy" },
  { person: "Noah Patel", role: "Designer", team: "Design", focus: "Design System", load: "110%", status: "At Risk" },
];

export const projectRows = [
  { project: "Mobile Launch", owner: "Sarah Chen", status: "At Risk", health: "76", progress: "76%", target: "Dec 31", slug: "mobile-launch" },
  { project: "Mobile App Development", owner: "Aisha Khan", status: "At Risk", health: "61", progress: "58%", target: "Aug 21", slug: "mobile-app-development" },
  { project: "Backend & Infrastructure", owner: "Marcus Chen", status: "On Track", health: "78", progress: "64%", target: "Aug 10", slug: "backend-infrastructure" },
  { project: "Go-to-Market", owner: "Priya Nair", status: "At Risk", health: "52", progress: "40%", target: "Aug 28", slug: "go-to-market" },
  { project: "Analytics Platform", owner: "Jordan Lee", status: "On Track", health: "84", progress: "71%", target: "Sep 12", slug: "analytics-platform" },
  { project: "Project Orion", owner: "Sofia Alvarez", status: "Pending", health: "66", progress: "35%", target: "Oct 01", slug: "project-orion" },
];

export type ProjectDetail = {
  slug: string;
  title: string;
  type: string;
  subtitle: string;
  description: string;
  descriptionFull: string;
  owner: { name: string; initials: string };
  team: string;
  priority: string;
  status: string;
  health: number;
  lastUpdated: string;
  progress: number;
  progressLabel: string;
  targetDate: string;
  impact: string;
  impactLabel: string;
  impactConfidence: number;
  impactTone: string;
  daysToTarget: number;
  daysRisk: string;
  budgetUsed: number;
  budgetTotal: number;
  budgetPct: number;
  budgetStatus: string;
  healthTrend: string;
  tabs: Array<{ label: string; count?: number }>;
  phases: Array<{ name: string; start: number; end: number; progress: number }>;
  timelineMonths: string[];
  todayIndex: number;
  meetings: Array<{ title: string; when: string; avatars: string[] }>;
  activity: Array<{ text: string; who: string; when: string; tone?: string }>;
  radar: Array<{ label: string; value: number }>;
  risks: Array<{ title: string; meta: string; priority: string }>;
  stakeholders: Array<{ name: string; role: string; initials: string }>;
};

const mobileLaunchDetail: ProjectDetail = {
  slug: "mobile-launch",
  title: "Mobile Launch",
  type: "Strategic Initiative",
  subtitle: "Accelerating our mobile platform launch to expand user reach and drive ARR growth.",
  description:
    "This initiative covers MVP development, beta testing, go-to-market, and rollout for the Hustronix mobile platform. Success unlocks $180K ARR and expands reach across enterprise accounts.",
  descriptionFull:
    "This initiative covers MVP development, beta testing, go-to-market, and rollout for the Hustronix mobile platform. Success unlocks $180K ARR and expands reach across enterprise accounts. QA capacity is the binding constraint — completion sits at 18% vs an 80% go/no-go gate. Engineering is 18% over allocated capacity, and marketing timing is pinned to the December 31 target.",
  owner: { name: "Sarah Chen", initials: "SC" },
  team: "Engineering",
  priority: "High",
  status: "At Risk",
  health: 76,
  lastUpdated: "2h ago",
  progress: 76,
  progressLabel: "On Track",
  targetDate: "Dec 31, 2025",
  impact: "$180K",
  impactLabel: "Annual Revenue",
  impactConfidence: 82,
  impactTone: "High",
  daysToTarget: 68,
  daysRisk: "At Risk of Delay",
  budgetUsed: 320,
  budgetTotal: 400,
  budgetPct: 80,
  budgetStatus: "On Track",
  healthTrend: "Declining 8%",
  tabs: [
    { label: "Overview" },
    { label: "Decisions", count: 12 },
    { label: "Tasks", count: 48 },
    { label: "Meetings", count: 16 },
    { label: "Documents", count: 24 },
    { label: "Signals", count: 32 },
    { label: "Dependencies", count: 8 },
    { label: "Insights" },
  ],
  phases: [
    { name: "MVP Development", start: 0, end: 2.2, progress: 100 },
    { name: "Beta Testing", start: 2, end: 3.5, progress: 85 },
    { name: "Marketing Campaign", start: 4, end: 5.5, progress: 60 },
    { name: "Launch & Rollout", start: 5, end: 7.5, progress: 25 },
  ],
  timelineMonths: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  todayIndex: 1.65,
  meetings: [
    { title: "Mobile Launch Weekly Sync", when: "Tomorrow · 10:00 AM", avatars: ["SC", "AK", "JL"] },
    { title: "Engineering Review", when: "Wed · 2:00 PM", avatars: ["MC", "AK", "SP"] },
    { title: "Beta Readiness Check", when: "Fri · 11:30 AM", avatars: ["JL", "PN", "SC"] },
  ],
  activity: [
    { text: "Decision updated — Delay Mobile Launch under review", who: "Spandan Patil", when: "28m ago", tone: "decision" },
    { text: "Task completed — Push notification QA checklist", who: "Jordan Lee", when: "1h ago", tone: "task" },
    { text: "Signal raised — QA progress stalled at 18%", who: "System", when: "2h ago", tone: "signal" },
    { text: "Document updated — Mobile Launch PRD v1.4", who: "Priya Nair", when: "4h ago", tone: "doc" },
  ],
  radar: [
    { label: "Alignment", value: 78 },
    { label: "Progress", value: 76 },
    { label: "Execution", value: 62 },
    { label: "Risk", value: 48 },
    { label: "Resources", value: 55 },
  ],
  risks: [
    { title: "QA team capacity constraints", meta: "Impact High · Prob High", priority: "High" },
    { title: "Beta signup velocity below plan", meta: "Impact Medium · Prob Medium", priority: "Medium" },
    { title: "Marketing campaign dependency", meta: "Impact Medium · Prob Low", priority: "Low" },
    { title: "App store review lead time", meta: "Impact High · Prob Medium", priority: "High" },
  ],
  stakeholders: [
    { name: "Sarah Chen", role: "Owner", initials: "SC" },
    { name: "Vikram Iyer", role: "Sponsor", initials: "VI" },
    { name: "Aisha Khan", role: "Contributor", initials: "AK" },
    { name: "Jordan Lee", role: "Contributor", initials: "JL" },
  ],
};

function slugifyProject(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const projectDetailsBySlug: Record<string, ProjectDetail> = {
  "mobile-launch": mobileLaunchDetail,
};

export function getProjectDetail(slug: string): ProjectDetail | null {
  if (projectDetailsBySlug[slug]) return projectDetailsBySlug[slug];
  const row = projectRows.find((r) => r.slug === slug || slugifyProject(r.project) === slug);
  if (!row) return null;
  return {
    ...mobileLaunchDetail,
    slug,
    title: row.project,
    subtitle: `Project overview for ${row.project}.`,
    description: `${row.project} is tracked in Company Brain with owner ${row.owner}.`,
    descriptionFull: `${row.project} is tracked in Company Brain with owner ${row.owner}. Health ${row.health}, progress ${row.progress}, target ${row.target}.`,
    owner: { name: row.owner, initials: row.owner.split(" ").map((p) => p[0]).join("").slice(0, 2) },
    status: row.status,
    health: Number(row.health),
    progress: Number(String(row.progress).replace("%", "")),
    targetDate: row.target,
  };
}

export const projectDetailPrompts = [
  "Why is this project at risk?",
  "What are the key blockers?",
  "Show me the impact if delayed",
  "What decisions are pending?",
];

export const decisionRows = [
  { decision: "Delay Mobile Launch", type: "Strategic", status: "Waiting for you", confidence: "91%", impact: "High", decided: "—", owner: "Spandan Patil" },
  { decision: "Engineering Hiring Request", type: "Operational", status: "Waiting for you", confidence: "87%", impact: "High", decided: "—", owner: "Aisha Khan" },
  { decision: "Acme Corp Renewal Plan", type: "Customer", status: "Pending", confidence: "82%", impact: "High", decided: "—", owner: "Sofia Alvarez" },
  { decision: "Q3 Marketing Budget", type: "Financial", status: "Analysis", confidence: "74%", impact: "Medium", decided: "—", owner: "Priya Nair" },
  { decision: "Enter Europe Market", type: "Strategic", status: "Intake", confidence: "68%", impact: "High", decided: "—", owner: "Spandan Patil" },
];

export const meetingRows = [
  { meeting: "Product Review", date: "Today · 10:00 AM", participants: "8", topics: "Mobile Launch, QA", outcomes: "Pending" },
  { meeting: "1:1 with CTO", date: "Today · 12:00 PM", participants: "2", topics: "Capacity, hiring", outcomes: "Pending" },
  { meeting: "Board Meeting", date: "Today · 4:00 PM", participants: "11", topics: "ARR, launch risk", outcomes: "AI Brief Ready" },
  { meeting: "Investor Call", date: "Today · 6:00 PM", participants: "5", topics: "Runway, pipeline", outcomes: "Pending" },
  { meeting: "Q2 Board Meeting", date: "May 31", participants: "12", topics: "OKRs, pricing", outcomes: "Decided" },
];

export const customerRows = [
  { customer: "Acme Corp", health: "At Risk", arr: "$180K", last: "11 days ago", stage: "Renewal", owner: "Sofia Alvarez" },
  { customer: "Northwind Labs", health: "Healthy", arr: "$96K", last: "2 days ago", stage: "Expansion", owner: "Sofia Alvarez" },
  { customer: "Globex Systems", health: "Caution", arr: "$240K", last: "5 days ago", stage: "Active", owner: "Marcus Chen" },
  { customer: "Initech", health: "Healthy", arr: "$72K", last: "1 day ago", stage: "Onboarding", owner: "Priya Nair" },
  { customer: "Umbrella Health", health: "Healthy", arr: "$155K", last: "3 days ago", stage: "Active", owner: "Jordan Lee" },
];

export const documentRows = [
  { document: "Mobile Launch PRD", type: "PRD", context: "Mobile Launch", updated: "2h ago", owner: "Priya Nair" },
  { document: "Pricing Strategy Doc", type: "Strategy", context: "Pricing Strategy", updated: "1d ago", owner: "Spandan Patil" },
  { document: "Hiring Plan - Engineers", type: "Plan", context: "Engineering", updated: "2d ago", owner: "Aisha Khan" },
  { document: "Board Deck Q2", type: "Deck", context: "Board", updated: "4d ago", owner: "Spandan Patil" },
  { document: "Acme Renewal Brief", type: "Brief", context: "Acme Corp", updated: "5d ago", owner: "Sofia Alvarez" },
];

export const signalRows = [
  { signal: "QA progress stalled", source: "Jira", context: "Mobile Launch", detected: "2h ago", importance: "Critical", status: "Open" },
  { signal: "Acme engagement drop", source: "Salesforce", context: "Acme Corp", detected: "4h ago", importance: "High", status: "Open" },
  { signal: "Engineering overload", source: "Linear", context: "Capacity", detected: "6h ago", importance: "Medium", status: "Open" },
  { signal: "MRR below forecast", source: "HubSpot", context: "Revenue", detected: "8h ago", importance: "High", status: "Open" },
  { signal: "Unusual login blocked", source: "Datadog", context: "Security", detected: "Yesterday", importance: "Info", status: "Resolved" },
];

export const integrations = [
  { name: "Slack", slug: "slack", lastSync: "2 min ago" },
  { name: "Jira", slug: "jira", lastSync: "8 min ago" },
  { name: "Google Drive", slug: "google-drive", lastSync: "14 min ago" },
  { name: "Notion", slug: "notion", lastSync: "21 min ago" },
  { name: "GitHub", slug: "github", lastSync: "5 min ago" },
  { name: "Linear", slug: "linear", lastSync: "11 min ago" },
  { name: "Salesforce", slug: "salesforce", lastSync: "18 min ago" },
  { name: "HubSpot", slug: "hubspot", lastSync: "27 min ago" },
  { name: "Calendly", slug: "calendly", lastSync: "33 min ago" },
  { name: "Zoom", slug: "zoom", lastSync: "41 min ago" },
  { name: "Gmail", slug: "google-mail", lastSync: "9 min ago" },
  { name: "Datadog", slug: "datadog", lastSync: "16 min ago" },
];

export const recommendations: Recommendation[] = [
  {
    rank: 1,
    title: "Delay Mobile Launch by 5 Days",
    status: "At Risk",
    statusTone: "at-risk",
    explanation: "QA completion is 18% vs required 80%. Current trajectory indicates a 9 day delay.",
    confidence: 91,
    impact: "High",
    impactDetail: "-$180K risk",
    effort: "Low",
    source: "Company Brain · QA + Capacity",
  },
  {
    rank: 2,
    title: "Approve Engineering Hiring Request",
    status: "High Impact",
    statusTone: "high",
    explanation: "Capacity is overloaded by 18%. Two active initiatives are constrained by engineering bandwidth.",
    confidence: 87,
    impact: "High",
    impactDetail: "+$320K value",
    effort: "Medium",
    source: "Company Brain · Hiring Plan",
  },
  {
    rank: 3,
    title: "Call Acme Corp Before Renewal",
    status: "High Impact",
    statusTone: "low",
    explanation: "Engagement score dropped to 32. No meaningful activity for 11 days on a $180K renewal.",
    confidence: 82,
    impact: "High",
    impactDetail: "+$150K protect",
    effort: "Low",
    source: "Company Brain · Customer Signals",
  },
  {
    rank: 4,
    title: "Reallocate Budget from Project Orion",
    status: "Medium Impact",
    statusTone: "info",
    explanation: "Orion utilization is low while Mobile Launch and GTM need immediate funding flexibility.",
    confidence: 74,
    impact: "Medium",
    impactDetail: "+$90K value",
    effort: "Medium",
    source: "Company Brain · Budget Models",
  },
];

export const openDecisions: Decision[] = [
  { title: "Mobile Launch Delay", type: "Strategic", owner: "Spandan Patil", impact: "High", deadline: "Today, 2:00 PM", age: "2d", status: "Waiting for you" },
  { title: "Engineering Hiring Request", type: "Operational", owner: "Aisha Khan", impact: "High", deadline: "Jul 10", age: "4d", status: "Waiting for you" },
  { title: "Acme Corp Renewal Plan", type: "Customer", owner: "Sofia Alvarez", impact: "High", deadline: "Jul 18", age: "6d", status: "Pending" },
  { title: "Q3 Marketing Budget", type: "Financial", owner: "Priya Nair", impact: "Medium", deadline: "Jul 22", age: "8d", status: "Pending" },
  { title: "Enter Europe Market", type: "Strategic", owner: "Spandan Patil", impact: "High", deadline: "Aug 01", age: "12d", status: "Pending" },
];

export const decidePrompts = [
  "What should we decide next?",
  "Show me high impact decisions",
  "Which drafts need a commit?",
  "What is blocked on the ledger?",
];

export const executeMetrics: Metric[] = [
  { label: "Active Decisions", value: 12, subtitle: "Across all spaces", status: "info" },
  { label: "On Track", value: 7, subtitle: "58% of total", status: "healthy" },
  { label: "At Risk", value: 3, subtitle: "25% of total", status: "at-risk" },
  { label: "Off Track", value: 2, subtitle: "17% of total", status: "critical" },
];

export const activeExecutionDecisions = [
  { title: "Mobile Launch", start: "May 12", progress: 58, status: "At Risk", due: "Aug 21", avatars: ["SP", "AK", "JL"], decisionId: "", completionEligible: false },
  { title: "Q3 Marketing Budget", start: "Jun 02", progress: 64, status: "On Track", due: "Jul 22", avatars: ["PN", "SA"], decisionId: "", completionEligible: false },
  { title: "Acme Renewal Plan", start: "Jun 18", progress: 41, status: "At Risk", due: "Jul 18", avatars: ["SA", "SP"], decisionId: "", completionEligible: false },
  { title: "Engineering Hiring", start: "Jun 20", progress: 72, status: "On Track", due: "Jul 10", avatars: ["AK", "NP", "JL"], decisionId: "", completionEligible: false },
];

export const capacityData = [
  { team: "Engineering", over: 28, optimal: 52, under: 20 },
  { team: "Product", over: 10, optimal: 70, under: 20 },
  { team: "Design", over: 22, optimal: 48, under: 30 },
  { team: "QA", over: 35, optimal: 40, under: 25 },
  { team: "Marketing", over: 8, optimal: 62, under: 30 },
  { team: "Sales", over: 5, optimal: 75, under: 20 },
];

export const blockers = [
  { title: "Payment gateway integration", severity: "Critical", since: "Since 2 days", owner: "AK", note: "Blocking 2 milestones" },
  { title: "Design system not finalized", severity: "High", since: "Since 5 days", owner: "NP", note: "Blocking 1 milestone" },
  { title: "QA environment instability", severity: "Medium", since: "Since 1 day", owner: "JL", note: "Blocking 3 milestones" },
];

export const executionInsights = [
  "Mobile Launch is 9 days behind the original plan based on current velocity.",
  "Engineering team is over capacity by 18% across three concurrent initiatives.",
  "Beta onboarding completion is the weakest adoption lever this week.",
];

export const executePrompts = [
  "Why is launch behind schedule?",
  "What are the biggest blockers?",
  "Show me at-risk decisions",
  "Rebalance team capacity",
];

export const alertFilters = [
  { label: "All Alerts", count: 28 },
  { label: "Critical", count: 3 },
  { label: "High", count: 7 },
  { label: "Medium", count: 11 },
  { label: "Low", count: 7 },
  { label: "Info", count: 0 },
];

export const alerts: Alert[] = [
  {
    title: "Mobile Launch is at risk",
    severity: "Critical",
    description: "QA progress is at 18% vs required 80%. Current trajectory indicates 9 day delay.",
    tags: ["Mobile Launch", "QA, Engineering"],
    time: "28m ago",
    action: "Review",
    group: "Today",
  },
  {
    title: "Acme Corp inactive for 11 days",
    severity: "High",
    description: "No meaningful activity for 11 days. Engagement score dropped to 32 (low).",
    tags: ["Acme Corp", "Customer Success"],
    time: "1h ago",
    action: "Take Action",
    group: "Today",
  },
  {
    title: "Board Meeting in 2 days",
    severity: "High",
    description: "Launch risk briefing still incomplete. Decision pack missing QA status.",
    tags: ["Board", "Mobile Launch"],
    time: "2h ago",
    action: "Prepare Brief",
    group: "Today",
  },
  {
    title: "Engineering capacity exceeded",
    severity: "Medium",
    description: "Team is over capacity by 18%. 3 projects may be impacted.",
    tags: ["Engineering", "Capacity"],
    time: "3h ago",
    action: "Analyze",
    group: "Today",
  },
  {
    title: "Hiring request pending",
    severity: "Medium",
    description: "2 engineer roles awaiting approval. Capacity remains overloaded.",
    tags: ["People", "Hiring"],
    time: "5h ago",
    action: "Review",
    group: "Today",
  },
  {
    title: "Q2 Financials updated",
    severity: "Low",
    description: "Finance uploaded revised Q2 numbers to Company Brain.",
    tags: ["Finance", "Documents"],
    time: "8h ago",
    action: "Open",
    group: "Today",
  },
  {
    title: "Marketing campaign underperforming",
    severity: "Medium",
    description: "Campaign CTR is 38% below target after 4 days live.",
    tags: ["Marketing", "GTM"],
    time: "Yesterday",
    action: "Analyze",
    group: "Yesterday",
  },
];

export const moreAlerts: Alert[] = [
  {
    title: "Payment gateway integration failing",
    severity: "Critical",
    description: "Checkout success rate dropped to 62%. Blocking 2 launch milestones.",
    tags: ["Payments", "Engineering"],
    time: "45m ago",
    action: "Review",
    group: "Today",
  },
  {
    title: "Database latency high",
    severity: "Critical",
    description: "P95 latency is 820ms (>500ms threshold) on the primary cluster.",
    tags: ["Infrastructure"],
    time: "1h ago",
    action: "Investigate",
    group: "Today",
  },
  {
    title: "PRD for Analytics Platform updated",
    severity: "Low",
    description: "Analytics Platform PRD v1.3 updated by Vikram Iyer.",
    tags: ["Analytics Platform", "Product"],
    time: "Yesterday, 8:45 PM",
    action: "View",
    group: "Yesterday",
  },
  {
    title: "New enterprise lead qualified",
    severity: "Low",
    description: "Globex Corp ($240K potential) moved to qualified pipeline.",
    tags: ["Sales", "Pipeline"],
    time: "Yesterday, 4:10 PM",
    action: "Open",
    group: "Yesterday",
  },
  {
    title: "Security alert resolved",
    severity: "Info",
    description: "Unusual login attempt detected and blocked for 2 users.",
    tags: ["Security", "IT"],
    time: "Yesterday, 2:30 PM",
    action: "View Summary",
    group: "Yesterday",
  },
];

export const criticalNow = [
  { title: "Mobile Launch at risk", meta: "QA 18% · 28m ago" },
  { title: "Acme Corp inactive", meta: "$180K renewal · 1h ago" },
  { title: "Board briefing incomplete", meta: "In 2 days · 2h ago" },
];

export const riskWindows = [
  { title: "Board Meeting", when: "In 2 days", note: "May 31 · Launch risk briefing" },
  { title: "Mobile Launch", when: "In 22 days", note: "Aug 21 · QA gate unmet" },
  { title: "Acme Renewal", when: "In 12 days", note: "Jul 18 · No stakeholder touch" },
];

export const alertPrompts = [
  "Why is mobile launch at risk?",
  "What's the impact of these alerts?",
  "Show me all customer risks",
  "What should I focus on today?",
];

export const brainPrompts = [
  "What is on the ledger right now?",
  "Show me the blockers",
  "Which signals are unverified?",
  "Summarize open decisions",
];

export const settingsPrompts = [
  "How do notification rules work?",
  "What can owners change?",
  "Explain AI preference defaults",
  "Show security recommendations",
];

export const helpPrompts = [
  "How do I commit a decision?",
  "Where do alerts come from?",
  "Explain Mission Control",
  "How does Company Brain work?",
];

export function composerForPath(pathname: string): { placeholder: string; prompts: string[] } {
  if (pathname.startsWith("/signals") || pathname.startsWith("/brain/signals")) {
    return { placeholder: "Ask Hustronix about a signal...", prompts: alertPrompts };
  }
  if (pathname.startsWith("/alerts")) {
    return { placeholder: "Ask Hustronix about any alert...", prompts: alertPrompts };
  }
  if (pathname.startsWith("/decide")) {
    return { placeholder: "Ask Hustronix about any decision...", prompts: decidePrompts };
  }
  if (pathname.startsWith("/execute") || pathname.startsWith("/tasks")) {
    return { placeholder: "Ask Hustronix about this work...", prompts: executePrompts };
  }
  if (pathname.startsWith("/chat")) {
    return { placeholder: "Ask, investigate, decide, or execute...", prompts: homePrompts };
  }
  if (pathname.startsWith("/team")) {
    return { placeholder: "Ask Hustronix about ownership or load...", prompts: executePrompts };
  }
  if (pathname.startsWith("/analytics")) {
    return { placeholder: "Ask why execution health changed...", prompts: decidePrompts };
  }
  if (pathname.startsWith("/brain/projects/") && pathname !== "/brain/projects") {
    return { placeholder: "Ask Hustronix about this project...", prompts: projectDetailPrompts };
  }
  if (pathname.startsWith("/brain")) {
    return { placeholder: "Ask Hustronix about this graph...", prompts: brainPrompts };
  }
  if (pathname.startsWith("/settings")) {
    return { placeholder: "Ask Hustronix about settings...", prompts: settingsPrompts };
  }
  if (pathname.startsWith("/help")) {
    return { placeholder: "Ask Hustronix for help...", prompts: helpPrompts };
  }
  return { placeholder: "Ask Hustronix", prompts: homePrompts };
}

export const settingsCategories = [
  {
    id: "general",
    href: "/settings/general",
    title: "General",
    description: "Workspace details, localization, and display preferences",
    icon: "sliders",
  },
  {
    id: "profile",
    href: "/settings/profile",
    title: "Profile",
    description: "Your personal information and account preferences",
    icon: "user",
  },
  {
    id: "users",
    href: "/settings/users",
    title: "Users & Teams",
    description: "Manage members, teams, and pending invitations",
    icon: "users",
  },
  {
    id: "roles",
    href: "/settings/roles",
    title: "Roles & Permissions",
    description: "Define access levels and permission matrices",
    icon: "shield",
  },
  {
    id: "spaces",
    href: "/settings/spaces",
    title: "Spaces",
    description: "Organize work across company and project spaces",
    icon: "layers",
  },
  {
    id: "integrations",
    href: "/settings/integrations",
    title: "Integrations",
    description: "Connect Slack, Jira, GitHub, and other tools",
    icon: "plug",
  },
  {
    id: "notifications",
    href: "/settings/notifications",
    title: "Notifications",
    description: "Channels and alert delivery preferences",
    icon: "bell",
  },
  {
    id: "ai",
    href: "/settings/ai",
    title: "AI Preferences",
    description: "Autonomy, approval, and what Hustronix is allowed to do",
    icon: "sparkles",
  },
  {
    id: "security",
    href: "/settings/security",
    title: "Security",
    description: "Password, 2FA, SSO, and active sessions",
    icon: "lock",
  },
  {
    id: "billing",
    href: "/settings/billing",
    title: "Billing",
    description: "Plan, usage, and payment settings",
    icon: "credit-card",
  },
  {
    id: "audit",
    href: "/settings/audit",
    title: "Audit Logs",
    description: "Review workspace activity and configuration changes",
    icon: "scroll",
  },
] as const;

export const settingsUsers = [
  {
    name: "Spandan Patil",
    email: "spandan.patil@hustronix.com",
    initials: "SP",
    role: "Owner",
    team: "Executive",
    lastActive: "Now",
    status: "Active",
  },
  {
    name: "Aisha Khan",
    email: "aisha.khan@hustronix.com",
    initials: "AK",
    role: "Admin",
    team: "Product",
    lastActive: "12 min ago",
    status: "Active",
  },
  {
    name: "Marcus Chen",
    email: "marcus.chen@hustronix.com",
    initials: "MC",
    role: "Manager",
    team: "Engineering",
    lastActive: "1 hr ago",
    status: "Active",
  },
  {
    name: "Priya Nair",
    email: "priya.nair@hustronix.com",
    initials: "PN",
    role: "Member",
    team: "Design",
    lastActive: "Yesterday",
    status: "Active",
  },
  {
    name: "Jordan Lee",
    email: "jordan.lee@hustronix.com",
    initials: "JL",
    role: "Viewer",
    team: "Finance",
    lastActive: "3 days ago",
    status: "Inactive",
  },
];

export const settingsTeams = [
  { name: "Executive", members: 3, lead: "Spandan Patil" },
  { name: "Product", members: 8, lead: "Aisha Khan" },
  { name: "Engineering", members: 14, lead: "Marcus Chen" },
  { name: "Design", members: 5, lead: "Priya Nair" },
];

export const settingsInvitations = [
  { email: "nina.park@partner.com", role: "Member", invited: "Aug 6", status: "Pending" },
  { email: "dev@contractor.io", role: "Viewer", invited: "Aug 4", status: "Expired" },
];

export const settingsRoles = [
  {
    name: "Owner",
    users: 1,
    description: "Full workspace control including billing and ownership transfer",
    updated: "Jul 12",
  },
  {
    name: "Admin",
    users: 3,
    description: "Manage users, integrations, and workspace configuration",
    updated: "Jul 28",
  },
  {
    name: "Manager",
    users: 6,
    description: "Create decisions, assign work, and manage team spaces",
    updated: "Aug 1",
  },
  {
    name: "Member",
    users: 18,
    description: "Contribute to decisions, projects, and day-to-day execution",
    updated: "Aug 3",
  },
  {
    name: "Viewer",
    users: 4,
    description: "Read-only access to dashboards, reports, and shared spaces",
    updated: "Jun 22",
  },
];

export const settingsPermissionMatrix = [
  { permission: "View Mission Control", Owner: true, Admin: true, Manager: true, Member: true, Viewer: true },
  { permission: "Commit decisions", Owner: true, Admin: true, Manager: true, Member: false, Viewer: false },
  { permission: "Manage users", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
  { permission: "Manage integrations", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
  { permission: "Billing & plan", Owner: true, Admin: false, Manager: false, Member: false, Viewer: false },
  { permission: "View audit logs", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
];

export const settingsSpaces = [
  {
    name: "Company",
    description: "Org-wide knowledge, decisions, and shared context",
    members: 24,
    projects: 87,
    status: "Active",
    icon: "building",
  },
  {
    name: "Mobile Launch",
    description: "Ship the mobile experience and launch readiness",
    members: 12,
    projects: 14,
    status: "Active",
    icon: "rocket",
  },
  {
    name: "Q3 OKRs",
    description: "Quarterly objectives and key results tracking",
    members: 18,
    projects: 9,
    status: "Active",
    icon: "target",
  },
  {
    name: "Enterprise Sales",
    description: "Pipeline, accounts, and deal execution",
    members: 9,
    projects: 22,
    status: "Active",
    icon: "briefcase",
  },
  {
    name: "AI Initiative",
    description: "Model strategy, evaluation, and rollout",
    members: 7,
    projects: 6,
    status: "Active",
    icon: "sparkles",
  },
  {
    name: "Pricing Strategy",
    description: "Packaging experiments and GTM alignment",
    members: 5,
    projects: 4,
    status: "Active",
    icon: "tag",
  },
];

export const settingsSessions = [
  {
    device: "MacBook Pro (Chrome)",
    location: "Pune, IN",
    lastActive: "Current",
    current: true,
  },
  {
    device: "iPhone 15 (Safari)",
    location: "Pune, IN",
    lastActive: "2 hr ago",
    current: false,
  },
  {
    device: "Windows Desktop (Edge)",
    location: "Mumbai, IN",
    lastActive: "Aug 5",
    current: false,
  },
];

export const settingsAuditLogs = [
  { time: "Aug 8 · 13:42", actor: "Spandan Patil", action: "Updated workspace localization", target: "General" },
  { time: "Aug 7 · 18:10", actor: "Aisha Khan", action: "Invited user", target: "jordan.lee@hustronix.com" },
  { time: "Aug 6 · 09:22", actor: "Marcus Chen", action: "Connected integration", target: "GitHub" },
  { time: "Aug 5 · 16:05", actor: "Spandan Patil", action: "Enabled 2FA", target: "Security" },
  { time: "Aug 4 · 11:48", actor: "Aisha Khan", action: "Created role", target: "Manager" },
];

export const helpTopics = [
  { title: "Company Brain", desc: "Explore knowledge and relationships" },
  { title: "Decide", desc: "Recommendations and decision health" },
  { title: "Execute", desc: "Maps, blockers, and capacity" },
  { title: "Alerts", desc: "Risk windows and severity filters" },
  { title: "Integrations", desc: "Connect Slack, Jira, Drive, more" },
  { title: "Settings", desc: "Profile, plan, and preferences" },
];

export const helpGuides = [
  "Welcome to Hustronix",
  "Connect your data",
  "Understand your company brain",
  "Make your first decision",
  "Track execution",
];

export const whatsNew = [
  { title: "Decision Health Score", meta: "Shipped · Jul 01" },
  { title: "Execution Map v2.0", meta: "Shipped · Jun 24" },
  { title: "Alerts with Action Suggestions", meta: "Shipped · Jun 18" },
];

export const faqs = [
  "How does Hustronix build the company brain?",
  "How does the decision engine work?",
  "Is my data secure?",
  "How are alerts generated?",
  "Can I integrate custom tools?",
  "Can I export my data?",
];

export const stageBars = [
  { label: "Intake", value: 12, max: 24 },
  { label: "Analysis", value: 18, max: 24 },
  { label: "Recommendation", value: 15, max: 24 },
  { label: "Decision", value: 9, max: 24 },
  { label: "Execution", value: 24, max: 24 },
];

export const recentDecisions = [
  { title: "Approve Q2 Pricing", result: "Approved", date: "Jun 28" },
  { title: "Pause Orion Phase 2", result: "Rejected", date: "Jun 22" },
  { title: "Expand Northwind", result: "Approved", date: "Jun 18" },
  { title: "Hire Design Lead", result: "Approved", date: "Jun 12" },
];

export const strategicDecisions = [
  { title: "Enter European Market", stage: "Analysis", progress: 60 },
  { title: "Platform Pricing Reset", stage: "Recommendation", progress: 78 },
  { title: "AI Initiative Funding", stage: "Intake", progress: 35 },
];

export const operationalDecisions = [
  { title: "Hiring - 2 Engineers", stage: "Decision", progress: 88 },
  { title: "QA Environment Upgrade", stage: "Execution", progress: 54 },
  { title: "Design System Freeze", stage: "Intake", progress: 22 },
];
