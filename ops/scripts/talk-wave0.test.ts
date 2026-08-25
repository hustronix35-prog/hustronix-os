/**
 * Wave 0 Talk: incomplete v3 cannot skip the gate; validate-then-execute commits.
 * Run: npx tsx --test ops/scripts/talk-wave0.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { mutationCreateDraftDecision } from "../../apps/api/src/security/mutation-handlers.js";
import { requireCausalValidationForActivation } from "../../apps/api/src/institutional-reasoning.js";
import { buildInstitutionalMemoFromSituation } from "../../apps/api/src/intelligence/situation-institutional.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";

function tenant(tag: string): string {
  const userId = `talkw0_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSituation(userId: string) {
  const id = randomUUID();
  const sigA = randomUUID();
  const sigB = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, 'open_world_test', 'Northwind warehouse delay', 'DECISION_READY', 0.86, 'WORSENING', 12,
       'Shipments slipping; evidence from ops and sales.', ?, ?, ?, 2)`,
    [
      id,
      userId,
      JSON.stringify(["Northwind"]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Restore the SLA", "Weekly exec update"]),
    ],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', 'Northwind warehouse delay reported', CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigA, userId],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', 'Northwind SLA miss flagged', CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigB, userId],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'ops', 12, 'Warehouse delay on Northwind outbound.')`,
    [randomUUID(), id, sigA],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'sales', 14, 'Account team flags Northwind SLA miss.')`,
    [randomUUID(), id, sigB],
  );
  return id;
}

describe("Talk Wave 0 governance", () => {
  it("incomplete v3 still throws CAUSAL_VALIDATION_REQUIRED", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const draft = mutationCreateDraftDecision(userId, {
      vow: `Address Northwind delay ${userId}`,
      institutional_reasoning: {
        institutional_version: 3,
        confidence_0_1: 0.5,
        ranked_hypotheses: [],
        causal_validation: { complete: false, checklist_completed: [], instrumentation_integrity_verified: false, exact_abandonment_or_dropoff_step_documented: "" },
      },
    });
    const row = db.getDecisionLedgerRow(draft.id);
    assert.throws(
      () => requireCausalValidationForActivation(row?.decision_reasoning),
      /CAUSAL_VALIDATION_REQUIRED/,
    );
  });

  it("Talk execute does not skip validation", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedSituation(userId);
    const created = talkToHustronix(userId, "Create the decision.", { action: "create_decision" });
    assert.ok(created.decision_id);
    const skipped = talkToHustronix(userId, "Execute it.", { focusId: created.focus_id, action: "execute" });
    assert.match(skipped.answer, /will not skip causal validation/i);
    const status = db.getDecisionLedgerRow(created.decision_id!)?.status;
    assert.equal(String(status), "DRAFT");
  });

  it("Talk validate then execute commits ACTIVE tasks", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedSituation(userId);
    const created = talkToHustronix(userId, "Create the decision.", { action: "create_decision" });
    const focus = created.focus_id;
    const d = created.decision_id!;
    talkToHustronix(userId, "What else could be true?", { focusId: focus, action: "hypotheses" });
    talkToHustronix(userId, "Instrumentation is OK.", { focusId: focus, action: "instrumentation" });
    const executed = talkToHustronix(userId, "Execute it.", { focusId: focus, action: "execute" });
    assert.match(executed.answer, /ACTIVE/i);
    assert.equal(String(db.getDecisionLedgerRow(d)?.status), "ACTIVE");
    const n = (
      db.rawGet(`SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id = ?`, [d]) as { c: number }[]
    )[0];
    assert.ok(Number(n.c) >= 1);
  });

  it("built memo is completeable only after Talk seals it", () => {
    const memo = buildInstitutionalMemoFromSituation({
      id: "s1",
      title: "VoltHarbor pack-line hold",
      pattern_id: "open",
      stage: "DECISION_READY",
      confidence: 0.8,
      trajectory: "WORSENING",
      explanation: "Cell swelling hold",
      first_observed_day: 14,
      facets: ["ops"],
      entities: ["VoltHarbor"],
      recommended: ["Hold the line"],
      evidence: [
        { sim_day: 14, facet: "ops", snippet: "Pack line held for swelling." },
        { sim_day: 15, facet: "qa", snippet: "QA confirms cell swelling." },
      ],
      competingTitles: [],
    });
    assert.equal(memo.causal_validation.complete, false);
    assert.equal(memo.ranked_hypotheses.length, 3);
    assert.ok(memo.validation_requirements.every((r) => r.status === "PENDING"));
    assert.throws(() => requireCausalValidationForActivation(JSON.stringify(memo)), /CAUSAL_VALIDATION_REQUIRED/);
  });
});
