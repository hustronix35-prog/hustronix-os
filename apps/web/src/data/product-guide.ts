/**
 * In-app product guide: how each area works and why it matters.
 * Keep aligned with sidebar routes and API behavior (see system-guide.ts).
 */

export type GuideChapter = {
  id: string;
  navLabel: string;
  title: string;
  tagline: string;
  intro: string;
  impact: string[];
  workflows: { title: string; steps: string[] }[];
  tryIt: { href: string; label: string }[];
  proTips: string[];
};

export const PRODUCT_GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: "overview",
    navLabel: "Overview",
    title: "How HUSTRONIX fits together",
    tagline: "Decisions → execution → signals, in one loop.",
    intro:
      "HUSTRONIX is built so strategy does not float in slides while work happens elsewhere. You record **decisions** in a ledger, attach **executions** (concrete tasks) to those decisions, and treat **signals** from Slack, meetings, CRM, or other sources as evidence that can confirm, challenge, or retire a bet.",
    impact: [
      "One place to see whether the org is executing on what it decided—not just whether tickets moved.",
      "Signals become accountable inputs: verify, link to work, or kill noise so the ledger stays honest.",
      "Chat ties to the same tenant context so the agent can reason with your org profile, memory, and live data.",
    ],
    workflows: [
      {
        title: "The core loop (repeat every cycle)",
        steps: [
          "Frame or refine a **decision** (vow, outcomes, constraints) in Mission Control.",
          "Break it into **executions** (owners, states) and run them from Execute.",
          "Pull in **signals**; link what matters, kill what does not, and let the ledger update.",
          "Use **Reports** and **Teams** to see load, outcomes, and ownership across bets.",
        ],
      },
    ],
    tryIt: [{ href: "/mission-control", label: "Open Mission Control" }],
    proTips: [
      "Complete **Organization onboarding** first so Mission Control, Chat, and the agent share the same business context.",
      "Use **Settings → Connections** when you need Slack or other integrations—signals depend on what you connect.",
    ],
  },
  {
    id: "mission-control",
    navLabel: "Mission Control",
    title: "Mission Control — your decision cockpit",
    tagline: "See the active bet, load, and next moves in one screen.",
    intro:
      "Mission Control aggregates **summary**, **capacity**, **execution preview**, and **signals preview** from the API. It is where you create or inspect **decisions** (draft vs active) and understand whether the org has headroom for new commitments.",
    impact: [
      "Stops “silent” overload: capacity and active work are visible before you green-light more.",
      "Aligns leadership on the **current** decision vow—not last quarter’s deck.",
      "Shortens time from insight to a logged decision you can execute against.",
    ],
    workflows: [
      {
        title: "Log a new decision",
        steps: [
          "Open **Mission Control**.",
          "Use **New decision** (or the decisions panel) to capture a clear vow and outcomes.",
          "Move drafts to **ACTIVE** when the org is truly committed—executions should hang off active bets.",
        ],
      },
      {
        title: "Scan health before a review",
        steps: [
          "Check **capacity** vs load and the **signals** preview for UNVERIFIED noise.",
          "Open **Execute** if you need to unblock or reprioritize tasks tied to the ledger.",
        ],
      },
    ],
    tryIt: [
      { href: "/mission-control", label: "Mission Control" },
      { href: "/execute", label: "Jump to Execute" },
    ],
    proTips: [
      "Treat **DRAFT** decisions as hypotheses; **ACTIVE** means execution and reporting should reflect that bet.",
      "If summary fails to load, check API health and auth—Mission Control is fully backed by `/api/mission-control/summary`.",
    ],
  },
  {
    id: "execute",
    navLabel: "Execute",
    title: "Execute — run the work tied to decisions",
    tagline: "States, owners, and outcomes on the execution ledger.",
    intro:
      "Execute lists **tasks** linked to decisions: ACTIVE, BLOCKED, PENDING, COMPLETED, and terminal states. You activate work, mark progress, and close the loop so Mission Control and Reports reflect reality.",
    impact: [
      "Makes accountability explicit: every task should trace to a decision (or be triaged).",
      "Surfaces **blocked** work early so decisions are not silently dying in queues.",
      "Feeds productivity and success metrics used in Reports.",
    ],
    workflows: [
      {
        title: "Daily execution hygiene",
        steps: [
          "Filter by **ACTIVE** and your name or team.",
          "Update state when something blocks—add enough context for the next reviewer.",
          "Complete or kill tasks when the decision changes or the work is obsolete.",
        ],
      },
    ],
    tryIt: [{ href: "/execute", label: "Open Execute" }],
    proTips: [
      "Link **signals** to a specific **task id** from Execute when an external event should drive a concrete follow-up.",
    ],
  },
  {
    id: "signals",
    navLabel: "Signals",
    title: "Signals — external reality checking your bets",
    tagline: "Verify, link, or kill. Keep the queue honest.",
    intro:
      "Signals are events from integrations (e.g. Slack) or ingested sources. They land as **UNVERIFIED** until someone confirms relevance. **LINKED** ties a signal to execution work; **KILLED** retires noise so it does not pollute prioritization.",
    impact: [
      "Prevents “everything is urgent” by forcing a triage stance on inbound noise.",
      "Creates an audit trail from external stimulus → decision/task.",
      "Improves agent and dashboard context: linked signals explain *why* work exists.",
    ],
    workflows: [
      {
        title: "Triage new signals",
        steps: [
          "Open **Signals** and scan **UNVERIFIED**.",
          "If relevant: **Link to decision** / execution using the task id from Execute when prompted.",
          "If not: **Kill** so the system and team stop resurfacing it.",
        ],
      },
    ],
    tryIt: [
      { href: "/signals", label: "Open Signals" },
      { href: "/execute", label: "Pick a task id in Execute" },
    ],
    proTips: [
      "Demo placeholders may appear when the API returns zero rows—actions stay disabled until real signals exist in the DB.",
    ],
  },
  {
    id: "chat",
    navLabel: "Chat",
    title: "Chat — live agent with your tenant context",
    tagline: "WebSocket session + sidebar intelligence.",
    intro:
      "Chat opens a **live** session to the API over WebSockets. The UI can show **Context**, **Signals**, and **Decision inspector** panels fed by `/api/chat/sidebar`. The agent can use tools (memory, search, etc.) configured on the server for your user id.",
    impact: [
      "Turns decisions and signals into a dialogue: ask for risks, tradeoffs, or execution plans with full context.",
      "Reduces context-switching versus a generic LLM that does not know your ledger.",
      "Accelerates onboarding of new leaders onto the current vow and constraints.",
    ],
    workflows: [
      {
        title: "Effective chat habits",
        steps: [
          "Collapse panels when you need space; expand **Context** before hard questions.",
          "Reference **active decision** language from Mission Control so the agent stays aligned.",
          "Use quick actions (**Analyze**, **Decide**, **Execute**) to seed structured prompts.",
        ],
      },
    ],
    tryIt: [{ href: "/chat", label: "Open Chat" }],
    proTips: [
      "If the connection shows **Offline**, confirm the API is running and `NEXT_PUBLIC_WS_URL` / unified server env matches your deployment.",
    ],
  },
  {
    id: "reports",
    navLabel: "Reports",
    title: "Reports — KPIs and outcomes",
    tagline: "Quantify how execution and decisions trend.",
    intro:
      "Reports pulls aggregated **metrics** from the API so you can review trends without manually exporting spreadsheets. Use it after a sprint or decision cycle to see whether throughput and quality moved.",
    impact: [
      "Connects operational motion to outcomes leadership cares about.",
      "Supports retros: where did signals or executions cluster?",
      "Builds evidence for the next decision (scale, pause, or pivot).",
    ],
    workflows: [
      {
        title: "Lightweight review cadence",
        steps: [
          "Open **Reports** on a fixed cadence (weekly / monthly).",
          "Compare to the **90-day north star** you captured in onboarding.",
          "Feed insights back into Mission Control as a new or updated decision.",
        ],
      },
    ],
    tryIt: [{ href: "/reports", label: "Open Reports" }],
    proTips: [
      "Pair Reports with **Teams** when you need to see which owners carry the heaviest load.",
    ],
  },
  {
    id: "teams",
    navLabel: "Teams",
    title: "Teams — ownership and capacity across people",
    tagline: "Who is on the hook, and for what.",
    intro:
      "Teams surfaces **owners** tied to ledger work and optional roster-style context. It complements Execute by answering “who” across multiple decisions and tasks—not just a single filtered list.",
    impact: [
      "Makes overload visible at the person level, not only the task level.",
      "Helps rebalance before you commit to another big decision.",
      "Supports managers running portfolio reviews across bets.",
    ],
    workflows: [
      {
        title: "Before staffing a new initiative",
        steps: [
          "Open **Teams** and scan current owners and load.",
          "Decide whether to defer, split, or hire before adding executions.",
        ],
      },
    ],
    tryIt: [{ href: "/teams", label: "Open Teams" }],
    proTips: [
      "Keep **Profile** contact fields accurate so Teams and notifications stay trustworthy.",
    ],
  },
  {
    id: "settings-profile",
    navLabel: "Settings & Profile",
    title: "Settings & Profile — control plane and identity",
    tagline: "Org rules, integrations, keys, and your account.",
    intro:
      "**Settings** stores org, grace windows, confidence rules, capacity, notifications, and UI toggles via `/api/settings` and bulk save. **Profile** covers `/api/me`, password changes, API keys, and session hygiene.",
    impact: [
      "Settings change how aggressively the system surfaces risk (grace, confidence thresholds).",
      "Connections unlock real **signals**—without them, Signals stays thin.",
      "Profile + API keys enable automation and integrations without sharing passwords.",
    ],
    workflows: [
      {
        title: "Ship a safe configuration",
        steps: [
          "Set **org.name** and related fields so the workspace label and agent context stay correct.",
          "Connect Slack (or other) under **Connections** when you are ready for live signals.",
          "Click **Save Changes**; the sidebar refreshes org name on success.",
        ],
      },
      {
        title: "Lock down access",
        steps: [
          "In **Profile**, rotate API keys and revoke stale **sessions** periodically.",
        ],
      },
    ],
    tryIt: [
      { href: "/settings", label: "Settings" },
      { href: "/profile", label: "Profile" },
    ],
    proTips: [
      "After bulk saves, other tabs may need a refresh to pick up new limits or toggles.",
    ],
  },
  {
    id: "wrap-up",
    navLabel: "Putting it together",
    title: "Putting it together — your first week",
    tagline: "A practical sequence so nothing sits idle.",
    intro:
      "Use this sequence once onboarding is done: (1) confirm **Settings** and **Connections**, (2) log or activate a **decision**, (3) create **executions**, (4) triage **signals**, (5) run **Chat** for depth, (6) review **Reports** and **Teams** on a cadence.",
    impact: [
      "You get a working closed loop in days instead of wiring ad-hoc docs and chats.",
      "The system learns from structured fields—not only free text—so recommendations stay grounded.",
    ],
    workflows: [
      {
        title: "Suggested first week",
        steps: [
          "Day 1–2: Mission Control + Execute — one active decision with 3–7 executions.",
          "Day 3: Signals triage daily for 15 minutes.",
          "Day 4–5: Chat deep dives on risks and dependencies.",
          "Day 5: Reports snapshot; adjust capacity or owners in Teams.",
        ],
      },
    ],
    tryIt: [{ href: "/mission-control", label: "Start at Mission Control" }],
    proTips: [
      "Walk new operators through the **AI Assistant** tour and guide once—they inherit the same mental model as the app shell.",
    ],
  },
];

