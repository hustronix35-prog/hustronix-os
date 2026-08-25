/**
 * Talk general / company / hybrid conversation. Run: npm run test:talk-general
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk/talk-orchestrator.js";
import { classifyTalkIntent } from "../../apps/api/src/intelligence/talk/talk-understanding.js";

function tenant(tag: string): string {
  const userId = `tgen_${tag}`.slice(0, 32);
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
       VALUES (?, ?, ?, 'ops', 12, ?)`,
      [randomUUID(), id, sig, snippet],
    );
  }
  return id;
}

function seedCompany(userId: string) {
  seedSit(userId, {
    title: "Forecast / coverage miss — Northstar",
    entity: "Northstar",
    explanation: "Coverage dropped below plan.",
    snippets: ["Northstar: the account team logged three serious complaints this month."],
  });
  seedSit(userId, {
    title: "Customer renewal / churn risk — Atlas",
    entity: "Atlas",
    explanation: "Renewal wobbling.",
    snippets: ["Atlas CS flagged renewal risk."],
  });
}

describe("Talk general conversation", () => {
  it("classifies general vs company vs hybrid", () => {
    assert.equal(classifyTalkIntent("What is CAC?").contextMode, "GENERAL");
    assert.equal(classifyTalkIntent("teach me basics of sales").mode, "LEARN");
    assert.equal(classifyTalkIntent("teach me basics of sales").contextMode, "GENERAL");
    assert.equal(classifyTalkIntent("What is our CAC?").contextMode, "COMPANY");
    assert.equal(classifyTalkIntent("How can I increase sales?").contextMode, "HYBRID");
    assert.equal(classifyTalkIntent("Teach me sales using our company.").contextMode, "HYBRID");
    assert.equal(classifyTalkIntent("Why is Northstar at risk?").contextMode, "COMPANY");
  });

  it("hi is casual without company dump", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "hi", { conversationId: "a" });
    assert.equal(turn.mode, "CASUAL");
    assert.equal(turn.situations.length, 0);
    assert.match(turn.answer, /hey|thinking through/i);
    assert.doesNotMatch(turn.answer, /Northstar|Mapped to your company/i);
  });

  it("teach me basics of sales is general teaching without situation dump", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "teach me basics of sales", { conversationId: "learn" });
    assert.equal(turn.mode, "LEARN");
    assert.equal(turn.contextMode, "GENERAL");
    assert.match(turn.answer, /demand|conversion|retention/i);
    assert.doesNotMatch(turn.answer, /Mapped to your company right now/i);
    assert.doesNotMatch(turn.answer, /I'd focus on three things/i);
    assert.equal(turn.situations.length, 0);
    assert.ok((turn.answer.match(/Northstar/gi) || []).length <= 1);
  });

  it("what is CAC stays general", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "What is CAC?");
    assert.equal(turn.contextMode, "GENERAL");
    assert.match(turn.answer, /acquisition cost|CAC/i);
    assert.doesNotMatch(turn.answer, /Northstar is getting worse/i);
  });

  it("how can I increase sales is hybrid with selective company context", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "How can I increase sales?", { conversationId: "hy" });
    assert.equal(turn.mode, "STRATEGY");
    assert.equal(turn.contextMode, "HYBRID");
    assert.match(turn.answer, /retention|conversion|demand/i);
    assert.match(turn.answer, /Northstar|Atlas|company/i);
    assert.doesNotMatch(turn.answer, /Mapped to your company right now/i);
  });

  it("teach using our company maps concepts to evidence", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Teach me sales using our company as an example.");
    assert.equal(turn.contextMode, "HYBRID");
    assert.match(turn.answer, /demand|conversion|retention/i);
    assert.match(turn.answer, /Northstar|Atlas|company/i);
  });

  it("brainstorm stays possibilities not decisions", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Brainstorm ways to increase sales.");
    assert.equal(turn.mode, "BRAINSTORM");
    assert.match(turn.answer, /1\./);
    assert.match(turn.answer, /not decisions/i);
  });

  it("investigation grounds in Northstar", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Why is Northstar at risk?");
    assert.equal(turn.contextMode, "COMPANY");
    assert.match(turn.answer, /Northstar/i);
    assert.ok(turn.situations.some((s) => /Northstar/i.test(s.title)));
  });

  it("follow-ups retain conversation; topic switch works", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    talkToHustronix(userId, "How can I increase sales?", { conversationId: "sw" });
    const why = talkToHustronix(userId, "Why?", { conversationId: "sw" });
    assert.match(why.answer, /because|covered|retention|pipeline|demand/i);

    const switchTopic = talkToHustronix(userId, "Teach me enterprise sales.", { conversationId: "sw" });
    assert.equal(switchTopic.mode, "LEARN");
    assert.equal(switchTopic.contextMode, "GENERAL");
    assert.doesNotMatch(switchTopic.answer, /Mapped to your company right now/i);
  });

  it("counterfactual marks uncertainty", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "What if we ignore Northstar?");
    assert.equal(turn.mode, "COUNTERFACTUAL");
    assert.match(turn.answer, /assumption|Observed|Unknown|signals/i);
  });

  it("execute still cannot skip governance", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Execute this.");
    assert.match(turn.answer, /governance|validation|not skip|no decision|not decision-ready|could not execute/i);
  });

  it("tenant isolation: other tenant situations never appear", () => {
    const a = tenant(randomUUID().slice(0, 8));
    const b = tenant(randomUUID().slice(0, 8));
    seedSit(a, {
      title: "SecretAcmeOnly renewal risk",
      entity: "SecretAcmeOnly",
      explanation: "private",
      snippets: ["SecretAcmeOnly confidential"],
    });
    seedCompany(b);
    const turn = talkToHustronix(b, "How can I increase sales?");
    assert.doesNotMatch(turn.answer, /SecretAcmeOnly/i);
    assert.ok(!turn.situations.some((s) => /SecretAcmeOnly/i.test(s.title)));
  });
});
