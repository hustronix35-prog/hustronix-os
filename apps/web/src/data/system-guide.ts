/** In-product reference for the AI Assistant panel (kept in sync with nav + server routes). */

export type GuideSection = { id: string; title: string; body: string };

export const SYSTEM_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "overview",
    title: "What Hustronix is",
    body: `Hustronix is a decision + execution OS: decisions live in the ledger (DRAFT → ACTIVE), executions are weighted tasks on that ledger, and signals are external events (Slack, GitHub, etc.) you verify or kill. The agent on Chat uses WebSocket to the API server and runs tools against your tenant.`,
  },
  {
    id: "nav",
    title: "Sidebar pages",
    body: `**Mission Control** — summary, capacity, quick actions, decisions table (commit DRAFT → ACTIVE).

**Execute** — filter tasks ACTIVE / BLOCKED / PENDING / COMPLETED; inspector activates, completes, or kills tasks.

**Signals** — UNVERIFIED / LINKED / KILLED; link ties a signal to an execution task_id; kill marks noise.

**Chat** — live agent session (WebSocket to the API; in split dev the API may use a different port).

**Reports** — KPIs from \`/api/metrics/reports\`.

**Teams** — owners from ledger + optional local roster rows.

**Settings** — toggles + org / grace / capacity stored in SQLite (**Save Changes**).

**Profile** — \`/api/me\`, password, API keys, sessions.

**AI Assistant** (header on any dashboard page) — interactive tour + searchable product guide + link to full \`/guide\` layout with TOC.`,
  },
  {
    id: "signals-actions",
    title: "Signals buttons",
    body: `Link to Decision — POST /api/execution/link with signalId + task_id from Execute ledger (pick from list).\nCreate New Decision — POST /api/decisions with a vow (DRAFT).\nKill / Ignore — POST /api/execution/signals/kill (only for real DB rows, not UI mocks).\nIf the list shows demo placeholders because the API returned zero rows, actions stay disabled until real signals exist.`,
  },
  {
    id: "settings",
    title: "Settings persistence",
    body: `Save Changes writes bulk keys (org.*, grace.*, rules.min_confidence_pct, capacity.*, notify.quiet_*, ui.* toggles) via POST /api/settings/bulk. After save, the sidebar reloads org.name so the workspace label updates.`,
  },
  {
    id: "chat-ws",
    title: "Chat / WebSocket",
    body: `Browser connects with credentials; server resolves user from hustronix_session cookie first.\nSplit setup: Next on :3000 and API on :3005 — set NEXT_PUBLIC_UNIFIED_SERVER=1 when using one port, or rely on default WS host :3005 on localhost.\nOverride anytime with NEXT_PUBLIC_WS_URL.`,
  },
  {
    id: "auth",
    title: "Auth",
    body: `Login sets httpOnly cookie + localStorage user id for headers. REST calls use credentials: include. Prefer unified origin so cookie + WS match.`,
  },
];
