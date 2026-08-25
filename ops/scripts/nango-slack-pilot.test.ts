/**
 * Prove Nango Slack Message model → adapter → ingestExternal → external_signals.
 *
 * Run: npm run test:nango-slack-pilot (from apps/api)
 *
 * Uses real SQLite + ingestNangoRecords (no live Nango Cloud). Fixture shape matches
 * Nango prebuilt / nango-integrations Slack `Message` model.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { ingestNangoRecords } from "../../apps/api/src/integrations/nango/dispatcher.js";
import {
  ensureNangoTables,
  upsertNangoConnection,
  getNangoConnection,
} from "../../apps/api/src/integrations/nango/nangoStore.js";
import type { NangoSyncRecord } from "../../apps/api/src/integrations/adapters/types.js";

const RUN = randomUUID().slice(0, 8);
const USER_ID = `nango_slack_${RUN}`;
const REMOTE_CONN = `nango-remote-${RUN}`;
const MODEL = "Message";

function ensureUser(): void {
  if (db.getUserById(USER_ID)) return;
  try {
    db.createUser(USER_ID, USER_ID, hashPassword(`pw-${USER_ID}`), `${USER_ID}@test.local`);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
  }
  assert.ok(db.getUserById(USER_ID), "pilot user must exist");
}

describe("nango slack pilot → external_signals", () => {
  before(() => {
    ensureNangoTables();
    ensureUser();
    upsertNangoConnection({
      userId: USER_ID,
      provider: "slack",
      integrationId: "slack",
      connectionId: REMOTE_CONN,
      connectionName: "Slack Pilot",
    });
  });

  it("ingests Message records with integration_runtime=nango", () => {
    const conn = getNangoConnection(USER_ID, "slack");
    assert.ok(conn);

    const msgId = `C0PILOT-${RUN}.1234567890.000100`;
    const records: NangoSyncRecord[] = [
      {
        id: msgId,
        channel_id: "C0PILOT",
        channel_name: "ops",
        user_id: "U0ALEX",
        user_name: "alex",
        text: "We're moving the launch from Sept 10 to Sept 24 because Stripe migration isn't ready",
        timestamp: "1234567890.000100",
        created_at: "2026-08-10T12:00:00.000Z",
        is_thread_reply: false,
        _nango_metadata: {
          cursor: `cursor-${RUN}-1`,
          last_action: "added",
        },
      },
      {
        id: `C0PILOT-${RUN}.lol`,
        channel_id: "C0PILOT",
        channel_name: "ops",
        user_id: "U0BOB",
        text: "lol nice",
        timestamp: "1234567891.000100",
        created_at: "2026-08-10T12:01:00.000Z",
        _nango_metadata: {
          cursor: `cursor-${RUN}-2`,
          last_action: "added",
        },
      },
      {
        id: `C0PILOT-${RUN}.deleted`,
        text: "should skip",
        _nango_metadata: {
          deleted_at: "2026-08-10T12:02:00.000Z",
        },
      },
    ];

    const result = ingestNangoRecords({
      conn,
      integrationId: "slack",
      model: MODEL,
      syncName: "messages-received",
      records,
    });

    assert.equal(result.fetched, 3);
    assert.equal(result.ingested, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.nextCursor, `cursor-${RUN}-2`);

    const rows = db.rawGet(
      `SELECT id, source, content, owner, external_id, ingest_meta, state
       FROM external_signals
       WHERE user_id = ? AND external_id LIKE ?
       ORDER BY detected_at ASC`,
      [USER_ID, `nango:${MODEL}:%`],
    ) as {
      id: string;
      source: string;
      content: string;
      owner: string;
      external_id: string;
      ingest_meta: string | null;
      state: string;
    }[];

    assert.equal(rows.length, 2);
    assert.equal(rows[0].source, "SLACK");
    assert.match(rows[0].content, /Sept 24/);
    assert.match(rows[0].content, /#ops/);
    assert.equal(rows[0].state, "UNVERIFIED");
    assert.equal(rows[0].external_id, `nango:${MODEL}:${msgId}`);

    const meta = JSON.parse(rows[0].ingest_meta || "{}") as Record<string, unknown>;
    assert.equal(meta.integration_runtime, "nango");
    assert.equal(meta.nango_connection_id, REMOTE_CONN);
    assert.equal(meta.model, MODEL);
    assert.ok(meta.evidence && typeof meta.evidence === "object");

    // Idempotent re-ingest
    const again = ingestNangoRecords({
      conn,
      integrationId: "slack",
      model: MODEL,
      syncName: "messages-received",
      records: [records[0]!],
    });
    assert.equal(again.duplicates, 1);
    assert.equal(again.ingested, 0);

    const countAfter = (
      db.rawGet(
        `SELECT COUNT(*) AS c FROM external_signals
         WHERE user_id = ? AND external_id = ?`,
        [USER_ID, `nango:${MODEL}:${msgId}`],
      ) as { c: number }[]
    )[0]?.c;
    assert.equal(countAfter, 1);
  });

  it("leaves evidence intact when Nango connection mapping is removed (replaceable)", () => {
    const before = (
      db.rawGet(
        `SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND source = 'SLACK'`,
        [USER_ID],
      ) as { c: number }[]
    )[0]?.c;
    assert.ok((before ?? 0) >= 2);

    db.rawRun(`DELETE FROM nango_connections WHERE user_id = ? AND provider = 'slack'`, [
      USER_ID,
    ]);

    const after = (
      db.rawGet(
        `SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND source = 'SLACK'`,
        [USER_ID],
      ) as { c: number }[]
    )[0]?.c;
    assert.equal(after, before);
  });
});
