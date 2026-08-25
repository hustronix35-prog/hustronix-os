/**
 * Export a founder validation session to a markdown report.
 * Does NOT modify Talk. Pulls session JSON + optional DB traces.
 *
 * Usage: npm run export:founder-session -- <session-id>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recentTalkTraces, talkObservabilitySummary } from "../../apps/api/src/intelligence/talk/talk-observability.js";
import {
  loadFounderSession,
  saveFounderSession,
  syncTracesFromDb,
  type FounderSessionManifest,
  type FounderTurnRecord,
} from "./talk-founder-validation.js";

type FailureClass =
  | "RETRIEVAL"
  | "REASONING"
  | "RESPONSE"
  | "UX"
  | "COMPANY_BRAIN_GAP"
  | "FACTUALITY"
  | "GOVERNANCE"
  | "PERFORMANCE"
  | "EXPECTED_LIMITATION"
  | "TEST_HARNESS";

function classifyTurn(t: FounderTurnRecord): FailureClass | null {
  const a = t.assistant_response || "";
  const q = t.user_message || "";
  if (/\b(DECISION_READY|gateOk|pattern_id|facet coverage)\b/i.test(a)) return "UX";
  if (/\b(our|my)\s+(cac|mrr|arr)\s+(is|=)\s*[₹$€]?\s*[\d,.]+/i.test(a) && /cac|mrr|arr/i.test(q)) {
    return "FACTUALITY";
  }
  if (/don't currently have a reliable|don't have enough company evidence/i.test(a) && /cac|conversion|mrr/i.test(q)) {
    return "COMPANY_BRAIN_GAP";
  }
  if ((t.retrieved_situations?.length || 0) === 0 && /going on|worry|happening/i.test(q) && /don't have enough/i.test(a)) {
    return "RETRIEVAL";
  }
  if (/not decision-ready|won't mint|governance|validation/i.test(a) && /execute|create the decision|option \d/i.test(q)) {
    return "EXPECTED_LIMITATION";
  }
  return null;
}

function escapeMd(s: string): string {
  return String(s || "").replace(/\r\n/g, "\n");
}

function buildReport(manifest: FounderSessionManifest, dbTraces: unknown[]): string {
  const turns = manifest.turns;
  const failures = turns
    .map((t) => ({ turn: t.turn_number, class: classifyTurn(t), q: t.user_message, a: t.assistant_response.slice(0, 200) }))
    .filter((f) => f.class);

  const summary = (() => {
    try {
      return talkObservabilitySummary(manifest.founder_user_id);
    } catch {
      return null;
    }
  })();

  const lines: string[] = [];
  lines.push(`# Founder Validation Report — ${manifest.session_id}`);
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Schema:** ${manifest.schema}`);
  lines.push("");
  lines.push(`## 1. Executive Verdict`);
  lines.push("");
  lines.push(`_Fill after human session + observer log._`);
  lines.push("");
  lines.push(`- Verdict: PASS / PARTIAL / FAIL`);
  lines.push(`- Builder interventions: _(from observer)_`);
  lines.push(`- Help requests: _(from observer)_`);
  lines.push("");
  lines.push(`## 2. Session Metadata`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| session_id | ${manifest.session_id} |`);
  lines.push(`| founder_user_id | ${manifest.founder_user_id} |`);
  lines.push(`| username | ${manifest.username} |`);
  lines.push(`| started_at | ${manifest.started_at || "—"} |`);
  lines.push(`| ended_at | ${manifest.ended_at || "—"} |`);
  lines.push(`| status | ${manifest.status} |`);
  lines.push(`| situations | ${manifest.seed.situations} |`);
  lines.push(`| signals | ${manifest.seed.signals} |`);
  lines.push(`| evidence | ${manifest.seed.evidence} |`);
  lines.push(`| decisions | ${manifest.seed.decisions} |`);
  lines.push(`| dependencies | ${manifest.seed.dependencies} |`);
  lines.push(`| customers | ${manifest.seed.customers.join(", ")} |`);
  lines.push(`| recorded_turns | ${turns.length} |`);
  lines.push(`| db_traces | ${dbTraces.length} |`);
  lines.push("");
  lines.push(`> Password and cookies are **not** included in this report.`);
  lines.push("");
  lines.push(`## 3–4. Exact Conversation Transcript`);
  lines.push("");
  if (!turns.length) {
    lines.push(`_No turns recorded in session JSON._`);
    lines.push(`If the founder used the live UI, sync traces then re-export:`);
    lines.push("");
    lines.push("```bash");
    lines.push(`npm run founder:validation -- --sync=${manifest.session_id}`);
    lines.push(`npm run export:founder-session -- ${manifest.session_id}`);
    lines.push("```");
    lines.push("");
    if (dbTraces.length) {
      lines.push(`### DB traces (raw summary)`);
      lines.push("");
      for (const [i, tr] of (dbTraces as Array<Record<string, unknown>>).entries()) {
        lines.push(`#### Trace ${i + 1}`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(tr, null, 2));
        lines.push("```");
        lines.push("");
      }
    }
  } else {
    for (const t of turns) {
      lines.push(`### Turn ${t.turn_number}`);
      lines.push("");
      lines.push(`**User:** ${escapeMd(t.user_message)}`);
      lines.push("");
      lines.push(`**Assistant:**`);
      lines.push("");
      lines.push(escapeMd(t.assistant_response));
      lines.push("");
      lines.push(
        `| mode | context | intent | path | latency | retrieved_sits | entities | evidence | guard | fallback |`,
      );
      lines.push(`|------|---------|--------|------|---------|----------------|----------|----------|-------|----------|`);
      lines.push(
        `| ${t.mode || "—"} | ${t.context_mode || "—"} | ${t.intent || "—"} | ${t.path || "—"} | ${t.latency_ms ?? "—"} | ${(t.retrieved_situations || []).length} | ${(t.retrieved_entities || []).join(", ") || "—"} | ${t.retrieved_evidence ?? "—"} | ${t.guard_result ?? "—"} | ${t.fallback ?? "—"} |`,
      );
      lines.push("");
      if (t.retrieval_plan) {
        lines.push(`<details><summary>Retrieval plan</summary>`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(t.retrieval_plan, null, 2));
        lines.push("```");
        lines.push("");
        lines.push(`</details>`);
        lines.push("");
      }
    }
  }

  lines.push(`## 5. Trace Summary`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(summary, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`## 6–15. Rubric (fill after human session)`);
  lines.push("");
  lines.push(`| Dimension | Score 0–100 | Notes |`);
  lines.push(`|-----------|-------------|-------|`);
  for (const dim of [
    "First-minute comprehension",
    "Company grounding",
    "Retrieval",
    "Conversational quality",
    "Follow-up continuity",
    "Topic switching",
    "Counterfactual reasoning",
    "Brainstorming",
    "Recommendation quality",
    "Evidence/provenance",
    "Factuality",
    "Governance",
    "Founder independence",
    "Trust",
    "Latency",
  ]) {
    lines.push(`| ${dim} |  |  |`);
  }
  lines.push("");
  lines.push(`## 16–18. Failures (auto-hints from recorded turns)`);
  lines.push("");
  if (!failures.length) {
    lines.push(`No automatic failure hints from recorded turns (or no turns yet).`);
  } else {
    for (const f of failures) {
      lines.push(`- Turn ${f.turn}: **${f.class}** — Q: ${f.q}`);
    }
  }
  lines.push("");
  lines.push(`Primary classes (use exactly one per failure):`);
  lines.push(`RETRIEVAL | REASONING | RESPONSE | UX | COMPANY_BRAIN_GAP | FACTUALITY | GOVERNANCE | PERFORMANCE | EXPECTED_LIMITATION | TEST_HARNESS`);
  lines.push("");
  lines.push(`## 19. Founder Independence`);
  lines.push("");
  lines.push(`- Unprompted turns: _`);
  lines.push(`- Help requests: _`);
  lines.push(`- Builder interventions: _`);
  lines.push("");
  lines.push(`## 20. Final Score`);
  lines.push("");
  lines.push(`_Overall /100 — after human rubric._`);
  lines.push("");
  lines.push(`## 21. Ship Decision`);
  lines.push("");
  lines.push(`SHIP TO DESIGN PARTNERS / HARDEN AND RE-TEST / MAJOR PRODUCT ISSUE`);
  lines.push("");
  lines.push(`## 22. Recommended Next Engineering Work`);
  lines.push("");
  lines.push(`_Only from observed founder failures — not assumptions._`);
  lines.push("");
  lines.push(`## Trust Interview Answers`);
  lines.push("");
  lines.push(`_Paste exact answers from docs/qa/talk-v2-2-founder-validation.md § Trust test._`);
  lines.push("");
  lines.push(`## Observer Log`);
  lines.push("");
  lines.push(`_Attach or paste from docs/qa/founder-validation-observer-log.md_`);
  lines.push("");

  return lines.join("\n");
}

function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("Usage: npm run export:founder-session -- <session-id>");
    process.exit(1);
  }

  let manifest = loadFounderSession(sessionId);
  // Always attempt DB sync for live UI sessions
  try {
    syncTracesFromDb(sessionId);
    manifest = loadFounderSession(sessionId);
  } catch {
    /* continue with file turns */
  }

  const dbTraces =
    ((manifest as FounderSessionManifest & { db_traces?: unknown[] }).db_traces as unknown[]) ||
    recentTalkTraces(manifest.founder_user_id, 100);

  const outDir = join(process.cwd(), "docs", "qa", "founder-validation");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${sessionId}-report.md`);
  const md = buildReport(manifest, dbTraces);
  writeFileSync(outPath, md, "utf8");

  manifest.status = "exported";
  manifest.ended_at = manifest.ended_at || new Date().toISOString();
  // Strip operator password from any accidental copy into docs — keep only in data/
  saveFounderSession(manifest);

  const scorecardPath = join(process.cwd(), "data", "founder-validation", `${sessionId}-scorecard.json`);
  writeFileSync(
    scorecardPath,
    JSON.stringify(
      {
        session_id: sessionId,
        founder_user_id: manifest.founder_user_id,
        recorded_turns: manifest.turns.length,
        db_traces: dbTraces.length,
        seed: manifest.seed,
        verdict: null,
        overall_score: null,
        ship_decision: null,
        note: "Fill after human session. Do not invent scores.",
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(JSON.stringify({ ok: true, report: outPath, scorecard: scorecardPath, turns: manifest.turns.length }, null, 2));
}

main();
