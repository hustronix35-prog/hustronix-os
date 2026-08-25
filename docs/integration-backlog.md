# External signals ingestion — priority order

Goal: populate `external_signals` from real systems instead of seeds/API-only paths.

**Canonical architecture:** [`docs/nango-to-signals-architecture.md`](./nango-to-signals-architecture.md) — Nango owns connectivity/sync; Hustronix owns meaning via `ingestExternal()` → `external_signals`. First-party OAuth/poll/webhook workers below are **transitional** until each provider’s Nango path is proven.

**Order:** prove the **meaning vertical slice** (Slack + GitHub + Jira/Linear + Meetings → claims → org-state → Decide/Brain) before broadening Zoom/CRM/Support. New connectors must be **claim-ready** (structured `ingest_meta`), not claim-producing.

## 1. Slack (Events API live; Nango Message pilot proven in-repo)

- **First-party Events API:** **Implemented** — `POST /api/integrations/slack/events` → `external_signals` (`source = SLACK`). See [`agents-and-slack-signals.md`](./agents-and-slack-signals.md).
- **Nango path (target):** sync model `Message` (`messages-received`) → `ingestNangoRecords` → same ledger. Sync script: `nango-integrations/`. Proof: `npm run test:nango-slack-pilot` from `apps/api`.
- **Optional next steps:** keyword filters, channel allowlists; retire Events API after live Nango sync is trusted.

## 2. GitHub (second)

- **Why second:** Strong objective artifacts (PRs, pushes, issues) for verification; slightly heavier webhook + signature verification + repo routing.
- **Work:** Org/repo webhooks → normalize payload → `external_signals` (`source = GITHUB`); tie to owners via configured GitHub login ↔ ledger owner map.

## 3. Jira (third)

- **Why third:** Enterprise variance (cloud/server, custom fields), auth overhead, and lower urgency if Slack + GitHub already catch most execution drift for typical eng teams.
- **Work:** Webhook or polling for issue transitions/comments → `external_signals` (`source = JIRA`).

## Manual / API

Keep `MANUAL` and existing REST link flows as the fallback and for testing all three ingestors.