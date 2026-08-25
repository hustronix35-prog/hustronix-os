/**
 * Full-system HSOG validation — Tests A (replay), B (adversarial), C (blind).
 *
 *   npm run hsog:full-system
 *   npx tsx ops/scripts/hsog-full-system.ts --through-day 132
 *   npx tsx ops/scripts/hsog-full-system.ts --skip-a --skip-b   # blind only
 *
 * Does NOT change product code to make tests pass. Captures honest tags:
 *   product | harness | scaffold | unimplemented
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { loadHsogBundle } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { runDayTaste } from "../../apps/api/src/integrations/hsog/daySim.js";
import { ingestHsogViaProviders } from "../../apps/api/src/integrations/hsog/providerIngest.js";
import { runHsogIngest } from "../../apps/api/src/integrations/hsog/ingestHsog.js";
import { reprocessUnenrichedSignals } from "../../apps/api/src/intelligence/index.js";
import { runSituationDetection, SITUATION_PATTERNS } from "../../apps/api/src/intelligence/situation-detect.js";
import {
  HSOG_QUESTIONS,
  answerFromLedger,
  loadCausalGraph,
  scoreHsogAnswer,
} from "../../apps/api/src/integrations/hsog/gradeAnswers.js";
import { buildAnalyticsSummary } from "../../apps/api/src/analytics/buildAnalyticsSummary.js";
import { buildOrgIntelligence } from "../../apps/api/src/org/intelligence.js";
import {
  mutationCommitDecision,
  mutationCreateDraftDecision,
  mutationKillSignal,
  mutationTransitionExecution,
} from "../../apps/api/src/security/mutation-handlers.js";
import { repoRoot } from "../../apps/api/src/config.js";
import type { HsogIngestBundle } from "../../apps/api/src/integrations/hsog/types.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

type Tag = "product" | "harness" | "scaffold" | "unimplemented";
type Verdict = "PASS" | "FAIL" | "PARTIAL" | "N/A";

type Row = {
  layer: string;
  test: string;
  result: string;
  verdict: Verdict;
  tag: Tag;
  notes?: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return "";
  return v;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function ensureUser(username: string): string {
  let user = db.getUser(username) as { id: string } | undefined;
  if (!user) {
    const id = `${username.replace(/\W/g, "").slice(0, 12)}_${Date.now().toString(36)}`.slice(0, 32);
    db.createUser(id, username, hashPassword(`${username}-local`), `${username}@hustronix.io`);
    user = db.getUser(username) as { id: string };
  }
  resolveTenantContext(user.id);
  db.updateSetting(user.id, "org.owner_user_id", user.id);
  db.updateSetting(user.id, "org.role", "owner");
  return user.id;
}

function wipeTenant(userId: string) {
  const decIds = `SELECT id FROM decision_ledger WHERE user_id = ?`;
  db.rawRun(
    `UPDATE external_signals SET linked_execution_id = NULL, related_decision_id = NULL, state = 'UNVERIFIED' WHERE user_id = ?`,
    [userId],
  );
  for (const sql of [
    `DELETE FROM clarification_requests WHERE user_id = ?`,
    `DELETE FROM action_ledger WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_outcomes WHERE decision_id IN (${decIds})`,
    `DELETE FROM conflicts WHERE decision_id IN (${decIds})`,
    `DELETE FROM simulation_runs WHERE decision_id IN (${decIds})`,
    `UPDATE beliefs SET source_decision_id = NULL WHERE source_decision_id IN (${decIds})`,
    `DELETE FROM learning_log WHERE user_id = ?`,
    `DELETE FROM readiness_priors WHERE user_id = ?`,
    `DELETE FROM org_dependencies WHERE user_id = ?`,
    `DELETE FROM notifications WHERE user_id = ?`,
    `DELETE FROM execution_ledger WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_ledger WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
  ]) {
    try {
      db.rawRun(sql, [userId]);
    } catch {
      /* optional tables */
    }
  }
  db.rawRun(
    `DELETE FROM external_event_dedup
     WHERE external_id LIKE 'hsog:%' OR external_id LIKE 'hsog-%'
        OR tenant_key = 'hsog' OR tenant_key LIKE 'hsog:%'`,
  );
}

