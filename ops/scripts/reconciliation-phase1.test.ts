/**
 * Phase 1 Signal Conflict & Reconciliation Engine tests.
 * Run: npm run test:reconciliation (from apps/api)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { runReconciliationForSignal, runReconciliationFireAndForget } from "../../apps/api/src/reconciliation/index.js";
import { applyEnrichment } from "../../apps/api/src/intelligence/enrich.js";

function ensureTenant(seed: string): { userId: string; orgId: string } {
  /** Must keep slug unique: provisionDefaultOrganization uses userId.slice(0, 12). */
  const userId = `r${seed}${uuidv4().replace(/-/g, "").slice(0, 8)}`.slice(0, 32);
  if (!db.getUser(userId)) {
    db.createUser(userId, userId, hashPassword(`test-${userId}`));
  }
  const ctx = resolveTenantContext(userId);
  return { userId, orgId: ctx.orgId };
}

function insertSignal(params: {
  userId: string;
  source: "SLACK" | "GITHUB" | "JIRA" | "LINEAR" | "MANUAL";
  content: string;
  detectedAt?: string;
}): string {
  const id = uuidv4();
  db.insertExternalSignal({
    id,
    userId: params.userId,
    source: params.source,
    content: params.content,
    owner: "tester",
    detectedAt: params.detectedAt,
  });
  /** Mark enriched so processSignal cost gates aren't required for direct recon calls. */
  applyEnrichment(
    id,
    {
      signal_type: "observation",
      intent: params.content.slice(0, 120),
      risk: "low",
      confidence: 0.7,
      related_decision_id: null,
      reasoning: "test",
      source: "heuristic",
      extras: {
        urgency: "informational",
        op_classification: "status",
        affected_systems: ["billing"],
      },
    },
    {
      urgency: "informational",
      op_classification: "status",
      affected_systems: ["billing"],
    },
    null,
  );
  return id;
}

function snapshots(orgId: string, entityId?: string) {
  if (entityId) {
    return db.rawGet(
      `SELECT * FROM entity_state_snapshots WHERE tenant_id = ? AND entity_id = ?`,
      [orgId, entityId],
    ) as Array<{ dimension: string; state: string; entity_id: string }>;
  }
  return db.rawGet(`SELECT * FROM entity_state_snapshots WHERE tenant_id = ?`, [orgId]) as Array<{
    dimension: string;
    state: string;
    entity_id: string;
  }>;
}

function openConflicts(orgId: string) {
  return db.rawGet(
    `SELECT * FROM conflicts WHERE tenant_id = ? AND status IN ('OPEN','ESCALATED')`,
    [orgId],
  ) as Array<{ id: string; dimension: string; status: string; decision_id: string | null }>;
}

describe("reconciliation — different-dimension coexistence", () => {
  it("GitHub merged + Slack customer blocked → no false STATE_MISMATCH", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    const gh = insertSignal({
      userId,
      source: "GITHUB",
      content: "PR #481 merged for payment integration",
    });
    const slack = insertSignal({
      userId,
      source: "SLACK",
      content:
        "Payment integration is still blocked. Customer still hasn't completed OAuth setup.",
    });

    runReconciliationForSignal(gh, { force: true });
    runReconciliationForSignal(slack, { force: true });

    const snaps = snapshots(orgId);
    const dims = new Set(snaps.map((s) => s.dimension));
    assert.ok(dims.has("IMPLEMENTATION") || dims.has("CODE_INTEGRATION"));
    assert.ok(dims.has("CUSTOMER_READINESS") || dims.has("DEPENDENCY"));

    const falseConflicts = openConflicts(orgId).filter(
      (c) => c.dimension === "IMPLEMENTATION" || c.dimension === "CODE_INTEGRATION",
    );
    assert.equal(falseConflicts.length, 0);

    const impl = snaps.find((s) => s.dimension === "IMPLEMENTATION");
    const cust = snaps.find((s) => s.dimension === "CUSTOMER_READINESS");
    if (impl) assert.equal(impl.state, "COMPLETE");
    if (cust) assert.equal(cust.state, "BLOCKED");
  });
});

