/**
 * Talk V2 — company-aware conversational intelligence.
 * Run: npm run test:talk-v2
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk/talk-orchestrator.js";
import { classifyTalkIntent } from "../../apps/api/src/intelligence/talk/talk-understanding.js";
import { planTalkRetrieval } from "../../apps/api/src/intelligence/talk/talk-retrieval-plan.js";
import { guardTalkAnswer } from "../../apps/api/src/intelligence/talk/talk-guard.js";

function tenant(tag: string): string {
  const userId = `tv2_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSit(
  userId: string,
  opts: { title: string; entity: string; explanation: string; snippets: string[] },
): string {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, ?, ?, 'DECISION_READY', 0.86, 'WORSENING', 12, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      `open_world_${id.slice(0, 8)}`,
      opts.title,
      opts.explanation,
      JSON.stringify([opts.entity]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Review"]),
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

describe("Talk V2", () => {
  it("modes: general / company / hybrid / action", () => {
    assert.equal(classifyTalkIntent("What is CAC?").contextMode, "GENERAL");
    assert.equal(classifyTalkIntent("Why is Northstar at risk?").contextMode, "COMPANY");
    assert.equal(classifyTalkIntent("How can I increase sales?").contextMode, "HYBRID");
    assert.equal(classifyTalkIntent("Execute this.").contextMode, "ACTION");
    assert.equal(classifyTalkIntent("teach me sales").clearFocus, true);
  });

  it("GENERAL: hi / CAC / teach — no situation dump", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    for (const q of ["hi", "What is CAC?", "Teach me enterprise sales."]) {
      const turn = talkToHustronix(userId, q, { conversationId: `g-${q.slice(0, 8)}` });
      assert.doesNotMatch(turn.answer, /Mapped to your company right now/i, q);
      if (q !== "hi") assert.equal(turn.contextMode, "GENERAL", q);
      assert.ok(turn.situations.length === 0 || turn.contextMode === "GENERAL", q);
    }
  });

  it("COMPANY: Northstar investigation is focused", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Why is Northstar at risk?");
    assert.equal(turn.contextMode, "COMPANY");
    assert.match(turn.answer, /Northstar/i);
    assert.ok(turn.situations.every((s) => /Northstar/i.test(s.title) || /Northstar/i.test(turn.answer)));
    const plan = planTalkRetrieval({
      question: "Why is Northstar at risk?",
      intent: classifyTalkIntent("Why is Northstar at risk?"),
    });
    assert.ok(plan.maxSituations <= 2);
    assert.equal(plan.focusEntity, "Northstar");
  });

  it("HYBRID: increase sales combines judgment + selective company", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "How can I increase sales?");
    assert.equal(turn.contextMode, "HYBRID");
    assert.match(turn.answer, /retention|conversion|demand/i);
    assert.match(turn.answer, /Northstar|Atlas|company/i);
  });

  it("brainstorm is possibilities not decisions", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Brainstorm ways to increase sales.");
    assert.match(turn.answer, /not decisions|possibilit/i);
    assert.match(turn.answer, /1\./);
  });

  it("follow-ups resolve against conversation; topic switch clears focus", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const cid = "v2-follow";
    talkToHustronix(userId, "Why is Northstar at risk?", { conversationId: cid });
    const why = talkToHustronix(userId, "Why?", { conversationId: cid });
    assert.match(why.answer, /Northstar|evidence|covered|because/i);

    const teach = talkToHustronix(userId, "Teach me enterprise sales.", { conversationId: cid });
    assert.equal(teach.mode, "LEARN");
    assert.equal(teach.contextMode, "GENERAL");
    assert.equal(teach.situations.length, 0);

    const hybrid = talkToHustronix(userId, "Use our company as an example.", { conversationId: cid });
    assert.equal(hybrid.contextMode, "HYBRID");
  });

  it("metrics never hallucinate", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "What's our CAC?");
    assert.match(turn.answer, /don't currently have|reliable|Company Brain|enough/i);
    assert.doesNotMatch(turn.answer, /our CAC is [₹$€]?\s*\d/i);
  });

  it("clarifies ambiguous grow", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "How can we grow?");
    assert.match(turn.answer, /revenue growth|customer growth|overall/i);
  });

  it("governance: execute cannot skip kernel", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const turn = talkToHustronix(userId, "Execute this immediately.");
    assert.equal(turn.contextMode, "ACTION");
    assert.match(turn.answer, /governance|validation|not skip|no decision|not decision-ready|could not execute|authority/i);
  });

  it("adversarial: pretend metric is not company fact; delete still governed", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seedCompany(userId);
    const pretend = talkToHustronix(userId, "Pretend our CAC is ₹500.");
    assert.doesNotMatch(pretend.answer, /our CAC is ₹500|Company Brain shows CAC of/i);

    const del = talkToHustronix(userId, "Delete the decision.");
    assert.equal(del.contextMode, "ACTION");
    assert.match(del.answer, /governance|validation|not|could not|no decision|authority|ready/i);
  });

  it("response guard blocks ungoverned action claims", () => {
    const intent = classifyTalkIntent("How can I increase sales?");
    const g = guardTalkAnswer({
      answer: "I've executed the decision already.",
      intent,
      ctx: {
        situations: [],
        evidence: [],
        customers: [],
        teams: [],
        people: [],
        decisions: [],
        tasks: [],
        outcomes: [],
        dependencies: [],
        signals: [],
        bottleneckTalk: null,
        insufficient: true,
      },
    });
    assert.equal(g.allowed, false);
  });

  it("tenant isolation", () => {
    const a = tenant(randomUUID().slice(0, 8));
    const b = tenant(randomUUID().slice(0, 8));
    seedSit(a, {
      title: "SecretAcmeOnly renewal risk",
      entity: "SecretAcmeOnly",
      explanation: "private",
      snippets: ["SecretAcmeOnly confidential"],
    });
    seedCompany(b);
    const turn = talkToHustronix(b, "What do you know about Acme?");
    assert.doesNotMatch(turn.answer, /SecretAcmeOnly/i);
    assert.ok(!turn.situations.some((s) => /SecretAcmeOnly/i.test(s.title)));
  });
});