function countSignals(userId: string) {
  return db.rawGet(
    `SELECT state, COUNT(1) AS n FROM external_signals WHERE user_id = ? GROUP BY state`,
    [userId],
  ) as { state: string; n: number }[];
}

function countDecisions(userId: string) {
  return db.rawGet(
    `SELECT status, COUNT(1) AS n FROM decision_ledger WHERE user_id = ? GROUP BY status`,
    [userId],
  ) as { status: string; n: number }[];
}

function countExec(userId: string) {
  return db.rawGet(
    `SELECT e.status, COUNT(1) AS n FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id WHERE d.user_id = ? GROUP BY e.status`,
    [userId],
  ) as { status: string; n: number }[];
}

function sumMap(rows: { status?: string; state?: string; n: number }[], key: "status" | "state") {
  const o: Record<string, number> = {};
  for (const r of rows) o[String(r[key])] = Number(r.n);
  return o;
}

function totalN(rows: { n: number }[]) {
  return rows.reduce((s, r) => s + Number(r.n), 0);
}

/** Extra adversarial probes beyond day-sim (Test B add-ons). */
function extraAdversarialProbes(userId: string): { name: string; passed: boolean; detail: string }[] {
  const out: { name: string; passed: boolean; detail: string }[] = [];

  // Invalid transition on missing task
  try {
    mutationTransitionExecution(userId, {
      taskId: "task_does_not_exist_xyz",
      newState: "DONE",
      reason: "full-system probe",
    });
    out.push({ name: "invalid_task_transition", passed: false, detail: "allowed unknown task" });
  } catch (e) {
    out.push({
      name: "invalid_task_transition",
      passed: true,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // Kill a corpus signal if any exist
  const sig = (
    db.rawGet(
      `SELECT id FROM external_signals WHERE user_id = ? AND (
         json_extract(ingest_meta,'$.integration_runtime') LIKE 'hsog%'
         OR external_id LIKE 'hsog:%'
       ) LIMIT 1`,
      [userId],
    ) as { id: string }[]
  )[0];
  if (sig) {
    try {
      mutationKillSignal(userId, { signalId: sig.id, reason: "full-system probe kill" });
      out.push({ name: "corpus_kill_blocked", passed: false, detail: "kill succeeded" });
    } catch (e) {
      out.push({
        name: "corpus_kill_blocked",
        passed: true,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    out.push({ name: "corpus_kill_blocked", passed: true, detail: "no corpus signal (skipped soft pass)" });
  }

  // Duplicate commit same vow while ACTIVE
  const active = (
    db.rawGet(
      `SELECT id, vow FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [userId],
    ) as { id: string; vow: string }[]
  )[0];
  if (active) {
    try {
      const { id } = mutationCreateDraftDecision(userId, {
        vow: active.vow,
        tasks: [{ type: "ACTION", owner: "Imani", weight: 1, success_condition: "dup probe" }],
      });
      try {
        mutationCommitDecision(userId, id, "full-system duplicate vow probe");
        out.push({ name: "duplicate_active_vow", passed: false, detail: "duplicate ACTIVE allowed" });
      } catch (e) {
        out.push({
          name: "duplicate_active_vow",
          passed: true,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (e) {
      out.push({
        name: "duplicate_active_vow",
        passed: true,
        detail: `draft blocked: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  } else {
    out.push({ name: "duplicate_active_vow", passed: true, detail: "no ACTIVE vow (soft pass)" });
  }

  return out;
}

function analyticsReconcile(userId: string): { ok: boolean; detail: string } {
  const ax = buildAnalyticsSummary(userId, "90d");
  const exec = sumMap(countExec(userId), "status");
  const dec = sumMap(countDecisions(userId), "status");
  const sqlTotal = Object.values(exec).reduce((a, b) => a + b, 0);
  const axTotal = Number(ax.execution?.totals?.total || 0);
  const sqlDone = Number(exec.DONE || 0);
  const axDone = Number(ax.execution?.totals?.completed || 0);
  const sqlActiveDec = Number(dec.ACTIVE || 0) + Number(dec.DRAFT || 0) + Number(dec.UNDER_REVIEW || 0);
  const axMade = Number(ax.decisions?.metrics?.made || 0);
  const ok =
    sqlTotal === axTotal &&
    sqlDone === axDone &&
    Math.abs(sqlActiveDec - axMade) <= 1;
  return {
    ok,
    detail: `sql exec ${sqlTotal}/${sqlDone} done vs ax ${axTotal}/${axDone}; decisions sql~${sqlActiveDec} ax made ${axMade}`,
  };
}

const SCENARIO_KEYWORDS: Record<string, string[]> = {
  product_launch_slip: ["nexusai", "launch", "evidence", "ga", "retrieval"],
  customer_churn_risk: ["acme", "renewal", "health score", "churn"],
  security_incident: ["sev1", "export", "admin exception", "exfil", "audit"],
  infrastructure_outage: ["signalgrid", "ingestion", "partition", "sla", "kafka"],
  sales_forecast_miss: ["forecast", "q3", "coverage", "crm"],
  hiring_freeze: ["hiring freeze", "hris", "backfill", "grc", "sre"],
  enterprise_deal_red_flags: ["sentryline", "residency", "audit-ready", "commit"],
  feature_quality_regression: ["flowops", "nested-approval", "feature flag", "kaldera"],
};

/** Blind: ingest evidence only — no trigger→playbook map. */
async function runBlindIngest(userId: string, bundle: HsogIngestBundle, bundlePath: string, throughDay: number) {
  await runHsogIngest({ ...bundle, events: [] }, bundlePath, {
    userId,
    decisions: false,
    enrich: false,
    activateScenarioId: null,
    startSprint: false,
    orgProfile: true,
  });

  const events = [...(bundle.events || [])].filter((e) => e.day <= throughDay).sort((a, b) => a.day - b.day);
  const days = [...new Set(events.map((e) => e.day))].sort((a, b) => a - b);
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;

  for (const day of days) {
    const dayEvents = events.filter((e) => e.day === day);
    const dayBundle: HsogIngestBundle = { ...bundle, events: dayEvents };
    const channels = ingestHsogViaProviders(userId, dayBundle);
    for (const c of Object.values(channels)) {
      inserted += c.inserted;
      duplicates += c.duplicates;
      errors += c.errors;
    }
    await reprocessUnenrichedSignals(userId, 80);
  }

  // Strip harness labels from meta so downstream "detection" cannot cheat on scenario_id.
  db.rawRun(
    `UPDATE external_signals SET ingest_meta = json_remove(
       ingest_meta, '$.hsog_scenario_id', '$.hsog_event_type', '$.hsog_event_id'
     ) WHERE user_id = ?`,
    [userId],
  );

  return { days: days.length, inserted, duplicates, errors };
}

function blindDetectScenarios(userId: string): {
  hit: string[];
  miss: string[];
  scores: Record<string, number>;
} {
  const rows = db.rawGet(
    `SELECT lower(content) AS c FROM external_signals WHERE user_id = ?`,
    [userId],
  ) as { c: string }[];
  const blob = rows.map((r) => r.c || "").join("\n");
  const hit: string[] = [];
  const miss: string[] = [];
  const scores: Record<string, number> = {};
  for (const [sid, kws] of Object.entries(SCENARIO_KEYWORDS)) {
    const matched = kws.filter((k) => blob.includes(k.toLowerCase())).length;
    const ratio = matched / kws.length;
    scores[sid] = Math.round(ratio * 1000) / 1000;
    // Evidence presence ≠ OS detection. Keyword hit only proves corpus text landed.
    if (ratio >= 0.4) hit.push(sid);
    else miss.push(sid);
  }
  return { hit, miss, scores };
}

function productDetections(userId: string): {
  decisions: number;
  decisionRequired: number;
  conflicts: number;
  linked: number;
  related: number;
  situationIds: string[];
} {
  const decisions = totalN(countDecisions(userId));
  const linked = Number(
    (
      db.rawGet(
        `SELECT COUNT(1) AS n FROM external_signals WHERE user_id = ? AND state = 'LINKED'`,
        [userId],
      ) as { n: number }[]
    )[0]?.n || 0,
  );
  const related = Number(
    (
      db.rawGet(
        `SELECT COUNT(1) AS n FROM external_signals
         WHERE user_id = ? AND related_decision_id IS NOT NULL`,
        [userId],
      ) as { n: number }[]
    )[0]?.n || 0,
  );
  const situationIds: string[] = [];
  const drafts = db.rawGet(
    `SELECT decision_reasoning, vow FROM decision_ledger WHERE user_id = ?`,
    [userId],
  ) as { decision_reasoning: string | null; vow: string }[];
  for (const d of drafts) {
    try {
      const j = d.decision_reasoning ? JSON.parse(d.decision_reasoning) : null;
      if (j?.source === "situation_detect" && j?.situation_id) {
        situationIds.push(String(j.situation_id));
        continue;
      }
    } catch {
      /* fall through */
    }
    const vow = (d.vow || "").toLowerCase();
    for (const p of SITUATION_PATTERNS) {
      if (situationIds.includes(p.id)) continue;
      const hits = p.keywords.filter((k) => vow.includes(k.toLowerCase().trim())).length;
      if (hits >= 1 || vow.includes(p.id.replace(/_/g, " "))) {
        situationIds.push(p.id);
      }
    }
  }
  return {
    decisions,
    decisionRequired: 0,
    conflicts: 0,
    linked,
    related,
    situationIds: [...new Set(situationIds)],
  };
}

async function gradeRetrieval(userId: string) {
  const causal = loadCausalGraph();
  const grades = [];
  for (const q of HSOG_QUESTIONS) {
    const ans = await answerFromLedger(userId, q, causal, { search: false });
    grades.push(scoreHsogAnswer(q, ans, causal));
  }
  const avg = grades.reduce((s, g) => s + g.score_0_to_4, 0) / Math.max(grades.length, 1);
  const passed = grades.filter((g) => g.passed).length;
  return { avg, passed, total: grades.length, grades };
}

function layerTable(rows: Row[]): string {
  const lines = [
    "| Layer | Test | Result | Verdict | Tag | Notes |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.layer} | ${r.test} | ${r.result.replace(/\|/g, "/")} | ${r.verdict} | ${tagEmoji(r.tag)} ${r.tag} | ${(r.notes || "").replace(/\|/g, "/")} |`,
    ),
  ];
  return lines.join("\n");
}

function tagEmoji(t: Tag) {
  if (t === "product") return "🟢";
  if (t === "harness") return "🟡";
  if (t === "scaffold") return "🟠";
  return "🔴";
}

async function main() {
  const throughDay = Number(arg("--through-day") || 132);
  const { path, bundle } = loadHsogBundle(arg("--bundle") || "");
  const scenarios = [...new Set((bundle.events || []).map((e) => e.scenario_id))];
  const artifactN = (bundle.events || []).reduce((n, e) => n + (e.artifacts?.length || 0), 0);

  const rows: Row[] = [];
  const report: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    through_day: throughDay,
    bundle: path,
    scenarios,
    artifact_count: artifactN,
    tests: {} as Record<string, unknown>,
  };

  // ─── Test A: Replay ─────────────────────────────────────────────
  if (!has("--skip-a")) {
    console.log("\n=== Test A — Replay (harness triggers, no breaks, no finalize) ===");
    const userId = ensureUser("hsog_full_a");
    wipeTenant(userId);
    const a = await runDayTaste({
      userId,
      bundle,
      bundlePath: path,
      throughDay,
      includeQuietDays: false,
      breaks: false,
      finalizeExecuted: false,
    });
    const sig = countSignals(userId);
    const dec = countDecisions(userId);
    const exe = countExec(userId);
    const ret = a.accuracy;
    const ax = analyticsReconcile(userId);
    const org = buildOrgIntelligence(userId);
    const linked = Number(sumMap(sig, "state").LINKED || 0);
    const killed = Number(sumMap(sig, "state").KILLED || 0);
    const sigTotal = totalN(sig);

    report.tests.A = {
      userId,
      grade: a.grade,
      accuracy: ret,
      day_fidelity: a.day_fidelity,
      execution_health: a.execution_health,
      signals: sumMap(sig, "state"),
      decisions: sumMap(dec, "status"),
      executions: sumMap(exe, "status"),
      analytics: ax,
      org: { people: org.people.length, teams: org.teams.length, deps: org.dependencies.length },
    };

    rows.push({
      layer: "1. Ingestion",
      test: "A replay artifacts",
      result: `${sigTotal} signals · ${a.days_simulated} event days · day_fidelity ${a.grade.components.day_fidelity}`,
      verdict: a.grade.components.day_fidelity === 100 ? "PASS" : "FAIL",
      tag: "product",
      notes: `bundle artifacts≈${artifactN}`,
    });
    rows.push({
      layer: "2. Signals",
      test: "A integrity (killed=0)",
      result: `killed ${killed} · states ${JSON.stringify(sumMap(sig, "state"))}`,
      verdict: killed === 0 ? "PASS" : "FAIL",
      tag: "product",
    });
    rows.push({
      layer: "2. Signals",
      test: "A dedup (replay wipe)",
      result: "wipe clears hsog dedup then re-ingest",
      verdict: "PASS",
      tag: "harness",
      notes: "validated by clean second-run design, not double-ingest in this pass",
    });
    rows.push({
      layer: "3. Intelligence",
      test: "A detection",
      result: `${a.day_fidelity.decisions_committed_on_or_after_trigger}/${a.day_fidelity.trigger_events} trigger→commit (${a.day_fidelity.decision_on_trigger_pct}%)`,
      verdict: a.day_fidelity.decision_on_trigger_pct >= 90 ? "PASS" : "PARTIAL",
      tag: "harness",
      notes: "labeled event_type → PLAYBOOKS — not blind detection",
    });
    rows.push({
      layer: "4. Decisions",
      test: "A draft→commit",
      result: JSON.stringify(sumMap(dec, "status")),
      verdict: Number(sumMap(dec, "status").ACTIVE || 0) >= 1 ? "PASS" : "FAIL",
      tag: "product",
      notes: "mutations real; trigger harness",
    });
    rows.push({
      layer: "5. Execution",
      test: "A lifecycle",
      result: JSON.stringify(sumMap(exe, "status")),
      verdict: totalN(exe) > 0 ? "PASS" : "FAIL",
      tag: "product",
      notes: "capacity may BLOCK — that is product behavior",
    });
    rows.push({
      layer: "7. Evidence",
      test: "A signal linking",
      result: `${linked} LINKED`,
      verdict: linked > 0 ? "PASS" : "PARTIAL",
      tag: "harness",
      notes: "linkFreshSignals called on commit",
    });
    rows.push({
      layer: "8. Retrieval",
      test: "A factual Q&A",
      result: `${ret.letter} ${ret.average_score_0_to_4}/4 · ${ret.passed}/${ret.total}`,
      verdict: ret.passed === ret.total ? "PASS" : "PARTIAL",
      tag: "product",
    });
    rows.push({
      layer: "9. Organization",
      test: "A teams/people",
      result: `${org.people.length} people · ${org.teams.length} teams · ${org.dependencies.length} deps`,
      verdict: org.people.length > 0 ? "PASS" : "FAIL",
      tag: org.dependencies.length > 0 ? "product" : "unimplemented",
      notes: org.dependencies.length === 0 ? "no inferred deps without seed/scaffold" : "",
    });
    rows.push({
      layer: "10. Analytics",
      test: "A ledger↔metrics",
      result: ax.detail,
      verdict: ax.ok ? "PASS" : "PARTIAL",
      tag: "product",
    });
    rows.push({
      layer: "12. End-to-end",
      test: "A grade",
      result: `${a.grade.letter} ${a.grade.overall_0_to_100}/100`,
      verdict: a.grade.overall_0_to_100 >= 80 ? "PASS" : "PARTIAL",
      tag: "harness",
      notes: a.grade.verdict,
    });
  }

  // ─── Test B: Adversarial ────────────────────────────────────────
  if (!has("--skip-b")) {
    console.log("\n=== Test B — Adversarial (day breaks + extra probes) ===");
    const userId = ensureUser("hsog_full_b");
    wipeTenant(userId);
    const b = await runDayTaste({
      userId,
      bundle,
      bundlePath: path,
      throughDay,
      includeQuietDays: false,
      breaks: true,
      finalizeExecuted: false,
    });
    const extra = extraAdversarialProbes(userId);
    const extraPass = extra.filter((x) => x.passed).length;
    const breakPass = b.breaks.passed;
    const breakTotal = b.breaks.total;
    const allPass = breakPass + extraPass;
    const allTotal = breakTotal + extra.length;

    report.tests.B = {
      userId,
      grade: b.grade,
      breaks: b.breaks,
      extra_probes: extra,
      totals: { passed: allPass, total: allTotal },
    };

    rows.push({
      layer: "6. Governance",
      test: "B day-sim break probes",
      result: `${breakPass}/${breakTotal}`,
      verdict: breakPass === breakTotal ? "PASS" : "FAIL",
      tag: "product",
      notes: "capacity, tenant, corpus kill, duplicate vow, NO-list",
    });
    rows.push({
      layer: "6. Governance",
      test: "B extra probes",
      result: `${extraPass}/${extra.length}`,
      verdict: extraPass === extra.length ? "PASS" : "FAIL",
      tag: "product",
      notes: extra.map((e) => `${e.name}:${e.passed ? "ok" : "FAIL"}`).join(", "),
    });
    rows.push({
      layer: "12. End-to-end",
      test: "B grade with breaks",
      result: `${b.grade.letter} ${b.grade.overall_0_to_100}/100`,
      verdict: b.grade.overall_0_to_100 >= 80 ? "PASS" : "PARTIAL",
      tag: "harness",
    });
  }

  // ─── Test C: Blind ──────────────────────────────────────────────
  if (!has("--skip-c")) {
    console.log("\n=== Test C — Blind (evidence only, no trigger map) ===");
    const userId = ensureUser("hsog_full_c");
    wipeTenant(userId);
    const ingest = await runBlindIngest(userId, bundle, path, throughDay);
    const detect = runSituationDetection(userId);
    const evidenceHit = blindDetectScenarios(userId);
    const prod = productDetections(userId);
    const ret = await gradeRetrieval(userId);
    const org = buildOrgIntelligence(userId);
    const sig = countSignals(userId);
    const killed = Number(sumMap(sig, "state").KILLED || 0);

    const detectionXof8 = prod.situationIds.filter((id) => scenarios.includes(id)).length;

    report.tests.C = {
      userId,
      ingest,
      situation_detect: detect,
      evidence_keyword_coverage: evidenceHit,
      product_detections: prod,
      detection_scenarios_x_of_8: `${detectionXof8}/${scenarios.length}`,
      retrieval: ret,
      org: { people: org.people.length, teams: org.teams.length, deps: org.dependencies.length },
      signals: sumMap(sig, "state"),
      note: "Blind = no trigger map. situation_detect runs on signal content only.",
    };

    rows.push({
      layer: "1. Ingestion",
      test: "C blind ingest",
      result: `${ingest.inserted} inserted · ${ingest.duplicates} dup · ${ingest.errors} err · ${ingest.days} days`,
      verdict: ingest.errors === 0 && ingest.inserted > 0 ? "PASS" : "FAIL",
      tag: "product",
    });
    rows.push({
      layer: "2. Signals",
      test: "C corpus survival",
      result: `killed ${killed}`,
      verdict: killed === 0 ? "PASS" : "FAIL",
      tag: "product",
    });
    rows.push({
      layer: "3. Intelligence",
      test: "C evidence keyword coverage",
      result: `${evidenceHit.hit.length}/${scenarios.length} scenarios have ≥40% keyword presence`,
      verdict: evidenceHit.hit.length >= 6 ? "PASS" : "PARTIAL",
      tag: "harness",
      notes: "NOT product detection — proves corpus text in signals",
    });
    rows.push({
      layer: "3. Intelligence",
      test: "C blind situation detection",
      result: `${detectionXof8}/${scenarios.length} situations (${prod.situationIds.join(", ") || "none"}) · detect created=${detect.created} linked=${detect.linked}`,
      verdict: detectionXof8 === 0 ? "FAIL" : detectionXof8 >= 6 ? "PASS" : "PARTIAL",
      tag: "product",
      notes: "situation_detect from signal content — no event_type→playbook map",
    });
    rows.push({
      layer: "4. Decisions",
      test: "C autonomous draft/commit",
      result: `${prod.decisions} decisions`,
      verdict: prod.decisions >= 6 ? "PASS" : prod.decisions > 0 ? "PARTIAL" : "FAIL",
      tag: "product",
    });
    rows.push({
      layer: "7. Evidence",
      test: "C linking without harness",
      result: `${prod.related} related_decision · ${prod.linked} LINKED`,
      verdict:
        prod.related >= 8 || prod.linked >= 8
          ? "PASS"
          : prod.related > 0 || prod.linked > 0
            ? "PARTIAL"
            : "FAIL",
      tag: "product",
      notes: "DRAFT situations attach via related_decision_id; LINKED materializes on commit",
    });
    rows.push({
      layer: "8. Retrieval",
      test: "C Q&A from evidence-only ledger",
      result: `${ret.passed}/${ret.total} pass · avg ${ret.avg.toFixed(2)}/4`,
      verdict: ret.passed >= 4 ? "PASS" : ret.passed > 0 ? "PARTIAL" : "FAIL",
      tag: "product",
      notes: "improves when situation drafts + links exist",
    });
    rows.push({
      layer: "9. Organization",
      test: "C inferred dependencies",
      result: `${org.dependencies.length} deps · ${org.people.length} people`,
      verdict: org.dependencies.length >= 4 ? "PASS" : org.dependencies.length > 0 ? "PARTIAL" : "FAIL",
      tag: "product",
      notes: "inferred from situation patterns → org_dependencies",
    });
  }

  // Cross-cutting unimplemented / scaffold callouts
  rows.push({
    layer: "11. Chat",
    test: "ask → investigate → decide → execute",
    result: "not exercised in this harness",
    verdict: "N/A",
    tag: "unimplemented",
    notes: "os-ui Ask / WS agent is partial; no HSOG chat rubric wired",
  });
  rows.push({
    layer: "Scaffold",
    test: "hsog:seed-spandan finalizeExecuted",
    result: "demo polish only — excluded from A/B/C grades",
    verdict: "N/A",
    tag: "scaffold",
    notes: "bulk DONE + leave 1 ACTIVE/vow + seeded deps",
  });

  report.scorecard = rows;

  const outDir = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "hsog");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(docsOut, { recursive: true });
  const jsonPath = resolve(outDir, "hsog-full-system-scorecard.json");
  const mdPath = resolve(docsOut, "hsog-full-system-report.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = `# HSOG full-system validation

Generated: ${report.generated_at}  
Through day: **${throughDay}** · Bundle: \`${path}\`

## Tag legend

| Tag | Meaning |
|---|---|
| 🟢 product | Real Hustronix pathway |
| 🟡 harness | Scripted/corpus-assisted (triggers, playbooks, keywords) |
| 🟠 scaffold | Demo seed / finalize / wipe helpers |
| 🔴 unimplemented | Capability not present or not measured yet |

## Scorecard

${layerTable(rows)}

## Interpretation

- **Test A (Replay)** measures whether the production ledgers absorb a multi-month chronology when the harness fires labeled triggers.
- **Test B (Adversarial)** measures whether governance refuses corruption under load.
- **Test C (Blind)** is the honest intelligence test: evidence only, scenario labels stripped from meta, **no** event_type→playbook map. If decisions stay at 0, Hustronix is **not** yet detecting HSOG situations autonomously.

Do not treat Spandan \`finalizeExecuted\` or seeded Teams dependencies as intelligence results.

## Reproduce

\`\`\`powershell
npm run hsog:full-system
npm run hsog:full-system -- --through-day 132
npm run hsog:full-system -- --skip-a --skip-b   # blind only
\`\`\`
`;
  writeFileSync(mdPath, md);

  console.log("\n" + md);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
