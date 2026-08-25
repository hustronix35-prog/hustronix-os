/**
 * Talk reasoning interface. Run: npm run test:talk-reasoning
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk/talk-orchestrator.js";
import { classifyTalkIntent } from "../../apps/api/src/intelligence/talk/talk-intent.js";

function tenant(tag: string): string {
  const userId = `treason_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSit(
  userId: string,
  opts: { title: string; entity: string; stage?: string; explanation: string; snippets: string[] },
): string {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, ?, ?, ?, 0.86, 'WORSENING', 12, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      `open_world_${id.slice(0, 8)}`,
      opts.title,
      opts.stage || "DECISION_READY",
      opts.explanation,
      JSON.stringify([opts.entity]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Review the evidence trail"]),
      opts.snippets.length,
    ],
  );
  for (const snippet of opts.snippets) {
    const sig = randomUUID();
    db.rawRun(
      `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
       VALUES (?, ?, 'SLACK', ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
      [sig, userId, snippet],
    );
    db.rawRun(
      `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
       VALUES (?, ?, ?, 'sales', 14, ?)`,
      [randomUUID(), id, sig, snippet],
    );
  }
  return id;
}

function seedCompany(userId: string) {
  seedSit(userId, {
    title: "SignalGrid launch delay",
    entity: "SignalGrid",
    stage: "FORMING",
    explanation: "Engineering hold on the SignalGrid connector for the launch window.",
    snippets: ["SignalGrid build is slipping the launch window."],
  });
  seedSit(userId, {
    title: "Northstar renewal forecast",
    entity: "Northstar",
    explanation: "Sales forecast for Northstar slipped after three pipeline signals.",
    snippets: ["Northstar sales forecast cut.", "Pipeline coverage on Northstar is thin."],
  });
  seedSit(userId, {
    title: "Enterprise pipeline coverage gap",
    entity: "Atlas",
    explanation: "Late-stage deals lack coverage; revenue risk in the current pipeline.",
    snippets: ["Pipeline coverage below plan for enterprise deals."],
  });
  seedSit(userId, {
    title: "Acme renewal risk",
    entity: "Acme",
    explanation: "Acme health and support signals show rising churn risk.",
    snippets: ["Acme flagged churn risk on the renewal."],
  });
  db.rawRun(
    `INSERT INTO decision_outcomes (id, tenant_id, decision_id, result, pattern_id, learning_notes)
     VALUES (?, ?, ?, 'failed', 'sales', 'Increase discounting to improve conversion did not improve the underlying outcome.')`,
    [randomUUID(), userId, randomUUID()],
  );
}

describe("Talk reasoning", () => {
  it("classifies strategy vs investigation vs brainstorm vs casual", () => {
    assert.equal(classifyTalkIntent("How can I increase sales?").mode, "STRATEGY");
    assert.equal(classifyTalkIntent("Why is Northstar at risk?").mode, "CUSTOMER_ANALYSIS");
    assert.equal(classifyTalkIntent("Brainstorm ways to increase sales.").mode, "BRAINSTORM");
    assert.equal(classifyTalkIntent("hi").mode, "CASUAL");
    assert.equal(classifyTalkIntent("What if we ignore Northstar?").mode, "COUNTERFACTUAL");
    assert.equal(classifyTalkIntent("give me basics of sales").mode, "LEARN");
    assert.equal(classifyTalkIntent("give me basics of sales").objective, "basics");
    assert.equal(classifyTalkIntent("give me basics of sales").contextMode, "GENERAL");
  });

  it("casual greetings do not dump situations", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    for (const q of ["hi", "hello", "good morning"]) {
      const turn = talkToHustronix(userId, q, { conversationId: "casual" });
      assert.equal(turn.situations.length, 0, q);
      assert.doesNotMatch(turn.answer, /SignalGrid|DECISION_READY|facet/i);
    }
  });

  it("company strategy synthesizes instead of listing one situation", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "How can I increase sales?", { conversationId: "s" });
    assert.equal(turn.mode, "STRATEGY");
    assert.match(turn.answer, /retention|conversion|demand|pipeline|company/i);
    assert.doesNotMatch(turn.answer, /SignalGrid/i);
    assert.doesNotMatch(turn.answer, /DECISION_READY|gateOk|pattern_id/i);
    assert.ok(turn.situations.length >= 2);
    assert.match(turn.answer, /tried a similar|I'd want to check|investigate|capacity|Priority|first move|cautious|retention/i);
  });

  it("basics of sales is educational, not the strategy playbook", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "give me basics of sales", { conversationId: "basics" });
    assert.equal(turn.mode, "LEARN");
    assert.equal(classifyTalkIntent("give me basics of sales").objective, "basics");
    assert.match(turn.answer, /Demand|Conversion|Retention|pipeline|funnel|revenue/i);
    assert.doesNotMatch(turn.answer, /I'd focus on three things right now/i);
    assert.doesNotMatch(turn.answer, /Mapped to your company right now/i);
    const strategy = talkToHustronix(userId, "How can I increase sales?", { conversationId: "basics2" });
    assert.notEqual(turn.answer.trim(), strategy.answer.trim());
  });

  it("investigation is situation-grounded for Northstar", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Why is Northstar at risk?");
    assert.match(turn.answer, /Northstar/i);
    assert.match(turn.answer, /getting worse|forecast|pipeline/i);
    assert.ok(turn.situations.some((s) => /Northstar/i.test(s.title)));
    assert.ok(!turn.situations.some((s) => /SignalGrid/i.test(s.title)));
  });

  it("brainstorm produces grounded levers", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Brainstorm ways to increase sales.");
    assert.equal(turn.mode, "BRAINSTORM");
    assert.match(turn.answer, /1\./);
    assert.match(turn.answer, /not decisions/i);
    assert.match(turn.answer, /Northstar|pipeline|retention/i);
  });

  it("follow-ups keep conversational context", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    talkToHustronix(userId, "Why is Northstar at risk?", { conversationId: "f" });
    const why = talkToHustronix(userId, "Why?", { conversationId: "f" });
    assert.match(why.answer, /Northstar/i);
    const wrong = talkToHustronix(userId, "What if that's wrong?", { conversationId: "f" });
    assert.match(wrong.answer, /if that's wrong|assumption|coverage|implementation/i);
  });

  it("counterfactual reasons without forcing a situation brief", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "What if we ignore Northstar?");
    assert.equal(turn.mode, "COUNTERFACTUAL");
    assert.match(turn.answer, /assumption|signals do not disappear|current state/i);
    assert.doesNotMatch(turn.answer, /is worsening \(stage:/i);
  });

  it("let's do option 2 enters the governed decision path", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    talkToHustronix(userId, "Brainstorm ways to increase sales.", { conversationId: "opt" });
    const turn = talkToHustronix(userId, "Let's do option 2.", { conversationId: "opt" });
    assert.match(turn.answer, /option 2|pipeline quality/i);
    assert.match(turn.answer, /decision|evidence|capacity|governance|DRAFT|not decision-ready|Created/i);
    const active = db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ) as { c: number }[];
    assert.equal(Number(active[0]?.c || 0), 0);
  });

  it("execute still cannot skip governance", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Execute this.");
    assert.match(turn.answer, /governance|validation|not skip|no decision|not decision-ready|could not execute/i);
  });

  it("factual claims stay tied to retrieved company context", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "How can I increase sales?");
    assert.ok(turn.context.evidence.length + turn.context.situations.length > 0);
    assert.equal(turn.grounded, true);
  });
});
