/**
 * Talk → Company Brain routing. Run: npm run test:talk-company-brain
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk-orchestrator.js";

function tenant(tag: string): string {
  const userId = `tcb_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSit(
  userId: string,
  opts: {
    title: string;
    entity: string;
    stage?: string;
    explanation: string;
    snippets: string[];
  },
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
  const signalGrid = seedSit(userId, {
    title: "SignalGrid launch delay",
    entity: "SignalGrid",
    stage: "FORMING",
    explanation: "Engineering hold on the SignalGrid connector for the launch window.",
    snippets: ["SignalGrid build is slipping the launch window."],
  });
  const northstar = seedSit(userId, {
    title: "Northstar renewal forecast",
    entity: "Northstar",
    explanation: "Sales forecast for Northstar slipped after three pipeline signals.",
    snippets: ["Northstar sales forecast cut.", "Pipeline coverage on Northstar is thin."],
  });
  const pipeline = seedSit(userId, {
    title: "Enterprise pipeline coverage gap",
    entity: "Meridian",
    explanation: "Late-stage deals lack coverage; revenue risk in the current pipeline.",
    snippets: ["Pipeline coverage below plan for enterprise deals."],
  });
  const acme = seedSit(userId, {
    title: "Acme renewal risk",
    entity: "Acme",
    explanation: "Acme health and support signals show rising churn risk.",
    snippets: ["Acme flagged churn risk on the renewal.", "Acme support load is up."],
  });
  return { signalGrid, northstar, pipeline, acme };
}

describe("Talk Company Brain", () => {
  it("greeting does not retrieve a situation or SignalGrid", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { signalGrid } = seedCompany(userId);
    const turn = talkToHustronix(userId, "hi", { focusId: signalGrid, sessionId: "s1" });
    assert.equal(turn.situations.length, 0);
    assert.equal(turn.focus_id, null);
    assert.equal(turn.grounded, false);
    assert.match(turn.answer, /hey|thinking through/i);
    assert.doesNotMatch(turn.answer, /SignalGrid/i);
    assert.doesNotMatch(turn.answer, /Northstar/i);
  });

  it("generic sales question retrieves sales context without forcing Northstar", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    const { signalGrid } = seedCompany(userId);
    const turn = talkToHustronix(userId, "How can I increase sales?", {
      focusId: signalGrid,
      sessionId: "s1",
    });
    assert.match(turn.answer, /Company Brain|pipeline|retention|Protect revenue|Priority|focus/i);
    assert.doesNotMatch(turn.answer, /SignalGrid/i);
    assert.ok(!turn.situations.some((s) => /SignalGrid/i.test(s.title)));
    assert.ok(turn.situations.some((s) => /pipeline|forecast|northstar|acme|renewal/i.test(s.title)));
    assert.notEqual(turn.focus_id, signalGrid);
    assert.doesNotMatch(turn.answer, /DECISION_READY|gateOk|pattern_id/i);
    assert.match(turn.answer, /focus|priority|retention|pipeline|Protect|Company Brain/i);
  });

  it("brainstorm distinguishes company evidence from ideas", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Give me 5 ways we could reduce churn.");
    assert.match(turn.answer, /lever|possibilit/i);
    assert.match(turn.answer, /1\./);
    assert.match(turn.answer, /5\./);
    assert.match(turn.answer, /not decisions/i);
    assert.match(turn.answer, /churn|renewal|acme|retention/i);
  });

  it("situation analysis grounds in Acme evidence and trajectory", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "What's going wrong with Acme?");
    assert.match(turn.answer, /Acme/i);
    assert.match(turn.answer, /worsening|getting worse|trajectory|impact/i);
    assert.ok(turn.situations.some((s) => /Acme/i.test(s.title)));
    assert.ok(!turn.situations.some((s) => /SignalGrid/i.test(s.title)));
    assert.equal(turn.intent, "brief");
  });

  it("follow-up why refers to the previous answer", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const first = talkToHustronix(userId, "What's going wrong with Acme?", { sessionId: "follow" });
    const turn = talkToHustronix(userId, "Why?", { sessionId: "follow" });
    assert.match(turn.answer, /just covered|because of what|Acme/i);
    assert.match(turn.answer, /Acme/i);
    assert.ok(first.answer.length > 20);
  });

  it("challenge returns evidence for, against, uncertainty, and an alternative", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Are we sure Acme is actually at risk?");
    assert.match(turn.answer, /evidence for/i);
    assert.match(turn.answer, /evidence against/i);
    assert.match(turn.answer, /uncertainty/i);
    assert.match(turn.answer, /alternative hypothesis/i);
    assert.match(turn.answer, /Acme/i);
  });

  it("execute goes through governance and the mutation gateway", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Execute the recommended action.");
    assert.match(turn.answer, /governance|validation|not skip|no decision|not decision-ready|could not execute/i);
    const active = db.rawGet(
      `SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
      [userId],
    ) as { c: number }[];
    assert.equal(Number(active[0]?.c || 0), 0);
  });

  it("says so when the company brain has no relevant evidence", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "What is our European expansion strategy?");
    assert.match(turn.answer, /I don't have enough company evidence/i);
    assert.doesNotMatch(turn.answer, /our european expansion is/i);
    assert.equal(turn.grounded, false);
  });
});
