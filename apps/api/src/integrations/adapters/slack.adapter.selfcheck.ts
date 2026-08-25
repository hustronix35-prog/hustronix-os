/**
 * ponytail: assert-based self-check for Slack adapter + envelope → IngestRecord.
 * Run: npx tsx apps/api/src/integrations/adapters/slack.adapter.selfcheck.ts
 * Ceiling: no DB; only pure transform correctness.
 */

import assert from "node:assert/strict";
import { adaptNangoRecord } from "./index.js";
import { envelopeToIngestRecord } from "../ingest/fromEnvelope.js";

const envelope = adaptNangoRecord(
  {
    id: "Cops-1712345678.000100",
    channel_id: "Cops",
    channel_name: "ops",
    user_id: "U01",
    user_name: "alex",
    text: "We're slipping the launch to Sept 24",
    timestamp: "1712345678.000100",
    created_at: "2024-04-05T12:34:38.000Z",
    _nango_metadata: { cursor: "cur1", last_action: "added" },
  },
  {
    tenantId: "user-1",
    connectionId: "conn-pk",
    nangoConnectionId: "nango-remote",
    provider: "slack",
    integrationId: "slack",
    model: "Message",
    syncName: "messages-received",
    receivedAt: "2026-08-10T10:00:00.000Z",
  },
);

assert.ok(envelope);
assert.equal(envelope!.provider, "slack");
assert.match(envelope!.displayText, /Sept 24/);
assert.match(envelope!.displayText, /#ops/);
assert.equal(envelope!.actor?.id, "U01");
assert.equal(envelope!.externalId, "nango:Message:Cops-1712345678.000100");

const rec = envelopeToIngestRecord(envelope!);
assert.equal(rec.userId, "user-1");
assert.equal(rec.provider, "slack");
assert.equal(rec.meta?.integration_runtime, "nango");
assert.equal(rec.meta?.nango_connection_id, "nango-remote");
assert.ok(typeof rec.content === "string" && rec.content.includes("Sept 24"));

const deleted = adaptNangoRecord(
  {
    id: "gone",
    text: "x",
    _nango_metadata: { deleted_at: "2026-01-01T00:00:00.000Z" },
  },
  {
    tenantId: "user-1",
    connectionId: "conn-pk",
    nangoConnectionId: "nango-remote",
    provider: "slack",
    integrationId: "slack",
    model: "Message",
    receivedAt: "2026-08-10T10:00:00.000Z",
  },
);
assert.equal(deleted, null);

console.log("slack.adapter.selfcheck: ok");
