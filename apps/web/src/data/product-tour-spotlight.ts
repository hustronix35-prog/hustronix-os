/**
 * Spotlight tour steps — aligned with product-guide.ts narratives.
 * Targets use [data-tour="..."] selectors; empty target = centered popover on route.
 */

export type SpotlightTourSide = "top" | "bottom" | "left" | "right";

export type SpotlightTourStep = {
  id: string;
  route: string;
  /** CSS selector; empty string = body-level step (no highlight). */
  target: string;
  title: string;
  body: string;
  side?: SpotlightTourSide;
};

export const SPOTLIGHT_TOUR_STEPS: SpotlightTourStep[] = [
  {
    id: "nav-overview",
    route: "/mission-control",
    target: '[data-tour="nav-mission-control"]',
    title: "Your command center",
    body:
      "The sidebar is your map. Mission Control is the cockpit—start every review here to see the active bet, load, and what needs attention.",
    side: "right",
  },
  {
    id: "mc-summary",
    route: "/mission-control",
    target: '[data-tour="mc-summary"]',
    title: "Mission Control summary",
    body:
      "This panel pulls live data from the ledger: your current decision vow, execution counts, and signal noise. When the API has no data yet, placeholders show the layout—you will see real numbers as you log decisions.",
    side: "bottom",
  },
  {
    id: "mc-capacity",
    route: "/mission-control",
    target: '[data-tour="mc-capacity"]',
    title: "Capacity before new bets",
    body:
      "Capacity stops silent overload. Check load before committing the org to another big decision—this is how Hustronix helps you say no with evidence, not vibes.",
    side: "left",
  },
  {
    id: "mc-new-decision",
    route: "/mission-control",
    target: '[data-tour="mc-new-decision"]',
    title: "Log a decision",
    body:
      "Decisions are the source of truth—not slides. Capture a clear vow and outcomes here; executions and signals hang off what you commit in the ledger.",
    side: "bottom",
  },
  {
    id: "mc-decisions-panel",
    route: "/mission-control",
    target: '[data-tour="mc-decisions-panel"]',
    title: "Decisions table",
    body:
      "Draft decisions are hypotheses; ACTIVE means the org is truly committed. Commit or activate from here before heavy execution work begins.",
    side: "top",
  },
  {
    id: "mc-signals-preview",
    route: "/mission-control",
    target: '[data-tour="mc-signals-preview"]',
    title: "Signals preview",
    body:
      "External reality checks your bets—Slack, meetings, CRM, and more. Unverified items surface here so you triage before they drown prioritization.",
    side: "top",
  },
  {
    id: "nav-execute",
    route: "/execute",
    target: '[data-tour="nav-execute"]',
    title: "Execute — run the work",
    body:
      "Every task should trace to a decision. Execute is where work moves from ACTIVE to done, blocked, or killed.",
    side: "right",
  },
  {
    id: "exec-tabs",
    route: "/execute",
    target: '[data-tour="exec-tabs"]',
    title: "Execution states",
    body:
      "Filter by ACTIVE, BLOCKED, PENDING, or COMPLETED. Blocked work visible early prevents decisions from dying quietly in queues.",
    side: "bottom",
  },
  {
    id: "exec-task-list",
    route: "/execute",
    target: '[data-tour="exec-task-list"]',
    title: "Task list",
    body:
      "Select a row to inspect owners, context, and linked decision. Deep links from Mission Control or Chat land here with the task pre-selected.",
    side: "right",
  },
  {
    id: "exec-transition",
    route: "/execute",
    target: '[data-tour="exec-transition"]',
    title: "Move work forward",
    body:
      "Transition tasks when status changes—ACTIVE, DONE, or KILLED. The ledger and Reports stay honest only when execution state matches reality.",
    side: "left",
  },
  {
    id: "nav-signals",
    route: "/signals",
    target: '[data-tour="nav-signals"]',
    title: "Signals inbox",
    body:
      "Signals are evidence from the outside world. Verify what matters, link it to work, or kill noise so the queue stays trustworthy.",
    side: "right",
  },
  {
    id: "sig-tabs",
    route: "/signals",
    target: '[data-tour="sig-tabs"]',
    title: "Triage by status",
    body:
      "UNVERIFIED needs a human stance. LINKED ties an event to execution; KILLED retires distractions. An empty inbox is normal until connections ingest live events.",
    side: "bottom",
  },
  {
    id: "sig-link",
    route: "/signals",
    target: '[data-tour="sig-link"]',
    title: "Link to a decision",
    body:
      "When a signal should drive work, link it to a decision or task. That creates an audit trail from external stimulus to committed execution.",
    side: "top",
  },
  {
    id: "sig-kill",
    route: "/signals",
    target: '[data-tour="sig-kill"]',
    title: "Kill noise",
    body:
      "Not everything deserves attention. Killing a signal stops it from resurfacing and keeps prioritization honest for the team.",
    side: "top",
  },
  {
    id: "nav-chat",
    route: "/chat",
    target: '[data-tour="nav-chat"]',
    title: "Chat with context",
    body:
      "Unlike a generic LLM, Chat uses your org profile, ledger, and live sidebar intelligence—best for tradeoffs, risks, and structured drafts.",
    side: "right",
  },
  {
    id: "chat-context",
    route: "/chat",
    target: '[data-tour="chat-context"]',
    title: "Context panel",
    body:
      "Expand Context before hard questions. The agent reasons with tenant memory and current decision language from Mission Control.",
    side: "left",
  },
  {
    id: "chat-input",
    route: "/chat",
    target: '[data-tour="chat-input"]',
    title: "Live session",
    body:
      "Messages stream over WebSocket. Reference your active decision vow so answers stay aligned with what the org actually committed to.",
    side: "top",
  },
  {
    id: "chat-inspector",
    route: "/chat",
    target: '[data-tour="chat-inspector"]',
    title: "Inspector & quick actions",
    body:
      "Use the inspector and quick prompts to seed Analyze, Decide, or Execute flows—shortcuts into structured thinking without leaving the thread.",
    side: "left",
  },
  {
    id: "nav-reports",
    route: "/reports",
    target: '[data-tour="nav-reports"]',
    title: "Reports — outcomes over time",
    body:
      "KPIs from the API help you see whether execution matched the decision. Use on a weekly or monthly cadence, not only at quarter end.",
    side: "right",
  },
  {
    id: "reports-kpis",
    route: "/reports",
    target: '[data-tour="reports-kpis"]',
    title: "Metrics at a glance",
    body:
      "Charts summarize ledger activity. Compare trends to your 90-day north star from onboarding—feed insights back into Mission Control as the next bet.",
    side: "bottom",
  },
  {
    id: "reports-export",
    route: "/reports",
    target: '[data-tour="reports-export"]',
    title: "Export & refresh",
    body:
      "Refresh pulls the latest API snapshot; export JSON for reviews or sharing with leadership outside the app.",
    side: "bottom",
  },
  {
    id: "nav-teams",
    route: "/teams",
    target: '[data-tour="nav-teams"]',
    title: "Teams — who carries the load",
    body:
      "Teams complements Execute: see owners and utilization across bets before staffing another initiative.",
    side: "right",
  },
  {
    id: "teams-roster",
    route: "/teams",
    target: '[data-tour="teams-roster"]',
    title: "Roster & owners",
    body:
      "Scan who is on the hook across decisions. Overload visible at the person level helps you rebalance before committing more work.",
    side: "top",
  },
  {
    id: "teams-add-member",
    route: "/teams",
    target: '[data-tour="teams-add-member"]',
    title: "Grow the roster",
    body:
      "Add members so ownership and capacity views stay accurate as the org scales.",
    side: "bottom",
  },
  {
    id: "nav-settings",
    route: "/settings",
    target: '[data-tour="nav-settings"]',
    title: "Settings — control plane",
    body:
      "Org rules, capacity, notifications, and integrations live here. Connections unlock real signals; without them, Signals stays thin.",
    side: "right",
  },
  {
    id: "settings-tabs",
    route: "/settings",
    target: '[data-tour="settings-tabs"]',
    title: "Configuration areas",
    body:
      "General, Connections, Rules, Capacity, Notifications, Security, and Billing—tune how aggressively the system surfaces risk and grace windows.",
    side: "bottom",
  },
  {
    id: "settings-connections",
    route: "/settings",
    target: '[data-tour="settings-connections"]',
    title: "Connections",
    body:
      "Connect OAuth apps when you are ready for live ingestion. You complete approval on each provider's site—then signals can flow into the ledger.",
    side: "top",
  },
  {
    id: "settings-save",
    route: "/settings",
    target: '[data-tour="settings-save"]',
    title: "Save changes",
    body:
      "Bulk save persists toggles and org fields. The sidebar workspace label refreshes after a successful save.",
    side: "bottom",
  },
  {
    id: "nav-profile",
    route: "/profile",
    target: '[data-tour="nav-profile"]',
    title: "Profile & account",
    body:
      "Your identity, security, sessions, and preferences. Keep contact fields accurate so Teams and notifications stay trustworthy.",
    side: "right",
  },
  {
    id: "profile-overview",
    route: "/profile",
    target: '[data-tour="profile-overview"]',
    title: "Overview & tour",
    body:
      "Review stats tied to your ledger activity. You can restart this guided tour anytime from Preferences or the AI Assistant.",
    side: "bottom",
  },
  {
    id: "assistant-button",
    route: "/mission-control",
    target: '[data-tour="assistant-button"]',
    title: "AI Assistant",
    body:
      "Open anytime for a short tour replay, the searchable product guide, or to seed Chat with context. You are ready to run the loop: decide → execute → triage signals → review.",
    side: "bottom",
  },
];

export const SPOTLIGHT_TOUR_STEP_COUNT = SPOTLIGHT_TOUR_STEPS.length;
