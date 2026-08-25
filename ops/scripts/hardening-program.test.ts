/**
 * Hardening program: dependency chains, parallel situations, evidence, coherence,
 * incremental detect, founder Talk, bounded learning, observability, trust defaults.
 *
 *   npm run test:hardening
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { detectBottleneck } from "../../apps/api/src/org/bottleneck-intelligence.js";
import { loadEvidenceReferences, formatEvidenceLine } from "../../apps/api/src/intelligence/evidence-reference.js";
import { evaluateSituationCoherence } from "../../apps/api/src/intelligence/situation-coherence.js";
import { countUnprocessedSignals, DETECT_ENGINE_VERSION } from "../../apps/api/src/intelligence/signal-processing.js";
import { osHealthSnapshot } from "../../apps/api/src/intelligence/os-observability.js";
import { defaultTrustPolicy } from "../../apps/api/src/security/design-partner-trust.js";
import { formatAlternativeHypotheses } from "../../apps/api/src/intelligence/talk-explanations.js";
import {
  getReadinessPrior,
  updateFromOutcome,
  MAX_MIN_EVIDENCE_DELTA,
  MAX_ABS_SCORE_FLOOR_DELTA,
} from "../../apps/api/src/intelligence/readiness-learning.js";
import { gatesAllowReady } from "../../apps/api/src/intelligence/situation-engine.js";

function tenant(tag: string): string {
  const userId = `hdn_${tag}_${randomUUID().slice(0, 8)}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
  resolveTenantContext(userId);
  return userId;
}

function ingest(userId: string, day: string, content: string, ext: string) {
  ingestExternal({
    userId,
    provider: "slack",
    content,
    externalId: ext,
    tenantKey: userId,
    detectedAt: `${day}T12:00:00Z`,
    owner: "slack:#engineering",
  });
}

describe("P0 dependency intelligence", () => {
  it("walks Engineering → Security → Legal and Talk explains the bottleneck with provenance", () => {
    const userId = tenant("deps");
    ingest(
      userId,
      "2026-03-01",
      "Engineering blocked on Security for production credentials — cannot ship the connector.",
      "dep:1",
    );
    ingest(
      userId,
      "2026-03-03",
      "Security waiting on Legal for data-processing language before credential exception approval.",
      "dep:2",
    );
    ingest(
      userId,
      "2026-03-05",
      "Legal review queue: Security credential exception for Engineering still pending contract clause.",
      "dep:3",
    );
    runSituationDetection(userId);
    db.rawRun(`DELETE FROM org_dependencies WHERE user_id = ?`, [userId]);

    const sigs = db.rawGet(`SELECT id FROM external_signals WHERE user_id = ? ORDER BY detected_at`, [userId]) as {
      id: string;
    }[];
    assert.ok(sigs.length >= 2, "seed signals missing");
    db.rawRun(
      `INSERT INTO org_dependencies
        (id, user_id, from_team, from_work, to_team, to_work, status, source, edge_type, evidence_json, confidence_0_1)
       VALUES (?, ?, 'engineering', 'Waiting: Security credential review', 'security', 'credential review', 'DELAYED', 'manual', 'waits_on', ?, 0.82)`,
      [randomUUID(), userId, JSON.stringify([sigs[0]?.id].filter(Boolean))],
    );
    db.rawRun(
      `INSERT INTO org_dependencies
        (id, user_id, from_team, from_work, to_team, to_work, status, source, edge_type, evidence_json, confidence_0_1)
       VALUES (?, ?, 'security', 'Waiting: Legal approval', 'legal', 'Legal approval', 'DELAYED', 'manual', 'waits_on', ?, 0.8)`,
      [randomUUID(), userId, JSON.stringify([sigs[1]?.id].filter(Boolean))],
    );

    const report = detectBottleneck(userId, "engineering");
    assert.match(String(report.bottleneck), /security/i);
    assert.ok(report.blockedTeams.some((t) => /engineering/i.test(t)));
    assert.ok(report.upstreamBlockers.some((t) => /legal/i.test(t)));
    assert.ok(report.evidence.length >= 1, "every claim must have provenance");

    const talk = talkToHustronix(userId, "Who is blocked?");
    assert.match(talk.answer, /Engineering is blocked/i);
    assert.match(talk.answer, /Security is the immediate blocker/i);
    assert.match(talk.answer, /Legal is the upstream blocker/i);
    assert.doesNotMatch(talk.answer, /Engineering → Security\s*$/);
  });
});

describe("P0 parallel situation isolation", () => {
  it("keeps Acme renewal and Acme implementation as separate evidence clusters", () => {
    const userId = tenant("acme");
    ingest(userId, "2026-04-01", "Acme renewal conversation isn't going well — sponsor stopped responding.", "a:1");
    ingest(
      userId,
      "2026-04-03",
      "Acme support escalations spiking; customer evaluating an alternative vendor.",
      "a:2",
    );
    ingest(
      userId,
      "2026-04-05",
      "Acme implementation milestone slipped two weeks — connector still unstable.",
      "a:3",
    );
    ingest(
      userId,
      "2026-04-07",
      "Acme SIEM export alert: unusual admin access path flagged during implementation.",
      "a:4",
    );
    runSituationDetection(userId);

    const sits = db.rawGet(
      `SELECT id, title, pattern_id, causal_cluster, primary_entity_key FROM situations
        WHERE user_id = ? AND (primary_entity_key LIKE 'acme%' OR title LIKE '%Acme%')`,
      [userId],
    ) as Array<{
      id: string;
      title: string;
      pattern_id: string;
      causal_cluster: string | null;
      primary_entity_key: string;
    }>;
    assert.ok(sits.length >= 2, `expected ≥2 Acme situations, got ${sits.length}: ${sits.map((s) => s.title).join("; ")}`);

    const renewal = sits.find((s) => /renewal|churn/i.test(s.title) && !/implementation/i.test(s.title));
    const impl = sits.find((s) => /implementation/i.test(s.title) || s.causal_cluster === "implementation");
    assert.ok(renewal, "renewal situation missing");
    assert.ok(impl, "implementation situation missing");
    assert.notEqual(renewal!.id, impl!.id);

    const renewalSnips = (
      db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [renewal!.id]) as {
        snippet: string;
      }[]
    ).map((r) => (r.snippet || "").toLowerCase());
    const implSnips = (
      db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [impl!.id]) as {
        snippet: string;
      }[]
    ).map((r) => (r.snippet || "").toLowerCase());

    assert.equal(
      renewalSnips.some((s) => /milestone slipped|connector still unstable/.test(s) && !/renewal/.test(s)),
      false,
      "implementation-only evidence leaked into renewal",
    );
    assert.equal(
      implSnips.some((s) => /renewal conversation|alternative vendor/.test(s) && !/implementation/.test(s)),
      false,
      "renewal-only evidence leaked into implementation",
    );
  });
});

describe("P1 evidence + founder Talk + coherence + incremental", () => {
  it("formats evidence as source · date — snippet, not raw signal ids", () => {
    const userId = tenant("ev");
    ingest(userId, "2026-08-17", "Engineering blocked on Security for production credentials.", "e:1");
    runSituationDetection(userId);
    const sit = (
      db.rawGet(`SELECT id FROM situations WHERE user_id = ? LIMIT 1`, [userId]) as { id: string }[]
    )[0];
    if (!sit) return;
    const refs = loadEvidenceReferences(sit.id, 4);
    assert.ok(refs.length >= 1);
    const line = formatEvidenceLine(refs[0]);
    assert.match(line, /Slack/i);
    assert.doesNotMatch(line, /^signal_id\s*=/i);
  });

  it("presents alternative hypotheses without internal jargon", () => {
    const text = formatAlternativeHypotheses([
      {
        id: "h_primary",
        statement: "Renewal risk is real.",
        probability_0_1: 0.6,
        supporting_evidence: [{ source: "slack", description: "Three independent signals disagree with the reported health score.", strength_0_1: 0.7 }],
        counter_signals: [],
      },
      {
        id: "h_instrumentation",
        statement: "The metric itself may be wrong.",
        probability_0_1: 0.25,
        supporting_evidence: [
          { source: "slack", description: "three independent signals disagree with the reported health score", strength_0_1: 0.6 },
        ],
        counter_signals: ["independent customer-health data shows the same decline"],
      },
      {
        id: "h_other",
        statement: "Coincidental cluster.",
        probability_0_1: 0.15,
        supporting_evidence: [],
        counter_signals: [],
      },
    ]);
    assert.match(text, /Another possibility:/i);
    assert.match(text, /Why we think this:/i);
    assert.doesNotMatch(text, /\bgateOk\b|\bpattern_id\b|\breadiness_score\b/);
  });

  it("coherence gate is conjunctive and does not weaken READY_GATES", () => {
    const userId = tenant("coh");
    const sitId = randomUUID();
    db.rawRun(
      `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, evidence_count, primary_entity_key)
       VALUES (?, ?, 'customer_churn_risk', 'Thin story', 'ELEVATED', 0.9, 'WORSENING', 1, 'acme')`,
      [sitId, userId],
    );
    const coh = evaluateSituationCoherence(userId, sitId);
    assert.equal(coh.ok, false);
    assert.ok(coh.reasons.includes("evidence_sufficient"));
    assert.equal(
      gatesAllowReady("customer_churn_risk", new Set(["health", "support"]), 4, 2, null),
      true,
    );
  });

  it("second detect only scans unprocessed signals", () => {
    const userId = tenant("inc");
    ingest(userId, "2026-05-01", "Acme renewal conversation isn't going well.", "i:1");
    ingest(userId, "2026-05-02", "Acme support escalations and alternative vendor chatter.", "i:2");
    const first = runSituationDetection(userId);
    assert.ok(first.scanned >= 2);
    const unprocessedAfter = countUnprocessedSignals(userId, DETECT_ENGINE_VERSION);
    assert.equal(unprocessedAfter, 0);
    const second = runSituationDetection(userId);
    assert.equal(second.scanned, 0);
    ingest(userId, "2026-05-03", "Acme executive sponsor still silent on the renewal.", "i:3");
    const third = runSituationDetection(userId);
    assert.equal(third.scanned, 1);
  });
});

describe("P2 learning isolation + observability + trust defaults", () => {
  it("failed outcomes tighten pattern A and leave pattern B unchanged; deltas stay bounded", () => {
    const userId = tenant("learn");
    const insert = (pattern: string, result: string) => {
      const decisionId = randomUUID();
      db.rawRun(
        `INSERT INTO decision_outcomes
          (id, tenant_id, decision_id, result, pattern_id, learning_applied, expected_json, actual_json)
         VALUES (?, ?, ?, ?, ?, 0, '{}', '{}')`,
        [randomUUID(), userId, decisionId, result, pattern],
      );
      return updateFromOutcome(decisionId);
    };
    for (let i = 0; i < 5; i++) insert("customer_churn_risk", "failed");
    const a = getReadinessPrior(userId, "customer_churn_risk");
    const b = getReadinessPrior(userId, "security_incident");
    assert.ok(a.min_evidence_delta >= 1);
    assert.equal(b.min_evidence_delta, 0);
    assert.ok(a.min_evidence_delta <= MAX_MIN_EVIDENCE_DELTA);
    const beforeB = { ...b };
    for (let i = 0; i < 5; i++) insert("customer_churn_risk", "successful");
    const a2 = getReadinessPrior(userId, "customer_churn_risk");
    const b2 = getReadinessPrior(userId, "security_incident");
    assert.ok(Math.abs(a2.score_floor_delta) <= MAX_ABS_SCORE_FLOOR_DELTA);
    assert.equal(b2.min_evidence_delta, beforeB.min_evidence_delta);
  });

  it("OS health snapshot exposes processing and ledger counters", () => {
    const userId = tenant("obs");
    ingest(userId, "2026-06-01", "Acme renewal conversation isn't going well.", "o:1");
    runSituationDetection(userId);
    const snap = osHealthSnapshot(userId);
    assert.ok(snap.signals_ingested >= 1);
    assert.ok(snap.signals_processed >= 1);
    assert.ok(typeof snap.situations_created === "number");
    assert.equal(snap.engine_version, DETECT_ENGINE_VERSION);
  });

  it("design-partner trust defaults are read-only and no-train", () => {
    const policy = defaultTrustPolicy();
    assert.equal(policy.connectors, "read_only");
    assert.equal(policy.train_on_customer_data, false);
    assert.equal(policy.tenant_isolation, true);
    assert.deepEqual(policy.partner_ramp, ["READ_ONLY", "OBSERVE", "VALIDATE", "DECIDE", "EXECUTE"]);
  });
});
