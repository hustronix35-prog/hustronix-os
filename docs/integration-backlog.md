# External signals ingestion — priority order

Goal: populate `external_signals` from real systems instead of seeds/API-only paths.

## 1. Slack (shipped — Events API)

- **Status:** **Implemented** — `POST /api/integrations/slack/events` (`src/integrations/slackEvents.ts`) verifies `SLACK_SIGNING_SECRET`, dedupes `event_id`, maps `team_id` → Hustronix user via `oauth_connections`, inserts `external_signals` (`source = SLACK`). See `**docs/agents-and-slack-signals.md`**.
- **Optional next steps:** keyword filters, channel allowlists, map Slack user → ledger `owner` display names, Socket Mode for firewalled hosts.

## 2. GitHub (second)

- **Why second:** Strong objective artifacts (PRs, pushes, issues) for verification; slightly heavier webhook + signature verification + repo routing.
- **Work:** Org/repo webhooks → normalize payload → `external_signals` (`source = GITHUB`); tie to owners via configured GitHub login ↔ ledger owner map.

## 3. Jira (third)

- **Why third:** Enterprise variance (cloud/server, custom fields), auth overhead, and lower urgency if Slack + GitHub already catch most execution drift for typical eng teams.
- **Work:** Webhook or polling for issue transitions/comments → `external_signals` (`source = JIRA`).

## Manual / API

Keep `MANUAL` and existing REST link flows as the fallback and for testing all three ingestors.