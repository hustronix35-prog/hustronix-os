/**
 * Talk V2.2 conversational hardening — founder failure matrix.
 * Run: npm run test:talk-v2-2
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
import { getTalkContext } from "../../apps/api/src/intelligence/talk/talk-context.js";

function tenant(tag: string): string {
  const userId = `tv22_${tag}`.slice(0, 32);
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
    explanation: "Repeated product complaints and declining health.",
    snippets: [
      "Northstar logged three serious product reliability complaints this month.",
      "Northstar CSAT dropped after the outage.",
    ],
  });
  seedSit(userId, {
    title: "Atlas expansion stalled",
    entities: ["Atlas"],
    explanation: "Champion went quiet after pricing.",
    snippets: ["Atlas champion stopped responding after the price discussion."],
  });
  seedSit(userId, {
    title: "Launch blocked on security review",
    entities: ["Engineering", "Security", "Legal"],
    explanation: "Engineering waits on Security; Security waits on Legal.",
    snippets: ["Eng blocked on Security credential review."],
    trajectory: "STABLE",
  });
}

describe("Talk V2.2 orientation", () => {
  for (const q of ["what is this?", "what is Hustronix?", "what do you do?", "what is this for?", "okay… so what is this thing actually for?"]) {
    it(`orients without company dump: ${q}`, () => {
      const intent = classifyTalkIntent(q);
      assert.equal(intent.objective, "product_orientation");
      assert.equal(intent.contextMode, "GENERAL");
      assert.equal(intent.requiresCompanyContext, false);
      const userId = tenant(randomUUID().slice(0, 8));
      seed(userId);
      const turn = talkToHustronix(userId, q);
      assert.match(turn.answer, /Hustronix helps you understand/i);
      assert.doesNotMatch(turn.answer, /Northstar|Atlas|Meridian|renewal risk/i);
      assert.doesNotMatch(turn.answer, /Company Brain|pattern_id|decision-ready/i);
    });
  }
});

describe("Talk V2.2 focused evidence", () => {
  it("preserves Northstar focus for evidence follow-ups", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const first = talkToHustronix(userId, "tell me more about Northstar");
    assert.match(first.answer, /Northstar/i);
    assert.doesNotMatch(first.answer, /A few things deserve attention|stand out right now/i);

    for (const q of ["what evidence do you have?", "show me the evidence", "why do you think that?"]) {
      const turn = talkToHustronix(userId, q);
      const intent = classifyTalkIntent(q, { context: getTalkContext(userId) });
      assert.equal(intent.deepen, "evidence");
      assert.equal(intent.objective, "focused_evidence");
      assert.match(String(intent.entity || ""), /Northstar/i);
      assert.match(turn.answer, /basing that on|Here's what I'm basing/i);
      assert.match(turn.answer, /Northstar|SLACK|product/i);
      assert.doesNotMatch(turn.answer, /A few things deserve attention|stand out right now/i);
      assert.doesNotMatch(turn.answer, /Meridian|CobaltWorks/i);
    }
  });
});

describe("Talk V2.2 counterfactual polarity", () => {
  it("does not manufacture evidence-against from supporting product complaints", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    talkToHustronix(userId, "tell me more about Northstar");
    for (const q of ["are you sure it's not just a pricing issue?", "is it pricing?", "what else could explain this?", "are you sure?"]) {
      const intent = classifyTalkIntent(q, { context: getTalkContext(userId) });
      assert.equal(intent.mode, "COUNTERFACTUAL");
      const turn = talkToHustronix(userId, q);
      if (/pric/i.test(q)) {
        assert.match(turn.answer, /don't currently have strong evidence against|pricing hypothesis is possible/i);
        // Supporting product complaint must not appear as "Evidence against"
        const againstIdx = turn.answer.toLowerCase().indexOf("evidence against");
        if (againstIdx >= 0) {
          const after = turn.answer.slice(againstIdx, againstIdx + 280).toLowerCase();
          assert.doesNotMatch(after, /reliability complaints|csat dropped after the outage/);
        }
      }
      assert.doesNotMatch(turn.answer, /Company Brain/i);
    }
  });
});

describe("Talk V2.2 learn → apply", () => {
  it("preserves LEARN topic into HYBRID apply", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);
    const teach = talkToHustronix(userId, "teach me the basics of enterprise sales");
    assert.equal(teach.contextMode, "GENERAL");
    assert.match(teach.answer, /Demand|Conversion|Retention/i);
    assert.doesNotMatch(teach.answer, /Northstar renewal/i);

    const applyIntent = classifyTalkIntent("okay, apply that to our situation", {
      context: getTalkContext(userId),
    });
    assert.equal(applyIntent.mode, "LEARN");
    assert.equal(applyIntent.contextMode, "HYBRID");
    assert.equal(applyIntent.objective, "learn_with_company");

    const apply = talkToHustronix(userId, "okay, apply that to our situation");
    assert.equal(apply.contextMode, "HYBRID");
    assert.match(apply.answer, /apply|layers|Demand|Conversion|Retention|company/i);
    assert.doesNotMatch(apply.answer, /A few things deserve attention|stand out right now/i);
  });
});

describe("Talk V2.2 temporal", () => {
  for (const q of ["what changed recently?", "what's different this week?", "what's getting worse?"]) {
    it(`temporal routing: ${q}`, () => {
      const intent = classifyTalkIntent(q);
      assert.equal(intent.objective, "temporal_delta");
      const plan = planTalkRetrieval({ question: q, intent, conversation: null });
      assert.equal(plan.reason, "temporal_delta");
      assert.equal(plan.companyWide, true);

      const userId = tenant(randomUUID().slice(0, 8));
      seed(userId);
      const turn = talkToHustronix(userId, q);
      assert.match(turn.answer, /changed recently|getting worse|improving|timestamped|important change/i);
      assert.doesNotMatch(turn.answer, /A few things deserve attention\. /i);
    });
  }
});

describe("Talk V2.2 decision outcome", () => {
  for (const q of [
    "did our last decision on Northstar actually help?",
    "what happened after the decision?",
    "did that work?",
    "what did we learn?",
  ]) {
    it(`outcome eval (not ACTION dump): ${q}`, () => {
      const userId = tenant(randomUUID().slice(0, 8));
      seed(userId);
      talkToHustronix(userId, "tell me more about Northstar");
      const intent = classifyTalkIntent(q, { context: getTalkContext(userId) });
      assert.equal(intent.objective, "decision_outcome");
      assert.equal(intent.governedAction, false);
      assert.notEqual(intent.contextMode, "ACTION");
      const turn = talkToHustronix(userId, q);
      assert.match(turn.answer, /not enough evidence|inconclusive|decision|Afterward|measured result|current thread status/i);
      assert.doesNotMatch(turn.answer, /A few things deserve attention/i);
    });
  }
});

describe("Talk V2.2 metric honesty", () => {
  for (const q of ["what's our CAC?", "what's our conversion rate?"]) {
    it(`metric only: ${q}`, () => {
      const userId = tenant(randomUUID().slice(0, 8));
      seed(userId);
      talkToHustronix(userId, "tell me more about Northstar");
      const intent = classifyTalkIntent(q);
      assert.equal(intent.objective, "company_metric");
      const turn = talkToHustronix(userId, q);
      assert.match(turn.answer, /don't have a reliable|To calculate it/i);
      assert.doesNotMatch(turn.answer, /Northstar renewal|A few things deserve attention/i);
      assert.doesNotMatch(turn.answer, /Company Brain/i);
    });
  }
});

describe("Talk V2.2 conversation switching", () => {
  it("Northstar → launch → sales teach → apply → Northstar", () => {
    const userId = tenant(randomUUID().slice(0, 8));
    seed(userId);

    const n = talkToHustronix(userId, "tell me more about Northstar");
    assert.match(n.answer, /Northstar/i);

    const launch = talkToHustronix(userId, "what's blocking the launch?");
    assert.equal(classifyTalkIntent("what's blocking the launch?").objective, "bottleneck");
    assert.match(launch.answer, /Security|Legal|Engineering|blocked/i);
    assert.doesNotMatch(launch.answer, /Northstar renewal risk/i);

    const teach = talkToHustronix(userId, "teach me enterprise sales");
    assert.equal(teach.contextMode, "GENERAL");
    assert.match(teach.answer, /Demand|Conversion/i);

    const apply = talkToHustronix(userId, "apply that to our situation");
    assert.equal(apply.contextMode, "HYBRID");

    const back = talkToHustronix(userId, "tell me more about Northstar");
    assert.match(back.answer, /Northstar/i);
  });
});

describe("Talk V2.2 governance unchanged", () => {
  it("explicit create decision remains ACTION", () => {
    const intent = classifyTalkIntent("create the decision");
    assert.equal(intent.contextMode, "ACTION");
    assert.equal(intent.governedAction, true);
  });

  it("reverse decision remains governed OUTCOME", () => {
    const intent = classifyTalkIntent("reverse the decision");
    assert.equal(intent.mode, "OUTCOME");
    assert.equal(intent.governedAction, true);
  });
});