export function filterProductGuideChapters(
  chapters: GuideChapter[],
  query: string,
): GuideChapter[] {
  const s = query.trim().toLowerCase();
  if (!s) return chapters;
  return chapters.filter((ch) => {
    const blob = [
      ch.title,
      ch.navLabel,
      ch.tagline,
      ch.intro,
      ...ch.impact,
      ...ch.workflows.flatMap((w) => [w.title, ...w.steps]),
      ...ch.tryIt.map((t) => t.label),
      ...ch.proTips,
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(s);
  });
}

/** Condensed markdown for Chat seed (size-capped). */
export function buildProductGuideContextForAgent(maxChars = 16000): string {
  const header =
    "[HUSTRONIX product guide — align answers with these behaviors and routes]\n\n";
  let acc = header;
  for (const ch of PRODUCT_GUIDE_CHAPTERS) {
    const impacts = ch.impact.map((i) => `- ${i}`).join("\n");
    const wfs = ch.workflows
      .map(
        (w) =>
          `**${w.title}**\n${w.steps.map((step) => `- ${step}`).join("\n")}`,
      )
      .join("\n\n");
    const block = `## ${ch.title}\n_${ch.tagline}_\n\n${ch.intro}\n\n**Impact:**\n${impacts}\n\n**Workflows:**\n${wfs}\n`;
    if (acc.length + block.length + 80 > maxChars) {
      acc += "\n[Additional chapters omitted for context size.]\n";
      break;
    }
    acc += `${block}\n---\n\n`;
  }
  return acc.trimEnd();
}
