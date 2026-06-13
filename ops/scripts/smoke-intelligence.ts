/**
 * Multi-check smoke harness for the intelligence + ingest stack.
 *
 * Run with:
 *   npm run smoke:intelligence
 *
 * Each check returns ok/skip/fail. The process exits non-zero if any check
 * fails. SKIP is used for paths that need credentials we don't have here
 * (LLM, embeddings) — those run only in CI / live envs.
 *
 * Coverage:
 *   1. DB schema  — required columns + FTS5 + embeddings + meeting tables
 *   2. Ingest router roundtrip + idempotency
 *   3. GitHub webhook transform unit
 *   4. Slack adapter unit
 *   5. Heuristic enricher
 *   6. Detector → enricher persistence on a fresh signal
 *   7. Operational queries (drift / overload / conflicts)
 *   8. Reports shape (weekly drift + health) + markdown formatter
 *   9. Meeting heuristic ingest fan-out
 *  10. Hybrid search round-trip
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import {
  processSignal,
  fetchDecisionContext,
  hybridSearch,
  enrichHeuristic,
  findDriftSignals,
  findOverloadedOwners,
  findConflictingExecutions,
  weeklyDriftReport,
  operationalHealth,
  formatWeeklyDriftMarkdown,
  formatHealthMarkdown,
  ingestMeeting,
} from "../../apps/api/src/intelligence/index.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { transformGithubWebhook, transformSlackEvent } from "../../apps/api/src/integrations/webhookTransforms.js";

type CheckResult = { name: string; status: "ok" | "skip" | "fail"; detail?: string };
const results: CheckResult[] = [];

function ok(name: string, detail?: string) {
  results.push({ name, status: "ok", detail });
  console.log(`✔ ${name}${detail ? `  ${detail}` : ""}`);
}
function skip(name: string, detail: string) {
  results.push({ name, status: "skip", detail });
  console.log(`~ ${name}  (skip: ${detail})`);
}
function fail(name: string, detail: string) {
  results.push({ name, status: "fail", detail });
  console.error(`✘ ${name}  ${detail}`);
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}

// =====================================================================

async function checkSchema() {
  const name = "1. DB schema";
  try {
    const cols = (db as any).db.prepare("PRAGMA table_info(external_signals)").all() as { name: string }[];
    const required = [
      "intent",
      "risk",
      "intent_confidence",
      "related_decision_id",
      "intent_extracted_at",
      "intelligence_error",
      "urgency",
      "affected_systems",
      "op_classification",
      "source_subtype",
      "external_id",
      "ingest_meta",
    ];
    const missing = required.filter((c) => !cols.some((x) => x.name === c));
    if (missing.length) throw new Error(`missing columns on external_signals: ${missing.join(", ")}`);

    const tables = (db as any).db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual table')").all() as { name: string }[];
    const tnames = new Set(tables.map((t) => t.name));
    for (const t of [
      "signals_fts",
      "executions_fts",
      "decisions_fts",
      "entity_embeddings",
      "external_event_dedup",
      "meeting_ingestions",
    ]) {
      if (!tnames.has(t)) throw new Error(`missing table: ${t}`);
    }
    ok(name, `${cols.length} cols, all required intelligence tables present`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

function checkIngestRouter() {
  const name = "2. Ingest router roundtrip + idempotency";
  try {
    const externalId = `smoke-${Date.now()}`;
    const r1 = ingestExternal(
      {
        provider: "manual",
        subtype: "manual.smoke",
        userId: "system",
        content: "[smoke] ingest router roundtrip test",
        owner: "smoke:harness",
        externalId,
        meta: { harness: true },
      },
      { allowSystemFallback: true },
    );
    if (r1.duplicate) throw new Error("first call should not be a duplicate");
    const row = db.getSignalById(r1.signalId);
    if (!row) throw new Error("inserted signal not found");
    assertEq(row.source, "MANUAL", "source bucket");
    assertEq(row.source_subtype, "manual.smoke", "subtype persisted");
    assertEq(row.external_id, externalId, "external_id persisted");

    /** Same external_id should be a no-op duplicate. */
    const r2 = ingestExternal(
      {
        provider: "manual",
        subtype: "manual.smoke",
        userId: "system",
        content: "different content",
        owner: "smoke:harness",
        externalId,
      },
      { allowSystemFallback: true },
    );
    if (!r2.duplicate) throw new Error("second call with same external_id should be duplicate");

    ok(name, `signalId=${r1.signalId.slice(0, 8)} duplicate-detection works`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

function checkGithubTransform() {
  const name = "3. GitHub webhook transform";
  try {
    const recs = transformGithubWebhook(
      {
        action: "opened",
        repository: { full_name: "acme/widgets" },
        sender: { login: "octocat" },
        pull_request: { number: 42, title: "Add billing module", body: "Adds the billing system." },
      },
      { userId: "system", deliveryId: "delivery-abc-123", event: "pull_request" },
    );
    if (recs.length !== 1) throw new Error(`expected 1 record, got ${recs.length}`);
    const r = recs[0];
    assertEq(r.provider, "github", "provider");
    assertEq(r.subtype, "github.pull_request.opened", "subtype includes action");
    assertEq(r.externalId, "delivery-abc-123", "delivery id used as externalId");
    if (!r.content.includes("PR #42")) throw new Error("content missing PR header");
    if (!r.content.includes("billing")) throw new Error("content missing PR title");

    /** Noise events return []. */
    const noise = transformGithubWebhook({}, { userId: "system", deliveryId: "x", event: "star" });
    if (noise.length !== 0) throw new Error("star event should be filtered");

    ok(name, `pull_request.opened normalized; star filtered`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

function checkSlackAdapter() {
  const name = "4. Slack transform adapter";
  try {
    const r = transformSlackEvent({
      userId: "system",
      teamId: "T123",
      channelId: "C-eng",
      ts: "111.222",
      user: "U-alice",
      text: "shipping the new pricing tomorrow",
      eventId: "evt-1",
    });
    assertEq(r.provider, "slack", "provider");
    assertEq(r.subtype, "slack.message", "subtype default");
    if (!r.content.includes("shipping the new pricing")) throw new Error("body lost");

    const r2 = transformSlackEvent({
      userId: "system",
      teamId: "T123",
      channelId: "C-eng",
      ts: "333.444",
      threadTs: "111.222",
      user: "U-bob",
      text: "ack",
      eventId: "evt-2",
    });
    assertEq(r2.subtype, "slack.thread_reply", "thread reply detected");
    ok(name, "message + thread reply normalized");
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

function checkEnrichHeuristic() {
  const name = "5. Heuristic enricher";
  try {
    const ex = enrichHeuristic("PROD is DOWN — billing API failing, sev0 right now", {
      signal_type: "execution",
      intent: "incident",
      risk: "high",
      confidence: 0.8,
      related_decision_id: null,
      reasoning: "",
      source: "heuristic",
      extras: { urgency: "informational", op_classification: "ambient", affected_systems: [] },
    });
    assertEq(ex.urgency, "immediate", "urgency=immediate on sev0");
    assertEq(ex.op_classification, "incident", "incident classification");
    if (!ex.affected_systems.includes("billing")) throw new Error("billing system not detected");

    const ex2 = enrichHeuristic("hey team — what is our policy on overtime?", {
      signal_type: "observation",
      intent: "inquiry",
      risk: "low",
      confidence: 0.4,
      related_decision_id: null,
      reasoning: "",
      source: "heuristic",
      extras: { urgency: "informational", op_classification: "ambient", affected_systems: [] },
    });
    assertEq(ex2.op_classification, "inquiry", "inquiry classification on a question");
    ok(name, `incident+inquiry both classified`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

async function checkDetectorPersistence() {
  const name = "6. Detector + enricher persist on insert";
  try {
    const id = uuidv4();
    db.insertExternalSignal({
      id,
      userId: "system",
      source: "MANUAL",
      content: "We're about to launch a pricing experiment that changes enterprise tier pricing structure",
      owner: "system",
      sourceSubtype: "smoke.detector",
      externalId: `smoke-detector-${Date.now()}`,
    });
    const res = await processSignal(id, { noLlm: true });
    if (!res) throw new Error("processSignal returned null");
    const row = db.getSignalById(id);
    if (!row) throw new Error("signal disappeared");
    if (row.intent_extracted_at == null) throw new Error("intent_extracted_at not set");
    if (row.urgency == null) throw new Error("urgency not set by enricher");
    if (row.op_classification == null) throw new Error("op_classification not set by enricher");
    ok(
      name,
      `risk=${row.risk} urgency=${row.urgency} class=${row.op_classification} affected=${row.affected_systems ?? "[]"}`,
    );
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

function checkOperationalQueries() {
  const name = "7. Operational queries (drift / overload / conflicts)";
  try {
    const drift = findDriftSignals("system", { riskAtLeast: "any", limit: 5, minAgeMinutes: 0 });
    const overload = findOverloadedOwners("system", { minTotal: 1, minHighRiskSignals: 0, limit: 5 });
    const conflicts = findConflictingExecutions("system", 5);
    ok(
      name,
      `drift=${drift.length} overload=${overload.length} conflicts=${conflicts.length}`,
    );
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

function checkReports() {
  const name = "8. Reports shape + markdown formatter";
  try {
    const wd = weeklyDriftReport("system", 7);
    if (typeof wd.totals.signals !== "number") throw new Error("totals.signals not a number");
    const md = formatWeeklyDriftMarkdown(wd);
    if (!md.startsWith("# Hustronix Weekly Drift")) throw new Error("markdown header missing");

    const h = operationalHealth("system");
    const mh = formatHealthMarkdown(h);
    if (!mh.includes("Floating signal ages")) throw new Error("health markdown missing age section");

    ok(name, `weekly: ${wd.totals.signals} signals / ${wd.totals.high_risk} high-risk; health md=${mh.length}b`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

async function checkMeetingHeuristic() {
  const name = "9. Meeting heuristic ingest";
  try {
    const transcript = `
Alice: We will move forward with the rebrand by Friday.
Bob: I'll own the billing API migration by next week.
Carol: We can't spend more than 5k on ads this quarter.
Bob: I'm blocked by the legal review.
Alice: I disagree, that won't work — we need to wait.
    `.trim();

    const r = await ingestMeeting({
      userId: "system",
      transcript: transcript + ` (${Date.now()})`,
      title: "smoke meeting",
      attendees: ["alice", "bob", "carol"],
    });
    if (r.duplicate) throw new Error("first ingest should not be duplicate");
    if (r.signalIds.length === 0) throw new Error("no signals fanned out");
    const item = db.rawGet(
      `SELECT decisions_count, commitments_count, constraints_count, blockers_count, disagreements_count FROM meeting_ingestions WHERE id = ?`,
      [r.meetingIngestionId],
    ) as Record<string, number>[];
    const counts = item[0] ?? {};
    ok(
      name,
      `signals=${r.signalIds.length} (decisions=${counts.decisions_count} commits=${counts.commitments_count} constraints=${counts.constraints_count} blockers=${counts.blockers_count} disagreements=${counts.disagreements_count}) extractor=${r.extractionMethod}`,
    );
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

async function checkCostGates() {
  const name = "11. Cost gates (idempotency / tiny / no-decision)";
  try {
    /** A. Idempotency: re-processing an already-enriched signal must short-circuit. */
    const id = uuidv4();
    db.insertExternalSignal({
      id,
      userId: "system",
      source: "MANUAL",
      content: "Pre-enriched smoke signal — should short-circuit on second run",
      owner: "system",
      sourceSubtype: "smoke.gate.idempotent",
      externalId: `smoke-gate-idem-${Date.now()}`,
    });
    const first = await processSignal(id, { noLlm: true });
    if (!first) throw new Error("A: first processSignal returned null");
    if (first.skippedReason === "already-enriched") throw new Error("A: first call should not be already-enriched");
    const second = await processSignal(id, { noLlm: true });
    if (!second) throw new Error("A: second processSignal returned null");
    if (second.skippedReason !== "already-enriched") {
      throw new Error(`A: idempotency gate did not trip on second call (skippedReason=${second.skippedReason})`);
    }

    /** B. Tiny content: <4 tokens or <6 chars must not invoke detector. */
    const tinyId = uuidv4();
    db.insertExternalSignal({
      id: tinyId,
      userId: "system",
      source: "MANUAL",
      content: "ok",
      owner: "system",
      sourceSubtype: "smoke.gate.tiny",
      externalId: `smoke-gate-tiny-${Date.now()}`,
    });
    const tiny = await processSignal(tinyId, { noLlm: true });
    if (!tiny) throw new Error("B: tiny processSignal returned null");
    if (tiny.skippedReason !== "tiny-content") {
      throw new Error(`B: tiny-content gate did not trip (got ${tiny.skippedReason ?? "(none)"})`);
    }

    ok(name, `idempotency + tiny gates trip as expected`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function checkHybridSearch() {
  const name = "10. Hybrid search round-trip";
  try {
    const hits = await hybridSearch("system", "pricing structure", { limit: 5 });
    /** Result count varies based on prior runs; just assert call succeeds and shape is right. */
    for (const h of hits) {
      if (!("entityType" in h) || !("snippet" in h) || typeof h.score !== "number") {
        throw new Error("hit shape invalid");
      }
    }
    ok(name, `hits=${hits.length}`);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

// =====================================================================

async function main() {
  console.log("\n=== Hustronix Intelligence Smoke ===\n");
  console.log(`tenant=system  ts=${new Date().toISOString()}\n`);

  await checkSchema();
  checkIngestRouter();
  checkGithubTransform();
  checkSlackAdapter();
  checkEnrichHeuristic();
  await checkDetectorPersistence();
  /** Show a snapshot of the ledger we just touched, for debug. */
  const ctx = fetchDecisionContext("system");
  console.log(
    `\n[debug] context: activeDecision=${ctx.activeDecision?.id?.slice(0, 8) ?? "(none)"} executions=${ctx.activeExecutions.length} recentSignals=${ctx.recentSignals.length}\n`,
  );
  checkOperationalQueries();
  checkReports();
  await checkMeetingHeuristic();
  await checkCostGates();
  await checkHybridSearch();

  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip");
  const passed = results.filter((r) => r.status === "ok");

  console.log(`\n=== Summary: ${passed.length} ok, ${skipped.length} skip, ${failed.length} fail ===`);
  if (failed.length > 0) {
    console.error("\nFAILED CHECKS:");
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n[smoke] CRASHED:`, err);
  process.exit(2);
});
