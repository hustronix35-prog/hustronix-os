# Hustronix Nango integrations

Nango owns OAuth + sync. Hustronix owns meaning via `external_signals`.

## Slack pilot — model `Message`

| Sync | Model | Adapter |
|------|--------|---------|
| `messages-received` | `Message` | `apps/api/src/integrations/adapters/slack.ts` |

### Enable

1. In [Nango](https://app.nango.dev): create/use Slack integration unique key `slack`.
2. Either enable the prebuilt **messages-received** sync, or deploy this package:
   ```bash
   cd nango-integrations
   npm install
   npx nango deploy
   ```
3. Connect Slack from Hustronix os-ui Integrations (stores `nango_connections`).
4. Set `NANGO_WEBHOOK_URL` to a public HTTPS tunnel ending at `/api/nango/webhook`.
5. After a sync run, Hustronix ACK-then-async fetches records and writes the ledger.

### Manual pull (no webhook)

```http
POST /api/nango/sync/process
{ "provider": "slack", "model": "Message", "syncName": "messages-received" }
```

### Proof without live Nango

```bash
cd apps/api && npm run test:nango-slack-pilot
```

See `docs/nango-to-signals-architecture.md` § Pilot runbook.
