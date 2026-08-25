/**
 * Talk LLM synthesis helpers. Run: npm run test:talk-synthesis
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidencePacket,
  parseTalkSynthesisJson,
  shouldUseTalkLlm,
  validateSynthesisCitations,
} from "../../apps/api/src/intelligence/talk/talk-synthesis.js";
import { classifyTalkIntent } from "../../apps/api/src/intelligence/talk/talk-intent.js";
import { reasonAboutCompany } from "../../apps/api/src/intelligence/talk/talk-reasoning.js";
import type { CompanyContext } from "../../apps/api/src/intelligence/talk/talk-retrieval.js";

const sampleCtx = (): CompanyContext => ({
  situations: [
    {
      id: "sit-1",
      title: "Northstar renewal at risk",
      pattern_id: "p1",
      stage: "DECISION_READY",
      trajectory: "WORSENING",
      confidence: 0.82,
      entities: ["Northstar"],
      explanation: "Renewal thread worsening after SLA misses.",
      decision_id: null,
    },
  ],
  evidence: [
    {
      signalId: "sig-1",
      source: "SLACK",
      sourceLocation: null,
      timestamp: "2026-08-01T00:00:00.000Z",
      author: "cs-lead",
      snippet: "Northstar exec asked for a call about renewal timing.",
      facet: "ops",
      confidence: 0.7,
    },
  ],
  customers: [{ name: "Northstar", situationIds: ["sit-1"], worsening: true }],
  teams: [],
  people: [{ name: "Alex", team: "sales", blocked: 1 }],
  decisions: [],
  tasks: [],
  outcomes: [{ decision_id: "dec-old", result: "failed", pattern_id: "p0", notes: "Discount did not help." }],
  dependencies: [{ fromTeam: "sales", toTeam: "engineering", work: "Connector fix", status: "blocked" }],
  signals: [],
  bottleneckTalk: "Sales blocked waiting on engineering.",
  insufficient: false,
});

describe("talk synthesis", () => {
  beforeEach(() => {
    process.env.TALK_LLM_SYNTHESIS = "1";
    delete process.env.HUSTRONIX_INTEL_NO_LLM;
  });

  it("skips LLM for casual and governed modes", () => {
    const casual = classifyTalkIntent("hello");
    assert.equal(shouldUseTalkLlm(casual, sampleCtx()), false);

    const exec = classifyTalkIntent("Execute it.", { action: "execute" });
    assert.equal(shouldUseTalkLlm(exec, sampleCtx()), false);
  });

  it("builds evidence packet with citable ids", () => {
    const intent = classifyTalkIntent("Why is Northstar at risk?");
    const reasoned = reasonAboutCompany({ question: "Why is Northstar at risk?", intent, ctx: sampleCtx() });
    const { packet, allowedCitations } = buildEvidencePacket(sampleCtx(), reasoned);

    assert.ok(allowedCitations.has("situation:sit-1"));
    assert.ok(allowedCitations.has("signal:sig-1"));
    assert.ok(allowedCitations.has("outcome:dec-old"));
    assert.ok(allowedCitations.has("person:alex"));
    assert.equal(packet.situations[0]?.title, "Northstar renewal at risk");
    assert.ok(packet.deterministic.evidence.length > 0);
  });

  it("parses JSON synthesis including fenced-ish wrappers", () => {
    const raw = `Here is the analysis:
{"evidence_used":["situation:sit-1","signal:sig-1"],"inferences":["Renewal risk is real"],"alternatives":["Coverage issue"],"recommendation":"Stabilize the account","uncertainty":"Root cause unclear","confidence":0.71,"answer":"Northstar is getting worse and renewal is the live thread."}`;
    const parsed = parseTalkSynthesisJson(raw);
    assert.ok(parsed);
    assert.equal(parsed!.confidence, 0.71);
    assert.match(parsed!.answer, /Northstar/);
  });

  it("rejects citations outside the packet", () => {
    const intent = classifyTalkIntent("How can I increase sales?");
    const reasoned = reasonAboutCompany({ question: "How can I increase sales?", intent, ctx: sampleCtx() });
    const { allowedCitations } = buildEvidencePacket(sampleCtx(), reasoned);
    const bad = parseTalkSynthesisJson(
      '{"evidence_used":["situation:ghost"],"inferences":[],"alternatives":[],"recommendation":"x","uncertainty":"y","confidence":0.5,"answer":"test"}',
    );
    assert.ok(bad);
    const v = validateSynthesisCitations(bad!, allowedCitations);
    assert.equal(v.ok, false);
    assert.deepEqual(v.invalid, ["situation:ghost"]);
  });

  it("allows partial citation mismatch when some cites are valid", () => {
    const allowed = new Set(["situation:sit-1", "signal:sig-1"]);
    const syn = parseTalkSynthesisJson(
      '{"evidence_used":["situation:sit-1","situation:ghost"],"inferences":[],"alternatives":[],"recommendation":"x","uncertainty":"y","confidence":0.5,"answer":"Grounded answer."}',
    );
    assert.ok(syn);
    const v = validateSynthesisCitations(syn!, allowed);
    assert.equal(v.ok, false);
    assert.equal(v.invalid.length, 1);
  });
});
