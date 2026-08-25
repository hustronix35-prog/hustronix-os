# Agents and Slack → signals

This document describes the **LLM agents** in the Hustronix OS backend and the **Slack → `external_signals`** ingestion path.

---

## Part 1 — Agents (chat / coordinator)

All of this lives under `**src/agent.ts**`, wired from `**src/bootstrap.ts**` (WebSocket handler → `runAgent`).

### Coordinator (main agent)

- **Entry point:** `runAgent(userId, userInput, …)`.
- **Role:** The “Hustronix OS” chat agent; logs show **Coordinator**.
- **System layer:** `buildSupervisorPrompt()` — **HUX-OPERATOR / Sovereign Operator** (ledger rules, capacity, shadow work, etc.) plus core memory:
  - `system_prompt` in SQLite core memory, or `config.agent.systemPrompt`.
- **Context:** Recent messages, optional **world model** JSON from core memory.
- **Tools** (`buildCoordinatorTools`):
  - `ping` — diagnostic.
  - `delegate_to_marketing` — sub-agent (below).
  - `delegate_to_research` — sub-agent (below).
  - `log_strategic_decision` — write vow + execution chain to the **decision ledger** (DRAFT).
  - `transition_execution` — move tasks in **execution_ledger**.
  - Memory tools: remember / recall / current time (from `src/tools/`).

### Sub-agents (delegates)

Implemented via `**runSubAgent()`** — separate short LLM runs with their own tool lists:


| Delegate      | Tool entry              | Tools (today)                                             | Prompt / notes                                    |
| ------------- | ----------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| **Marketing** | `delegate_to_marketing` | `marketingTools` = web search only (`src/tools/index.ts`) | `src/agents/marketingPrompt.js` + PRD constraints |
| **Research**  | `delegate_to_research`  | `researchTools` = web search only                         | “Find signals, ignore noise.”                     |


There are **no Telegram or Slack tools** in these bundles (by design in `tools/index.ts`).

### Auditor (not chat)

- `**src/auditor.ts`** — cron in `**src/bootstrap.ts**` (every **5 minutes**).
- Evaluates shadow work (including `**external_signals`** grace windows), tasks, decisions.
- **Not** the same as the chat coordinator; it enforces rules against the DB.

### Optional MCP

- `**apps/api/src/mcp.ts`** — loads `**mcp_config.json**` and attaches **stdio MCP servers** as external tools. Optional; unrelated to Slack ingestion unless you configure it.

---

## Part 2 — Slack conversations → signals

### Does an “agent” turn Slack into signals?

**No LLM agent** is required. Ingestion is an **HTTP Events API** handler that inserts rows into `**external_signals`** with `source = 'SLACK'`.

### Flow (high level)

1. **Install the Slack app** — User signs in to Hustronix and connects Slack (**Settings → Connections**). OAuth is implemented in `**apps/api/src/server.ts`** (`/api/oauth/slack/start`, `/api/oauth/slack/callback`). The **bot token** is stored in `**oauth_connections`** (`provider = 'slack'`, `external_team_id` = Slack team id).
2. **Configure Slack Event Subscriptions** — In [api.slack.com](https://api.slack.com/apps) → *Event Subscriptions*:
  - **Request URL:** `https://<your-public-api-host>:<PORT>/api/integrations/slack/events`  
    - Default API `**PORT`** is **3005** (see root `.env`). Slack must reach this URL (use **ngrok** or similar for local dev).
  - Subscribe to **bot events** such as:
    - `message.channels` — public channels the bot is in  
    - `message.groups` — private channels (needs `**groups:history`** in bot scopes)  
    - `message.im` — DMs (needs `**im:history**`)
3. **Slack sends HTTP POSTs** — JSON payloads. Types:
  - `**url_verification`** — Slack sends a `challenge`; the handler returns `{ "challenge": "<value>" }` so Slack validates the URL.
  - `**event_callback**` — Contains `event_id`, `team_id`, and an `**event**` object.
4. **Verification** — Requests must include `**X-Slack-Signature`** and `**X-Slack-Request-Timestamp**`. The server verifies HMAC using `**SLACK_SIGNING_SECRET**` (Slack app → *Basic Information* → *Signing Secret*). The route uses `**express.raw({ type: "application/json" })*`* so the body bytes match Slack’s signature (**must be registered before `express.json()`** — see `apps/api/src/server.ts`).
5. **Dedup** — Each `event_id` is stored in `**slack_event_receipts`** so Slack retries do not create duplicate signals.
6. **Tenant mapping** — `team_id` from the payload is resolved with `**oauth_connections`** (`getSlackTenantForTeam`). The **Hustronix `user_id`** who installed the app owns new signals (`external_signals.user_id`).
7. **Which messages become signals?** — `**apps/api/src/integrations/slackEvents.ts`** ingests `**message**` events that pass filters (e.g. skips `**bot_id**` messages, common non-message subtypes like `message_deleted`, etc.). Thread replies are labeled in the **content** text.
8. **Insert** — `**insertExternalSignal`** writes `**UNVERIFIED**` rows. The **auditor** sets `**grace_expires_at`** for Slack (`+2 hours` in `**apps/api/src/auditor.ts**`) and may **KILL** unlinked signals after grace.
9. **UI** — Signals appear under **Signals**, Mission Control previews, etc., scoped by `**user_id`** like other API data.

### Environment variables (API server)


| Variable                                                       | Purpose                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SLACK_SIGNING_SECRET`                                         | **Required** for `/api/integrations/slack/events` (HMAC verification).                                                            |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | OAuth install (existing).                                                                                                         |
| `SLACK_BOT_SCOPES`                                             | Bot token scopes; include at least `**channels:history`**; add `**groups:history**`, `**im:history**` if you need those surfaces. |
| `PORT`                                                         | API port (default **3005**); Slack Request URL must match.                                                                        |


### Files to know


| File                              | Role                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/src/integrations/slackEvents.ts` | Events API handler → `external_signals`                                                      |
| `apps/api/src/server.ts`                   | Route `POST /api/integrations/slack/events`, OAuth routes                                    |
| `apps/api/src/database.ts`                 | `oauth_connections`, `slack_event_receipts`, `insertExternalSignal`, `getSlackTenantForTeam` |
| `apps/api/src/auditor.ts`                  | Grace windows for `SLACK` signals                                                            |


### Operational notes

- **Public URL:** Slack cannot call `localhost`; use a tunnel to your API port or deploy the API with a public hostname.
- **Same workspace, multiple Hustronix users:** If more than one row exists for the same Slack `team_id`, the **most recently updated** install wins (`ORDER BY updated_at DESC LIMIT 1`).
- **Browser extensions** sometimes inject DOM attributes and cause React hydration warnings on the UI; those are unrelated to this pipeline.

---

## Related docs

- `**docs/nango-to-signals-architecture.md**` — **Canonical** Nango → `external_signals` → intelligence contract. This Slack Events path is **transitional** until the Nango Slack pilot is proven.
- `**docs/database-consistency-and-context.md**` — How SQLite stays the source of truth and why the LLM context window is not the memory.
- `**docs/architecture-enforcement.md`** — Agent vs auditor, conflict gate, signal linking APIs, event-driven auditor + cron, backpressure env vars.
- `**docs/integration-backlog.md**` — Broader ingestion roadmap (GitHub, Jira, etc.).
- `**.cursor/rules/hustronix-stack.mdc**` — Stack and API overview.