/**
 * Meaning vertical slice — Slack + Jira + GitHub + Meeting → one feature entity.
 * Run: npm run test:reconciliation (includes this file) or
 *      npx tsx --test ../../ops/scripts/meaning-vertical-slice.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { runReconciliationForSignal } from "../../apps/api/src/reconciliation/index.js";
import { applyEnrichment } from "../../apps/api/src/intelligence/enrich.js";
import { compileOrganizationState, flushOrganizationStateForTest } from "../../apps/api/src/state/organization-state.js";
import { transformGithubWebhook, transformJiraWebhook } from "../../apps/api/src/integrations/webhookTransforms.js";
import { featureRefId } from "../../apps/api/src/integrations/claimReady.js";

function ensureTenant(seed: string): { userId: string; orgId: string } {
  const userId = `m${seed}${uuidv4().replace(/-/g, "").slice(0, 8)}`.slice(0, 32);
  if (!db.getUser(userId)) {
    db.createUser(userId, userId, hashPassword(`test-${userId}`));
  }
  return { userId, orgId: resolveTenantContext(userId).orgId };
}

function insertSignal(params: {
  userId: string;
  source: "SLACK" | "GITHUB" | "JIRA" | "LINEAR" | "MANUAL";
  content: string;
  subtype?: string;
  meta?: Record<string, unknown>;
}): string {
  const id = uuidv4();
  db.insertExternalSignal({
    id,
    userId: params.userId,
    source: params.source,
    content: params.content,
    owner: "tester",
    sourceSubtype: params.subtype,
    ingestMeta: params.meta ? JSON.stringify(params.meta) : undefined,
  });
  applyEnrichment(
    id,
    {
      signal_type: "observation",
      intent: params.content.slice(0, 120),
      risk: "medium",
      confidence: 0.7,
      related_decision_id: null,
      reasoning: "test",
      source: "heuristic",
      extras: {
        urgency: "soon",
        op_classification: "status",
        affected_systems: ["billing"],
      },
    },
    { urgency: "soon", op_classification: "status", affected_systems: ["billing"] },
    null,
  );
  return id;
}

describe("claim-ready transforms", () => {
  it("GitHub PR merged emits entity_id + current=merged", () => {
    const recs = transformGithubWebhook(
      {
        action: "closed",
        repository: { full_name: "acme/pay" },
        sender: { login: "alice" },
        pull_request: {
          number: 481,
          title: "Payment integration",
          body: "merge oauth",
          merged: true,
          state: "closed",
        },
      },
      { userId: "u1", deliveryId: "d1", event: "pull_request" },
    );
    assert.equal(recs.length, 1);
    const meta = recs[0]!.meta as Record<string, unknown>;
    assert.equal(meta.entity_type, "pull_request");
    assert.equal(meta.entity_id, "github:acme/pay#481");
    assert.equal(meta.current, "merged");
    assert.equal(meta.feature_hint, "Payment Integration");
  });

  it("Jira Done emits jira:PAY-142 + current status", () => {
    const recs = transformJiraWebhook(
      {
        webhookEvent: "jira:issue_updated",
        issue: {
          key: "PAY-142",
          fields: {
            summary: "Payment integration OAuth",
            status: { name: "Done" },
            assignee: { emailAddress: "dev@acme.test" },
          },
        },
      },
      { userId: "u1", bearerSecret: "x", deliveryId: "j1" },
    );
    assert.equal(recs[0]!.meta?.entity_id, "jira:PAY-142");
    assert.equal(recs[0]!.meta?.current, "Done");
    assert.equal(recs[0]!.meta?.feature_hint, "Payment Integration");
  });
});

describe("meaning vertical slice — Payment Integration", () => {
  it("four sources compile onto one feature with partial-state conflict", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    const feature = featureRefId("Payment Integration");

    const slack = insertSignal({
      userId,
      source: "SLACK",
      content: "OAuth configuration is blocking launch.",
      subtype: "slack.message",
      meta: {
        entity_type: "message",
        entity_id: "slack:T1:C1:111.222",
        event: "message",
        feature_hint: "Payment Integration",
        owner: "slack:U1",
      },
    });
    const jira = insertSignal({
      userId,
      source: "JIRA",
      content: "[jira:issue_updated] PAY-142 status=Done\nPayment integration OAuth",
      subtype: "jira.jira:issue_updated",
      meta: {
        entity_type: "issue",
        entity_id: "jira:PAY-142",
        event: "updated",
        current: "Done",
        feature_hint: "Payment Integration",
        aliases: ["PAY-142"],
      },
    });
    const gh = insertSignal({
      userId,
      source: "GITHUB",
      content: "[github:pull_request.closed] repo=acme/pay\nPR #481 merged :: Payment integration",
      subtype: "github.pull_request.closed",
      meta: {
        entity_type: "pull_request",
        entity_id: "github:acme/pay#481",
        event: "closed",
        current: "merged",
        feature_hint: "Payment Integration",
      },
    });
    const meeting = insertSignal({
      userId,
      source: "MANUAL",
      content: '[meeting:blocker] meeting="Launch sync"\nLaunch Friday unless OAuth isn\'t configured.',
      subtype: "meeting.blocker",
      meta: {
        entity_type: "meeting_item",
        entity_id: "meeting:m1:blocker:0",
        event: "blocker",
        current: "blocker",
        feature_hint: "Payment Integration",
        aliases: ["meeting:m1"],
      },
    });

    for (const id of [slack, jira, gh, meeting]) {
      runReconciliationForSignal(id, { force: true });
    }

    const snaps = db.rawGet(
      `SELECT dimension, state, entity_id FROM entity_state_snapshots WHERE tenant_id = ?`,
      [orgId],
    ) as Array<{ dimension: string; state: string; entity_id: string }>;
    const onFeature = snaps.filter((s) => s.entity_id === feature);
    assert.ok(onFeature.length >= 3, `expected snapshots on ${feature}, got ${JSON.stringify(snaps)}`);

    const dim = (name: string) => onFeature.find((s) => s.dimension === name)?.state?.toUpperCase();
    assert.ok(
      dim("IMPLEMENTATION") === "COMPLETE" || dim("CODE_INTEGRATION") === "COMPLETE",
      "code complete",
    );
    assert.equal(dim("TASK_STATUS"), "COMPLETE");
    assert.equal(dim("CUSTOMER_READINESS"), "BLOCKED");
    assert.ok(
      dim("LAUNCH_READINESS") === "AT_RISK" || dim("LAUNCH_READINESS") === "BLOCKED",
      `launch readiness ${dim("LAUNCH_READINESS")}`,
    );

    const aliases = db.rawGet(
      `SELECT alias_id, entity_ref_id FROM entity_aliases WHERE tenant_id = ?`,
      [orgId],
    ) as Array<{ alias_id: string; entity_ref_id: string }>;
    assert.ok(aliases.some((a) => a.alias_id === "jira:PAY-142" && a.entity_ref_id === feature));
    assert.ok(aliases.some((a) => a.alias_id === "github:acme/pay#481" && a.entity_ref_id === feature));
    assert.equal(aliases.filter((a) => a.alias_id.startsWith("soft:")).length, 0);

    const conflicts = db.rawGet(
      `SELECT * FROM conflicts WHERE tenant_id = ? AND status IN ('OPEN','ESCALATED')`,
      [orgId],
    ) as Array<{ dimension: string; conflict_type: string; decision_id: string | null }>;
    assert.ok(
      conflicts.some((c) => c.conflict_type === "PARTIAL_STATE" || c.dimension === "LAUNCH_READINESS"),
      `expected partial launch conflict, got ${JSON.stringify(conflicts)}`,
    );

    const evidence = db.rawGet(
      `SELECT DISTINCT e.signal_id FROM claim_evidence e
       JOIN claims c ON c.id = e.claim_id
       WHERE c.tenant_id = ? AND c.entity_id = ?`,
      [orgId, feature],
    ) as Array<{ signal_id: string }>;
    assert.ok(evidence.length >= 3, `expected multi-source evidence, got ${evidence.length}`);

    flushOrganizationStateForTest(orgId);
    const state = compileOrganizationState(orgId, userId);
    assert.ok(state.risks.items.length >= 1, "org-state risks from conflicts/snapshots");
    assert.ok(state.blockers.items.some((b) => /CUSTOMER_READINESS|DEPENDENCY|TASK_STATUS/i.test(String(b.type || b.label))));
    const actives = db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ).at(0) as { c: number };
    assert.equal(actives.c, 0);
  });
});

describe("meaning vertical slice — Friday vs Monday DRAFT", () => {
  it("DEADLINE conflict escalates to DRAFT not ACTIVE", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));

    runReconciliationForSignal(
      insertSignal({
        userId,
        source: "SLACK",
        content: "Founder: Launch Friday.",
        meta: { feature_hint: "Product Launch", entity_id: "slack:founder", event: "message" },
      }),
      { force: true },
    );
    const r = runReconciliationForSignal(
      insertSignal({
        userId,
        source: "SLACK",
        content: "Product: Launch Monday. decided",
        meta: { feature_hint: "Product Launch", entity_id: "slack:product", event: "message" },
      }),
      { force: true },
    );

    const conflicts = db.rawGet(
      `SELECT status, dimension, decision_id FROM conflicts
       WHERE tenant_id = ? AND dimension IN ('DEADLINE','DECISION')`,
      [orgId],
    ) as Array<{ status: string; dimension: string; decision_id: string | null }>;
    assert.ok(conflicts.length >= 1, "expected DEADLINE/DECISION conflict");

    const drafts = db.rawGet(
      `SELECT id, status FROM decision_ledger WHERE user_id = ? AND status = 'DRAFT'`,
      [userId],
    ) as Array<{ id: string; status: string }>;
    const actives = db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ).at(0) as { c: number };

    assert.equal(actives.c, 0, "must never auto-ACTIVE");
    assert.ok(
      r.conflictsEscalated >= 1 || drafts.length >= 1 || conflicts.some((c) => c.status === "ESCALATED"),
      `expected DRAFT/ESCALATED, conflicts=${JSON.stringify(conflicts)} drafts=${drafts.length} escalated=${r.conflictsEscalated}`,
    );
    for (const d of drafts) assert.equal(d.status, "DRAFT");
  });
});
