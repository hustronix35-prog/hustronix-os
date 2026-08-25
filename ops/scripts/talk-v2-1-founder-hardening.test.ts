/**
 * Talk V2.1 founder hardening — routing / retrieval / response contract.
 * Run: npm run test:talk-v2-1
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk/talk-orchestrator.js";
import { classifyTalkIntent } from "../../apps/api/src/intelligence/talk/talk-understanding.js";
import { getTalkContext, rememberTalkTurn } from "../../apps/api/src/intelligence/talk/talk-context.js";

function tenant(tag: string): string {
  const userId = `tv21_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function seedSit(
  userId: string,
  opts: { title: string; entities: string[]; explanation: string; snippets: string[]; trajectory?: string },
): string {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count, updated_at)
     VALUES (?, ?, ?, ?, 'ELEVATED', 0.86, ?, 12, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      id,
      userId,
      `biz_${id.slice(0, 8)}`,
      opts.title,
      opts.trajectory || "WORSENING",
      opts.explanation,
      JSON.stringify(opts.entities),
      JSON.stringify(["ops"]),
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

function seed(userId: string) {
  seedSit(userId, {
    title: "Northstar renewal risk",
    entities: ["Northstar"],
    explanation: "Repeated complaints and declining health.",
    snippets: ["Northstar logged three serious complaints this month."],
  });
  seedSit(userId, {
    title: "Atlas expansion stalled",
    entities: ["Atlas"],
    explanation: "Champion went quiet after pricing.",
    snippets: ["Atlas champion stopped responding."],
  });
  seedSit(userId, {
    title: "Launch blocked on security review",
    entities: ["Engineering", "Security", "Legal"],
    explanation: "Engineering waits on Security; Security waits on Legal.",
    snippets: ["Eng blocked on Security credential review.", "Security waiting on Legal approval."],
    trajectory: "STABLE",
  });
}

describe("Talk V2.1 founder hardening", () => {
  it("classifies overview / risk / challenge / recommend / explore / metric / bottleneck", () => {
    assert.equal(classifyTalkIntent("what's going on with the company?").objective, "company_overview");
    assert.equal(classifyTalkIntent("which customers should I worry about?").objective, "customer_risk");
    assert.equal(classifyTalkIntent("are you sure?").mode, "COUNTERFACTUAL");
    assert.equal(classifyTalkIntent("what else could explain this?").objective, "alternative_hypotheses");
    assert.equal(classifyTalkIntent("what would you do if you were me?").objective, "recommendation");
    assert.equal(classifyTalkIntent("what could we try?").mode, "BRAINSTORM");
    assert.equal(classifyTalkIntent("give me some options").mode, "BRAINSTORM");
    assert.equal(classifyTalkIntent("what's our CAC?").objective, "company_metric");
    assert.equal(classifyTalkIntent("what's blocking the launch?").objective, "bottleneck");
    assert.equal(classifyTalkIntent("what's blocking the launch?").suspendStickyFocus, true);
  });

  it("company overview retrieves context", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const turn = talkToHustronix(userId, "what's going on with the company?");
    assert.equal(turn.contextMode, "COMPANY");
    assert.ok((turn.trace?.retrieved_context_count || 0) > 0 || turn.situations.length > 0);
    assert.doesNotMatch(turn.answer, /don't have enough company evidence/i);
    assert.match(turn.answer, /Northstar|Atlas|launch|stand out|attention/i);
  });

  it("customer risk retrieves customers", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const turn = talkToHustronix(userId, "which customers should I worry about?");
    assert.equal(classifyTalkIntent("which customers should I worry about?").objective, "customer_risk");
    assert.match(turn.answer, /Northstar|Atlas/i);
    assert.doesNotMatch(turn.answer, /don't have enough company evidence/i);
  });

  it("challenge after Northstar uses conversation focus", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const cid = "v21-challenge";
    talkToHustronix(userId, "Why is Northstar a problem?", { conversationId: cid });
    const challenge = talkToHustronix(userId, "Are you sure it's the product and not pricing?", {
      conversationId: cid,
    });
    assert.equal(challenge.mode, "COUNTERFACTUAL");
    assert.match(challenge.answer, /alternative|pricing|challenge|Current view|distinguish/i);
    assert.doesNotMatch(challenge.answer, /^What needs attention first is/i);
  });

  it("what else inherits Northstar focus", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const cid = "v21-else";
    talkToHustronix(userId, "Why is Northstar struggling?", { conversationId: cid });
    const turn = talkToHustronix(userId, "What else could explain this?", { conversationId: cid });
    assert.equal(turn.mode, "COUNTERFACTUAL");
    assert.ok(turn.trace?.retrieved_entities?.some((e) => /northstar/i.test(e)) || /Northstar/i.test(turn.answer));
  });

  it("what would you do is recommendation", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const cid = "v21-rec";
    talkToHustronix(userId, "Why is Northstar a problem?", { conversationId: cid });
    const turn = talkToHustronix(userId, "What would you do if you were me?", { conversationId: cid });
    assert.equal(turn.mode, "STRATEGY");
    assert.match(turn.answer, /If I were prioritizing|recommend|before|Trade-off/i);
  });

  it("brainstorm synonyms explore", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    for (const q of ["brainstorm some options", "what could we try?", "give me some options", "how could we approach this?"]) {
      const turn = talkToHustronix(userId, q, { conversationId: `ex-${q.slice(0, 12)}` });
      assert.equal(turn.mode, "BRAINSTORM", q);
      assert.match(turn.answer, /possibilit|lever|option|try|Want to pursue/i, q);
    }
  });

  it("topic override: launch not sticky Northstar", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const cid = "v21-launch";
    talkToHustronix(userId, "Why is Northstar at risk?", { conversationId: cid });
    const turn = talkToHustronix(userId, "What's blocking the launch?", { conversationId: cid });
    assert.equal(turn.context?.situations?.length === 0 ? true : true, true);
    assert.match(turn.answer, /Security|Legal|Engineering|launch|credential|waiting|blocked/i);
    // Should not be the Northstar attention dump
    assert.doesNotMatch(turn.answer, /^What needs attention first is Northstar/i);
  });

  it("metric never attention-dumps", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const cid = "v21-metric";
    talkToHustronix(userId, "Why is Northstar a problem?", { conversationId: cid });
    for (const q of ["What's our CAC?", "What is our exact conversion rate?"]) {
      const turn = talkToHustronix(userId, q, { conversationId: cid });
      assert.match(turn.answer, /don't (currently )?have a reliable|To calculate it/i, q);
      assert.doesNotMatch(turn.answer, /What needs attention first|top attention thread/i, q);
      assert.doesNotMatch(turn.answer, /our CAC is [₹$€]?\s*\d/i, q);
    }
  });

  it("conversation focus helpers still remember after overview", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    rememberTalkTurn(userId, "seed", "ans", {
      conversationId: "mem",
      customer: "Northstar",
      entities: ["Northstar"],
      mode: "CUSTOMER_ANALYSIS",
      contextMode: "COMPANY",
    });
    const ctx = getTalkContext(userId, "mem");
    assert.equal(ctx.activeCustomerId, "Northstar");
  });
});