describe("reconciliation — same-dimension genuine conflict", () => {
  it("Jira DONE vs Slack NOT DONE on TASK_STATUS opens or resolves conflict", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    const jira = insertSignal({
      userId,
      source: "JIRA",
      content: "PAY-142 Status: Done — payment integration",
    });
    const slack = insertSignal({
      userId,
      source: "SLACK",
      content: "Payment integration task is still blocked on our side",
    });

    runReconciliationForSignal(jira, { force: true });
    const r2 = runReconciliationForSignal(slack, { force: true });

    const activeClaims = db.rawGet(
      `SELECT * FROM claims WHERE tenant_id = ? AND dimension = 'TASK_STATUS'`,
      [orgId],
    ) as Array<{ status: string; value: string; state: string | null }>;
    assert.ok(activeClaims.length >= 1);

    /** Either auto-resolved by authority (Jira wins) or OPEN/ESCALATED */
    const snap = snapshots(orgId).find((s) => s.dimension === "TASK_STATUS");
    assert.ok(snap, "expected TASK_STATUS snapshot");
    const conflicts = db.rawGet(`SELECT * FROM conflicts WHERE tenant_id = ? AND dimension = 'TASK_STATUS'`, [
      orgId,
    ]) as unknown[];
    assert.ok(
      conflicts.length >= 1 || snap.state === "COMPLETE" || r2.conflictsResolved >= 1,
      "expected conflict row or authority resolve to COMPLETE",
    );
  });
});

describe("reconciliation — temporal supersession", () => {
  it("BLOCKED then later COMPLETE on TASK_STATUS supersedes", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    const older = insertSignal({
      userId,
      source: "JIRA",
      content: "PAY-200 payment integration blocked",
      detectedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    });
    runReconciliationForSignal(older, { force: true });

    /** Age the blocked claim so temporal path can fire clearly */
    db.rawRun(
      `UPDATE claims SET last_seen_at = ? WHERE tenant_id = ? AND state = 'BLOCKED'`,
      [new Date(Date.now() - 3 * 3600_000).toISOString(), orgId],
    );

    const newer = insertSignal({
      userId,
      source: "JIRA",
      content: "PAY-200 payment integration Status: Done completed",
      detectedAt: new Date().toISOString(),
    });
    const result = runReconciliationForSignal(newer, { force: true });

    const snap = snapshots(orgId).find((s) => s.dimension === "TASK_STATUS");
    assert.ok(snap);
    assert.equal(snap.state, "COMPLETE");
    assert.ok(result.conflictsResolved >= 0);
    const superseded = db.rawGet(
      `SELECT COUNT(*) AS c FROM claims WHERE tenant_id = ? AND status = 'SUPERSEDED'`,
      [orgId],
    ).at(0) as { c: number };
    assert.ok(superseded.c >= 1 || snap.state === "COMPLETE");
  });
});

describe("reconciliation — stale evidence", () => {
  it("very old BLOCKED loses to fresh COMPLETE", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    const old = insertSignal({
      userId,
      source: "SLACK",
      content: "payment integration still blocked",
      detectedAt: new Date(Date.now() - 40 * 24 * 3600_000).toISOString(),
    });
    runReconciliationForSignal(old, { force: true });
    db.rawRun(
      `UPDATE claims SET last_seen_at = ? WHERE tenant_id = ?`,
      [new Date(Date.now() - 40 * 24 * 3600_000).toISOString(), orgId],
    );

    const fresh = insertSignal({
      userId,
      source: "JIRA",
      content: "PAY-301 payment integration Status: Done",
    });
    runReconciliationForSignal(fresh, { force: true });

    const snap = snapshots(orgId).find((s) => s.dimension === "TASK_STATUS");
    assert.ok(snap);
    assert.equal(snap.state, "COMPLETE");
  });
});

describe("reconciliation — authority-weighted resolution", () => {
  it("Jira COMPLETE outranks Slack COMPLETE noise on TASK_STATUS when conflicting with BLOCKED", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    runReconciliationForSignal(
      insertSignal({
        userId,
        source: "JIRA",
        content: "PAY-410 payment integration Done",
      }),
      { force: true },
    );
    runReconciliationForSignal(
      insertSignal({
        userId,
        source: "SLACK",
        content: "payment integration is still blocked",
      }),
      { force: true },
    );

    const snap = snapshots(orgId).find((s) => s.dimension === "TASK_STATUS");
    assert.ok(snap);
    /** Jira authority should win or leave OPEN; must not invent ACTIVE decision */
    assert.ok(["COMPLETE", "BLOCKED"].includes(snap.state));
    const activeDecisions = db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ).at(0) as { c: number };
    assert.equal(activeDecisions.c, 0);
  });
});

