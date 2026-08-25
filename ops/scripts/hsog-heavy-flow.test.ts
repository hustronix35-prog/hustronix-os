/**
 * Provider ingest + scorer sanity.
 * Run: npx tsx --test ops/scripts/hsog-heavy-flow.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { ingestHsogViaProviders } from "../../apps/api/src/integrations/hsog/providerIngest.js";
import { HSOG_QUESTIONS, scoreHsogAnswer } from "../../apps/api/src/integrations/hsog/gradeAnswers.js";
import type { HsogIngestBundle } from "../../apps/api/src/integrations/hsog/types.js";

function mini(): HsogIngestBundle {
  return {
    version: 1,
    start_date: "2026-02-02",
    events: [
      {
        event_id: "e1",
        day: 20,
        scenario_id: "product_launch_slip",
        event_type: "requirement_created",
        actors: ["Imani"],
        entity_ids: ["PRJ-NEXUSAI-20", "nexusai"],
        visibility_scope: "team:product",
        ground_truth_fact_ids: ["fact_nexus_eval_gap"],
        summary: "Product publishes NexusAI 2.0 PRD covering decision trails.",
        artifacts: [
          { artifact_id: `sl_${randomUUID().slice(0, 6)}`, artifact_type: "slack_message" },
          { artifact_id: `jr_${randomUUID().slice(0, 6)}`, artifact_type: "jira_issue" },
          { artifact_id: `gh_${randomUUID().slice(0, 6)}`, artifact_type: "github_pr" },
          { artifact_id: `em_${randomUUID().slice(0, 6)}`, artifact_type: "email_thread" },
          { artifact_id: `cr_${randomUUID().slice(0, 6)}`, artifact_type: "crm_record" },
          { artifact_id: `mt_${randomUUID().slice(0, 6)}`, artifact_type: "meeting_transcript" },
        ],
      },
    ],
  };
}

describe("hsog provider ingest channels", () => {
  it("lands Slack Jira GitHub Gmail CRM meeting via real transforms", () => {
    const tag = randomUUID().slice(0, 8);
    const userId = `hprov_${tag}`.slice(0, 32);
    db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
    resolveTenantContext(userId);
    const tally = ingestHsogViaProviders(userId, mini());
    assert.ok((tally.slack?.inserted || 0) + (tally.slack_nango?.inserted || 0) >= 1, "slack");
    assert.ok((tally.jira?.inserted || 0) >= 1, "jira");
    assert.ok((tally.github?.inserted || 0) >= 1, "github");
    assert.ok((tally.gmail?.inserted || 0) >= 1, "gmail");
    assert.ok((tally.crm?.inserted || 0) >= 1, "crm");
    assert.ok((tally.meeting?.inserted || 0) >= 1, "meeting");

    const sources = db.rawGet(
      `SELECT DISTINCT source FROM external_signals WHERE user_id = ?`,
      [userId],
    ) as { source: string }[];
    const set = new Set(sources.map((s) => s.source));
    assert.ok(set.has("SLACK"));
    assert.ok(set.has("JIRA"));
    assert.ok(set.has("GITHUB"));
    assert.ok(set.has("GMAIL"));
    assert.ok(set.has("CRM"), "crm bucket");
    assert.ok(set.has("MEETING"), "meeting bucket");
    const meetings = (
      db.rawGet(
        `SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND source = 'MEETING'`,
        [userId],
      ) as { c: number }[]
    )[0];
    assert.equal(Number(meetings.c), 1, "one transcript row, not heuristic fan-out");
  });
});

describe("hsog grader", () => {
  it("scores strong vs weak answers on 0-4 scale", () => {
    const q = HSOG_QUESTIONS[0];
    const strong = scoreHsogAnswer(q, {
      answer:
        "Weak benchmark coverage missed customer-specific retrieval-context edge cases. Evidence links were omitted for decision trails. Renata flagged architecture risk before launch review. Sales overstatement to Acme increased business impact.",
      cited_artifact_types: ["confluence_page", "jira_issue", "github_pr", "crm_record", "slack_message"],
      supporting_artifact_ids: ["jira_NEX-418", "slack_product"],
    });
    const weak = scoreHsogAnswer(q, {
      answer: "It was only a generic engineering delay and security approved launch without caveat.",
      cited_artifact_types: [],
      supporting_artifact_ids: [],
    });
    assert.ok(strong.score_0_to_4 >= 3, `strong=${strong.score_0_to_4}`);
    assert.ok(weak.score_0_to_4 <= 2, `weak=${weak.score_0_to_4}`);
    assert.equal(strong.passed, true);
  });
});
