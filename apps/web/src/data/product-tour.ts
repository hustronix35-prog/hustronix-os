/**
 * Short interactive onboarding steps shown in the AI Assistant drawer.
 * Each step can jump the user to the matching screen.
 */

export type ProductTourStep = {
  id: string;
  title: string;
  body: string;
  href: string;
  ctaLabel: string;
};

export const PRODUCT_TOUR_STEPS: ProductTourStep[] = [
  {
    id: "welcome",
    title: "Welcome to HUSTRONIX",
    body: "This workspace links decisions in the ledger, execution tasks, and real-world signals. Use Next to walk each area, or Open screen to jump there now.",
    href: "/mission-control",
    ctaLabel: "Open Mission Control",
  },
  {
    id: "mission-control",
    title: "Mission Control",
    body: "Your cockpit for the active bet: summary, capacity, signals preview, and the decisions table. Log or activate decisions before heavy execution.",
    href: "/mission-control",
    ctaLabel: "Mission Control",
  },
  {
    id: "execute",
    title: "Execute",
    body: "Run work tied to decisions—states, owners, and outcomes. This is where tasks move from ACTIVE to done (or blocked).",
    href: "/execute",
    ctaLabel: "Execute",
  },
  {
    id: "signals",
    title: "Signals",
    body: "Inbox for Slack and other feeds: verify, link to a task, or kill noise so prioritization stays honest.",
    href: "/signals",
    ctaLabel: "Signals",
  },
  {
    id: "chat",
    title: "Chat",
    body: "Live agent session with tenant context and optional inspector panels—best for depth, tradeoffs, and drafts.",
    href: "/chat",
    ctaLabel: "Chat",
  },
  {
    id: "reports",
    title: "Reports",
    body: "KPIs and trends from the API—use on a cadence to see if execution matched the decision.",
    href: "/reports",
    ctaLabel: "Reports",
  },
  {
    id: "teams",
    title: "Teams",
    body: "Owners and capacity across people—pair with Execute when you need a people-level view.",
    href: "/teams",
    ctaLabel: "Teams",
  },
  {
    id: "settings",
    title: "Settings & Profile",
    body: "Org rules, connections, toggles, and your account. Connections unlock real signals.",
    href: "/settings",
    ctaLabel: "Settings",
  },
  {
    id: "wrap",
    title: "You are ready",
    body: "Scroll below for the full searchable guide, or open Chat with a question. You can restart this tour anytime from this panel.",
    href: "/chat",
    ctaLabel: "Open Chat",
  },
];
