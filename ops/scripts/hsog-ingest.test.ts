/**
 * HSOG → ingestExternal → external_signals (+ entities / roster / draft decision).
 * Run: npx tsx --test ops/scripts/hsog-ingest.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { runHsogIngest } from "../../apps/api/src/integrations/hsog/index.js";
import { artifactToIngestRecord, routeArtifactType } from "../../apps/api/src/integrations/hsog/artifactMap.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import type { HsogIngestBundle } from "../../apps/api/src/integrations/hsog/types.js";

function miniBundle(tag: string): HsogIngestBundle {
  return {
    version: 1,
    benchmark: "hustronix-enterprise",
    seed: "hsog-test",
    start_date: "2026-02-02",
    company: { id: `co_${tag}`, name: "Hustronix Systems", short_name: "Hustronix" },
    products: [{ id: "nexusai", name: "NexusAI" }],
    projects: [{ id: "PRJ-NEXUSAI-20", name: "NexusAI 2.0 Launch" }],
    departments: [{ id: "product", name: "Product" }],
    customers: [{ id: "acme_industrials", name: "Acme Industrials", health_score: 58 }],
    people: [
      {
        id: `imani_${tag}`,
        name: "Imani Brooks",
        first_name: "Imani",
        role: "Senior Product Manager",
        department: "product",
        seniority: "senior",
        email: `imani.${tag}@hustronix.io`,
      },
    ],
    scenarios: [{ id: "product_launch_slip", title: "NexusAI 2.0 launch slip" }],
    events: [
      {
        event_id: `hustronix_product_launch_slip_d20_${tag}`,
        day: 20,
        scenario_id: "product_launch_slip",
        event_type: "requirement_created",
        actors: ["Imani"],
        entity_ids: ["PRJ-NEXUSAI-20", "nexusai"],
        visibility_scope: "team:product",
        ground_truth_fact_ids: ["fact_nexus_eval_gap"],
        summary: "Product publishes NexusAI 2.0 PRD covering decision trails.",
        artifacts: [
          {
            artifact_id: `slack_${tag}`,
            artifact_type: "slack_message",
            evidence_quality: "supporting",
            related_entity_ids: ["PRJ-NEXUSAI-20"],
            ground_truth_fact_ids: ["fact_nexus_eval_gap"],
          },
          {
            artifact_id: `jira_${tag}`,
            artifact_type: "jira_issue",
            evidence_quality: "supporting",
            related_entity_ids: ["PRJ-NEXUSAI-20"],
          },
        ],
      },
    ],
  };
}

describe("hsog artifact map", () => {
  it("routes slack/jira to real source buckets", () => {
    assert.equal(routeArtifactType("slack_message").source, "SLACK");
    assert.equal(routeArtifactType("jira_issue").source, "JIRA");
    assert.equal(routeArtifactType("github_pr").source, "GITHUB");
    assert.equal(routeArtifactType("confluence_page").source, "MANUAL");
    assert.equal(routeArtifactType("confluence_page").subtype, "confluence.page");
    assert.equal(routeArtifactType("crm_record").source, "CRM");
    assert.equal(routeArtifactType("meeting_transcript").source, "MEETING");
    assert.equal(routeArtifactType("hris_record").source, "HRIS");
    const rec = artifactToIngestRecord({
      tenantId: "u1",
      startDate: "2026-02-02",
      event: {
        event_id: "e1",
        day: 20,
        scenario_id: "product_launch_slip",
        event_type: "requirement_created",
        actors: ["Imani"],
        entity_ids: ["nexusai"],
        summary: "PRD published",
        artifacts: [],
      },
      artifact: { artifact_id: "a1", artifact_type: "slack_message" },
    });
    assert.equal(rec.provider, "slack");
    assert.equal(rec.externalId, "hsog:a1");
    assert.equal(rec.meta?.integration_runtime, "hsog");
  });
});

describe("hsog ingest → ledger", () => {
  it("writes signals, entities, roster, draft decision; second pass is idempotent", async () => {
    const tag = randomUUID().slice(0, 8);
    const userId = `hsog_${tag}`.slice(0, 32);
    db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
    const orgId = resolveTenantContext(userId).orgId;
    const bundle = miniBundle(tag);

    const first = await runHsogIngest(bundle, `(inline:${tag})`, {
      userId,
      activateScenarioId: null,
      enrich: true,
      decisions: true,
    });
    assert.equal(first.signals.inserted, 2);
    assert.equal(first.signals.errors, 0);
    assert.ok(first.entities.upserted >= 5);
    assert.equal(first.roster.upserted, 1);
    assert.equal(first.decisions.created, 1);
    assert.equal(first.decisions.activated, null);

    const slack = db.rawGet(
      `SELECT id, ingest_meta FROM external_signals WHERE user_id = ? AND source = 'SLACK'`,
      [userId],
    ) as { id: string; ingest_meta: string }[];
    assert.equal(slack.length, 1);
    const meta = JSON.parse(slack[0].ingest_meta || "{}") as { integration_runtime?: string };
    assert.equal(meta.integration_runtime, "hsog");

    const jira = db.rawGet(
      `SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND source = 'JIRA'`,
      [userId],
    ) as { c: number }[];
    assert.equal(Number(jira[0].c), 1);

    const customer = db.rawGet(
      `SELECT id FROM entities WHERE tenant_id = ? AND type = 'customer' AND ref_id = 'acme_industrials'`,
      [orgId],
    ) as { id: string }[];
    assert.equal(customer.length, 1);

    const roster = db.rawGet(
      `SELECT name FROM team_roster WHERE user_id = ? AND email = ?`,
      [userId, `imani.${tag}@hustronix.io`],
    ) as { name: string }[];
    assert.equal(roster[0]?.name, "Imani Brooks");

    const vows = db.rawGet(
      `SELECT id, status FROM decision_ledger WHERE user_id = ?`,
      [userId],
    ) as { id: string; status: string }[];
    assert.equal(vows.length, 1);
    assert.equal(vows[0].status, "DRAFT");

    const second = await runHsogIngest(bundle, `(inline:${tag})`, {
      userId,
      activateScenarioId: null,
      enrich: false,
      decisions: true,
    });
    assert.equal(second.signals.inserted, 0);
    assert.equal(second.signals.duplicates, 2);
  });

  it("grace uses received_at so backdated HSOG is not killed", async () => {
    const tag = randomUUID().slice(0, 8);
    const userId = `hsog_g_${tag}`.slice(0, 32);
    db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
    resolveTenantContext(userId);
    await runHsogIngest(miniBundle(tag), `(inline:${tag})`, {
      userId,
      activateScenarioId: null,
      enrich: false,
      decisions: false,
    });
    const row = (
      db.rawGet(
        `SELECT detected_at, received_at, state FROM external_signals WHERE user_id = ? AND source = 'SLACK'`,
        [userId],
      ) as { detected_at: string; received_at: string; state: string }[]
    )[0];
    assert.ok(row);
    assert.match(String(row.detected_at), /^2026-02/);
    assert.ok(row.received_at && !String(row.received_at).startsWith("2026-02"));
    const ids = db.rawGet(`SELECT id FROM external_signals WHERE user_id = ?`, [userId]) as { id: string }[];
    for (const r of ids) auditor.onWrite({ type: "signal", signalId: r.id });
    const after = (
      db.rawGet(`SELECT state FROM external_signals WHERE user_id = ? AND source = 'SLACK'`, [userId]) as {
        state: string;
      }[]
    )[0];
    assert.notEqual(after.state, "KILLED");
  });

  it("holds high-risk past grace instead of killing", () => {
    const tag = randomUUID().slice(0, 8);
    const userId = `hsog_r_${tag}`.slice(0, 32);
    db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
    resolveTenantContext(userId);
    const out = ingestExternal({
      provider: "slack",
      subtype: "slack.message",
      userId,
      content: "SEV1 export anomaly",
      owner: "Omar",
      externalId: `hsog-risk-${tag}`,
      detectedAt: "2026-02-02T14:00:00.000Z",
    });
    db.rawRun(
      `UPDATE external_signals
       SET received_at = datetime('now', '-2 days'), grace_expires_at = NULL, risk = 'high', op_classification = 'incident'
       WHERE id = ?`,
      [out.signalId],
    );
    auditor.onWrite({ type: "signal", signalId: out.signalId });
    const st = (
      db.rawGet(`SELECT state FROM external_signals WHERE id = ?`, [out.signalId]) as { state: string }[]
    )[0];
    assert.equal(st.state, "GRACE");
  });

  it("start-sprint activates pending tasks under the ACTIVE vow", async () => {
    const tag = randomUUID().slice(0, 8);
    const userId = `hsog_s_${tag}`.slice(0, 32);
    db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
    resolveTenantContext(userId);
    const result = await runHsogIngest(miniBundle(tag), `(inline:${tag})`, {
      userId,
      activateScenarioId: "product_launch_slip",
      startSprint: true,
      enrich: false,
      decisions: true,
    });
    assert.ok(result.decisions.activated);
    assert.ok(result.sprint.activated >= 1);
    const active = db.rawGet(
      `SELECT COUNT(*) AS c FROM execution_ledger e
       INNER JOIN decision_ledger d ON d.id = e.decision_id
       WHERE d.user_id = ? AND e.status = 'ACTIVE'`,
      [userId],
    ) as { c: number }[];
    assert.ok(Number(active[0].c) >= 1);
  });
});
