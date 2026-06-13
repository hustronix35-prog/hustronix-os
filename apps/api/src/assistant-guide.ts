import { v4 as uuidv4 } from "uuid";

/** Session id prefix — keeps drawer assistant history out of main Chat sessions. */
export const ASSISTANT_SESSION_PREFIX = "asst:";

export function isAssistantSession(sessionId: string): boolean {
  return sessionId.startsWith(ASSISTANT_SESSION_PREFIX);
}

export function newAssistantSessionId(): string {
  return `${ASSISTANT_SESSION_PREFIX}${uuidv4()}`;
}

const ASSISTANT_ROLE = `You are the HUSTRONIX in-app AI Assistant (header drawer), separate from the main Chat tab.

Your job:
- Help users learn the product: routes, workflows, and how Mission Control, Execute, Signals, Chat, Reports, Teams, Settings, and Profile fit together.
- Answer "how do I…" questions with concrete navigation (e.g. "Open Execute → filter ACTIVE").
- Stay concise: short paragraphs and bullets; no long essays unless asked.

Boundaries:
- You do NOT commit decisions, transition execution, or mutate the ledger. For operational work (logging decisions, killing signals, deep coordinator reasoning), direct users to **Chat** (\`/chat\`) or the relevant screen.
- Do not invent API endpoints or features not described in the product guide below.
- If unsure, say what screen to check and what to look for.`;

/** Condensed product guide for assistant context (size-capped). */
export function buildAssistantGuideContext(maxChars = 14000): string {
  const chapters: { title: string; tagline: string; intro: string; routes: string[] }[] = [
    {
      title: "How HUSTRONIX fits together",
      tagline: "Decisions → execution → signals.",
      intro:
        "Record decisions in the ledger, attach executions, triage signals from integrations. Chat is the full operational coordinator; this assistant is for product help.",
      routes: ["/mission-control", "/execute", "/signals", "/chat"],
    },
    {
      title: "Mission Control",
      tagline: "Decision cockpit.",
      intro: "Summary, capacity, execution preview, signals preview. Create and activate decisions.",
      routes: ["/mission-control"],
    },
    {
      title: "Execute",
      tagline: "Execution ledger.",
      intro: "Tasks linked to decisions: ACTIVE, BLOCKED, PENDING, etc. Update states and owners.",
      routes: ["/execute"],
    },
    {
      title: "Signals",
      tagline: "Verify, link, or kill.",
      intro: "UNVERIFIED until triaged; LINKED to execution; KILLED for noise.",
      routes: ["/signals"],
    },
    {
      title: "Chat (main coordinator)",
      tagline: "Full agent with ledger tools.",
      intro:
        "WebSocket chat with sidebar context from /api/chat/sidebar. Use for deep operational questions—not the same session as this drawer assistant.",
      routes: ["/chat"],
    },
    {
      title: "Reports & Teams",
      tagline: "Metrics and ownership.",
      intro: "Reports: KPI trends. Teams: who owns what across bets.",
      routes: ["/reports", "/teams"],
    },
    {
      title: "Settings & Profile",
      tagline: "Org rules and account.",
      intro: "Settings: org, notifications, connections. Profile: /api/me, API keys, sessions.",
      routes: ["/settings", "/profile"],
    },
  ];

  let acc = "[HUSTRONIX product guide]\n\n";
  for (const ch of chapters) {
    const block = `## ${ch.title}\n_${ch.tagline}_\n${ch.intro}\nRoutes: ${ch.routes.join(", ")}\n\n`;
    if (acc.length + block.length + 60 > maxChars) {
      acc += "[Additional chapters omitted for size.]\n";
      break;
    }
    acc += block;
  }
  return acc.trimEnd();
}

export function buildAssistantSystemPrompt(): string {
  return `${ASSISTANT_ROLE}\n\n${buildAssistantGuideContext()}`;
}