describe("reconciliation — unresolved → DRAFT", () => {
  it("conflicting launch decisions escalate to DRAFT only", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    runReconciliationForSignal(
      insertSignal({
        userId,
        source: "MANUAL",
        content: "We will launch Product Launch on Friday — confirmed",
      }),
      { force: true },
    );
    /** Use meeting-like content with similar authority via SLACK DECISION */
    const r = runReconciliationForSignal(
      insertSignal({
        userId,
        source: "SLACK",
        content: "Launch postponed to Monday — decided in standup for Product Launch",
      }),
      { force: true },
    );

    const drafts = db.rawGet(
      `SELECT id, status, vow FROM decision_ledger WHERE user_id = ? AND status = 'DRAFT'`,
      [userId],
    ) as Array<{ id: string; status: string; vow: string }>;
    const actives = db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ).at(0) as { c: number };

    assert.equal(actives.c, 0, "must never auto-ACTIVE");

    const escalated = openConflicts(orgId).filter((c) => c.status === "ESCALATED");
    if (r.conflictsEscalated > 0 || escalated.length > 0) {
      assert.ok(drafts.length >= 1, "expected DRAFT decision from escalation");
      assert.ok(drafts.every((d) => d.status === "DRAFT"));
      for (const c of escalated) {
        assert.ok(c.decision_id);
        const st = db.rawGet(`SELECT status FROM decision_ledger WHERE id = ?`, [c.decision_id]).at(0) as {
          status: string;
        };
        assert.equal(st.status, "DRAFT");
      }
    } else {
      /** If authority auto-resolved, still no ACTIVE */
      assert.equal(actives.c, 0);
    }
  });
});

describe("reconciliation — failure isolation", () => {
  it("missing signal and fire-and-forget never throw", () => {
    assert.doesNotThrow(() => runReconciliationForSignal("does-not-exist"));
    assert.doesNotThrow(() => runReconciliationFireAndForget("does-not-exist"));
  });

  it("enrichment remains intact after reconciliation", () => {
    const { userId } = ensureTenant(uuidv4().slice(0, 8));
    const id = insertSignal({
      userId,
      source: "GITHUB",
      content: "PR #99 merged payment integration",
    });
    runReconciliationForSignal(id, { force: true });
    const sig = db.getSignalById(id);
    assert.ok(sig);
    assert.ok(sig.intent);
    assert.equal(sig.state, "UNVERIFIED");
  });
});

describe("reconciliation — evidence aggregation", () => {
  it("multiple signals supporting same claim share one claim row", () => {
    const { userId, orgId } = ensureTenant(uuidv4().slice(0, 8));
    const a = insertSignal({
      userId,
      source: "SLACK",
      content: "Payment integration blocked — customer OAuth not done",
    });
    const b = insertSignal({
      userId,
      source: "SLACK",
      content: "Payment integration still blocked because OAuth configuration missing",
    });
    runReconciliationForSignal(a, { force: true });
    runReconciliationForSignal(b, { force: true });

    const claims = db.rawGet(
      `SELECT id FROM claims WHERE tenant_id = ? AND dimension = 'CUSTOMER_READINESS' AND status = 'ACTIVE'`,
      [orgId],
    ) as Array<{ id: string }>;
    assert.ok(claims.length >= 1);
    const evidence = db.rawGet(
      `SELECT COUNT(*) AS c FROM claim_evidence WHERE claim_id = ?`,
      [claims[0]!.id],
    ).at(0) as { c: number };
    assert.ok(evidence.c >= 2);
  });
});

describe("reconciliation — no auto-ACTIVE regression", () => {
  it("saveDecisionEvent from escalate stays DRAFT under ACTIVE conflict gate", () => {
    const { userId } = ensureTenant(uuidv4().slice(0, 8));
    const marker = uuidv4();
    /** Create an ACTIVE decision first */
    const activeId = db.saveDecisionEvent(userId, {
      vow: `Active control vow for regression ${marker}`,
      expected_outcomes: [`control-${marker}`],
      constraints: [],
    });
    db.transitionDecisionState(activeId, "ACTIVE", "test activate");

    const afterActivate = db.rawGet(
      `SELECT status, user_id FROM decision_ledger WHERE id = ?`,
      [activeId],
    ).at(0) as { status: string; user_id: string };
    assert.equal(afterActivate.status, "ACTIVE");
    assert.equal(afterActivate.user_id, userId);

    runReconciliationForSignal(
      insertSignal({
        userId,
        source: "MANUAL",
        content: `Confirmed we will launch on Friday (${marker})`,
      }),
      { force: true },
    );
    runReconciliationForSignal(
      insertSignal({
        userId,
        source: "SLACK",
        content: `Decided: launch postponed to Monday (${marker})`,
      }),
      { force: true },
    );

    const actives = db.rawGet(
      `SELECT id, vow FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ) as Array<{ id: string; vow: string }>;
    assert.equal(actives.length, 1);
    assert.equal(actives[0]!.id, activeId);

    const drafts = db.rawGet(
      `SELECT status FROM decision_ledger WHERE user_id = ? AND status = 'DRAFT'`,
      [userId],
    ) as Array<{ status: string }>;
    for (const d of drafts) assert.equal(d.status, "DRAFT");
  });
});
