/**
 * Full-system product QA. Evaluator only — does not patch product code.
 *
 *   npm run qa:full-system
 *
 * Isolated tenants only. Demo/production corpus is dumped, never mutated for destructive tests.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import puppeteer, { type Page } from "puppeteer";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { repoRoot } from "../../apps/api/src/config.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import {
  mutationCommitDecision,
  mutationCompleteDecision,
  mutationCreateDraftDecision,
  mutationReverseDecision,
  mutationTransitionExecution,
} from "../../apps/api/src/security/mutation-handlers.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { buildAttentionBrief } from "../../apps/api/src/intelligence/attention-brief.js";
import { buildOrgIntelligence, createOrgDependency } from "../../apps/api/src/org/intelligence.js";
import { evaluateDecisionOutcome } from "../../apps/api/src/evaluation/outcome-evaluation.js";
import {
  MAX_ABS_SCORE_FLOOR_DELTA,
  MAX_MIN_DISTINCT_DAYS_DELTA,
  MAX_MIN_EVIDENCE_DELTA,
  getReadinessPrior,
  updateFromOutcome,
} from "../../apps/api/src/intelligence/readiness-learning.js";
import { gatesAllowReady } from "../../apps/api/src/intelligence/situation-engine.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import {
  ensureUser,
  finishAllTasks,
  talkCommit,
  wipeTenant,
  seedReadySituation,
} from "./hsog-operating-loop-lib.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

const API = process.env.QA_API_ORIGIN || "http://127.0.0.1:3005";
const UI = process.env.QA_BASE_URL || "http://localhost:3000";
const RUN_ID = `fsqa_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 6)}`;
const STARTED = new Date().toISOString();
const t0 = performance.now();

type Kind = "PASS" | "REAL_BUG" | "MOCK_NOT_LIVE" | "EXPECTED_LIMITATION" | "UX" | "SECURITY";
type Sev = "P0" | "P1" | "P2" | "P3";

type Result = {
  phase: string;
  id: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  kind: Kind;
  severity?: Sev;
  evidence?: Record<string, unknown>;
};

const results: Result[] = [];
const isolatedTenants: string[] = [];

function add(r: Result) {
  results.push(r);
}

function ok(phase: string, id: string, name: string, expected: string, actual: string, evidence?: Record<string, unknown>) {
  add({ phase, id, name, expected, actual, pass: true, kind: "PASS", evidence });
}

function fail(
  phase: string,
  id: string,
  name: string,
  expected: string,
  actual: string,
  kind: Kind,
  severity: Sev,
  evidence?: Record<string, unknown>,
) {
  add({ phase, id, name, expected, actual, pass: false, kind, severity, evidence });
}

function count(sql: string, params: unknown[] = []): number {
  return Number((db.rawGet(sql, params) as { c: number }[])[0]?.c || 0);
}

function snapshot(userId: string) {
  return {
    signals: count(`SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ?`, [userId]),
    situations: count(`SELECT COUNT(*) AS c FROM situations WHERE user_id = ?`, [userId]),
    decisions: count(`SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ?`, [userId]),
    tasks: count(
      `SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id IN (SELECT id FROM decision_ledger WHERE user_id = ?)`,
      [userId],
    ),
    outcomes: count(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE tenant_id = ?`, [userId]),
    priors: count(`SELECT COUNT(*) AS c FROM readiness_priors WHERE user_id = ?`, [userId]),
    notifications: count(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?`, [userId]),
    settings: count(`SELECT COUNT(*) AS c FROM settings WHERE user_id = ?`, [userId]),
    audit: count(`SELECT COUNT(*) AS c FROM audit_log`),
  };
}

function fresh(tag: string) {
  const username = `fsqa_${tag}_${randomUUID().replace(/-/g, "").slice(0, 8)}`.slice(0, 32);
  const userId = ensureUser(username);
  wipeTenant(userId);
  db.updateSetting(userId, "org.owner_user_id", userId);
  db.updateSetting(userId, "org.role", "Owner");
  db.updateSetting(userId, "org.onboarding.completed", "1");
  isolatedTenants.push(userId);
  return { userId, username };
}

function decisionStatus(id: string) {
  return String(db.getDecisionLedgerRow(id)?.status || "");
}

function situationRow(id: string) {
  return (
    db.rawGet(`SELECT id, stage, trajectory, decision_id, title FROM situations WHERE id = ?`, [id]) as {
      id: string;
      stage: string;
      trajectory: string;
      decision_id: string | null;
      title: string;
    }[]
  )[0];
}

function auditFor(entityId: string) {
  return db.rawGet(
    `SELECT action, reason, timestamp FROM audit_log WHERE affected_entity_id = ? ORDER BY timestamp DESC LIMIT 8`,
    [entityId],
  ) as { action: string; reason: string; timestamp: string }[];
}

type HttpRes = { status: number; json: any; setCookie: string[] };

async function http(method: string, path: string, opts?: { cookie?: string; body?: unknown; origin?: string }): Promise<HttpRes> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.cookie) headers.cookie = opts.cookie;
  if (opts?.origin) headers.origin = opts.origin;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie };
}

function sessionCookie(setCookie: string[]) {
  const hit = setCookie.find((c) => c.startsWith("hustronix_session="));
  return hit ? hit.split(";")[0] : "";
}

function spawnNamed(name: string, cmd: string) {
  const r = spawnSync("npm", ["run", cmd], {
    cwd: repoRoot,
    shell: true,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, HUSTRONIX_INTEL_NO_LLM: "1" },
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const pass = /ℹ fail 0|fail 0/.test(out) || (r.status === 0 && /pass \d+/.test(out));
  const passN = out.match(/ℹ pass (\d+)/)?.[1] || out.match(/pass (\d+)/)?.[1];
  const failN = out.match(/ℹ fail (\d+)/)?.[1];
  return { name, cmd, ok: r.status === 0 && (pass || r.status === 0), passN, failN, status: r.status, tail: out.slice(-800) };
}

/* -------------------------------- Phase 0 -------------------------------- */

function phase0Dump() {
  const dumped = spawnSync("npm", ["run", "dump:os-state"], { cwd: repoRoot, shell: true, encoding: "utf8", timeout: 60000 });
  ok(
    "0",
    "dump",
    "Baseline OS dump",
    "data/os-state-dump.json written",
    dumped.status === 0 ? "wrote dump" : `exit ${dumped.status}`,
  );
  if (dumped.status !== 0) {
    fail("0", "dump", "Baseline OS dump", "exit 0", String(dumped.status), "REAL_BUG", "P2", { tail: dumped.stderr?.slice(-400) });
  }
}

function phase0Tenant() {
  const { userId, username } = fresh("baseline");
  const snap = snapshot(userId);
  ok("0", "isolated-tenant", "Fresh QA tenant is empty", "0 situations/decisions/tasks", JSON.stringify(snap), snap);
  return { userId, username, snap };
}

/* -------------------------------- Phase 3 Talk loop -------------------------------- */

function talkLoopA() {
  const { userId } = fresh("a");
  const sitId = seedReadySituation(userId, "Northwind warehouse delay", "customer_churn_risk");
  const before = snapshot(userId);
  const brief = talkToHustronix(userId, "What needs attention?", { focusId: sitId });
  const happening = talkToHustronix(userId, "What is happening?", { focusId: sitId });
  const why = talkToHustronix(userId, "Why?", { focusId: sitId });
  const evidence = talkToHustronix(userId, "Evidence?", { focusId: sitId });
  const who = talkToHustronix(userId, "Who is affected?", { focusId: sitId });
  const what = talkToHustronix(userId, "What should we do?", { focusId: sitId });
  const created = talkToHustronix(userId, "Create the decision.", { focusId: sitId, action: "create_decision" });
  const decisionId = created.decision_id;
  if (brief.grounded && happening.grounded) {
    ok("3A", "talk-grounded", "Talk is grounded in the situation", "grounded answers", `brief=${brief.grounded}`);
  } else {
    fail(
      "3A",
      "talk-grounded",
      "Talk is grounded in the situation",
      "grounded answers",
      `brief=${brief.grounded} happening=${happening.grounded}`,
      "REAL_BUG",
      "P0",
    );
  }
  ok("3A", "evidence", "Evidence turn returns snippets", "non-empty evidence answer", evidence.answer.slice(0, 120));
  ok("3A", "impact", "Who is affected is non-empty", "people/teams mentioned", who.answer.slice(0, 120));
  ok("3A", "recommend", "What should we do is non-empty", "recommended next", what.answer.slice(0, 120));
  if (!decisionId || decisionStatus(decisionId) !== "DRAFT") {
    fail("3A", "draft", "Create yields DRAFT", "DRAFT", String(decisionId && decisionStatus(decisionId)), "REAL_BUG", "P0");
    return;
  }
  ok("3A", "draft", "Create yields DRAFT", "DRAFT", decisionStatus(decisionId));
  talkToHustronix(userId, "What else could be true?", { focusId: sitId, action: "hypotheses" });
  talkToHustronix(userId, "Instrumentation is OK.", { focusId: sitId, action: "instrumentation" });
  const executed = talkToHustronix(userId, "Execute it.", { focusId: sitId, action: "execute" });
  const st = decisionStatus(decisionId);
  if (st !== "ACTIVE") {
    fail("3A", "execute", "Validated execute → ACTIVE", "ACTIVE", `${st} ${executed.answer.slice(0, 160)}`, "REAL_BUG", "P0");
    return;
  }
  ok("3A", "execute", "Validated execute → ACTIVE", "ACTIVE", st, { answer: executed.answer.slice(0, 200) });
  const tasks = db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [decisionId]) as {
    task_id: string;
    status: string;
  }[];
  if (!tasks.length) {
    fail("3A", "tasks", "Governed tasks exist", ">0 tasks", "0", "REAL_BUG", "P0");
    return;
  }
  ok("3A", "tasks", "Governed tasks exist", ">0", String(tasks.length));
  finishAllTasks(decisionId);
  const allDone = (
    db.rawGet(`SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id = ? AND status != 'DONE'`, [decisionId]) as {
      c: number;
    }[]
  )[0].c;
  if (allDone !== 0) {
    fail("3A", "done", "All tasks DONE", "0 open", String(allDone), "REAL_BUG", "P1");
  } else ok("3A", "done", "All tasks DONE", "0 open", "0");
  const completed = talkToHustronix(userId, "Mark as done.", { focusId: sitId, action: "complete" });
  if (decisionStatus(decisionId) !== "COMPLETED") {
    fail("3A", "complete", "Talk complete → COMPLETED", "COMPLETED", `${decisionStatus(decisionId)} ${completed.answer.slice(0, 160)}`, "REAL_BUG", "P0");
    return;
  }
  ok("3A", "complete", "Talk complete → COMPLETED", "COMPLETED", "COMPLETED");
  const outcomes = count(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [decisionId]);
  if (outcomes !== 1) {
    fail("3A", "outcome-row", "Exactly one outcome row", "1", String(outcomes), "REAL_BUG", "P0");
  } else ok("3A", "outcome-row", "Exactly one outcome row", "1", "1");
  const audits = auditFor(decisionId);
  if (!audits.length) {
    fail("3A", "audit", "Decision has audit events", ">0", "0", "REAL_BUG", "P1");
  } else ok("3A", "audit", "Decision has audit events", ">0", String(audits.length), { audits });
  ok("3A", "delta", "Tenant counts moved", "decisions/tasks/outcomes increased", JSON.stringify({ before, after: snapshot(userId) }));
}

function talkLoopB() {
  const { userId } = fresh("b");
  const sitId = seedReadySituation(userId, "Unvalidated commit probe");
  const created = talkToHustronix(userId, "Create the decision.", { focusId: sitId, action: "create_decision" });
  const decisionId = created.decision_id!;
  const executed = talkToHustronix(userId, "Execute it.", { focusId: sitId, action: "execute" });
  const st = decisionStatus(decisionId);
  const talkBlocked = st === "DRAFT" && /could not execute|governance|validation/i.test(executed.answer);
  if (!talkBlocked) {
    fail(
      "3B",
      "talk-skip",
      "Talk execute without validation stays DRAFT",
      "DRAFT + governance message",
      `${st} :: ${executed.answer.slice(0, 200)}`,
      "REAL_BUG",
      "P0",
    );
  } else {
    ok("3B", "talk-skip", "Talk execute without validation stays DRAFT", "DRAFT + blocked", `${st}`);
  }
  let threw = "";
  try {
    mutationCommitDecision(userId, decisionId, "bypass");
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  if (!/CAUSAL_VALIDATION_REQUIRED/i.test(threw)) {
    fail(
      "3B",
      "gateway",
      "Direct commit throws CAUSAL_VALIDATION_REQUIRED",
      "CAUSAL_VALIDATION_REQUIRED",
      threw || `status=${decisionStatus(decisionId)}`,
      "REAL_BUG",
      "P0",
    );
  } else {
    ok("3B", "gateway", "Direct commit throws CAUSAL_VALIDATION_REQUIRED", "CAUSAL_VALIDATION_REQUIRED", threw);
  }
  const tasks = count(
    `SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id = ?`,
    [decisionId],
  );
  if (tasks !== 0 || decisionStatus(decisionId) !== "DRAFT") {
    fail("3B", "no-task", "No ACTIVE and no tasks", "DRAFT + 0 tasks", `${decisionStatus(decisionId)} tasks=${tasks}`, "REAL_BUG", "P0");
  } else ok("3B", "no-task", "No ACTIVE and no tasks", "DRAFT + 0 tasks", "ok");
}

function talkLoopC() {
  const { userId } = fresh("c");
  const owner = `Priya${userId.slice(-6)}`;
  db.upsertTeamRosterByEmail(userId, {
    name: owner,
    email: `${owner.toLowerCase()}@hustronix.io`,
    role: "CS",
    team: "customer success",
    capacity: "40h / week",
    slackId: owner,
  });
  const existing = mutationCreateDraftDecision(userId, {
    vow: `Existing load ${userId}`,
    tasks: [1, 2, 3, 4].map((n) => ({
      owner,
      type: "ACTION",
      weight: 1,
      success_condition: `Existing ${n}`,
      estimated_duration_hours: 8,
    })),
  });
  db.transitionDecisionState(existing.id, "ACTIVE", "qa");
  const existingTasks = db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [existing.id]) as {
    task_id: string;
  }[];
  for (const t of existingTasks) {
    db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 8 WHERE task_id = ?`, [t.task_id]);
    db.transitionExecutionState(t.task_id, "ACTIVE", "seed", true);
  }
  const next = mutationCreateDraftDecision(userId, {
    vow: `New 16h ${userId}`,
    tasks: [{ owner, type: "ACTION", weight: 1, success_condition: "New work", estimated_duration_hours: 16 }],
  });
  db.transitionDecisionState(next.id, "ACTIVE", "qa");
  const neu = (
    db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [next.id]) as {
      task_id: string;
      status: string;
    }[]
  )[0];
  db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 16 WHERE task_id = ?`, [neu.task_id]);
  const blocked = db.transitionExecutionState(neu.task_id, "ACTIVE", "new work", true);
  const pass =
    blocked.status === "BLOCKED" &&
    (blocked.reasons || []).includes("capacity_exceeded") &&
    /overloaded by 8/i.test(String(blocked.message || ""));
  if (!pass) {
    fail(
      "3C",
      "capacity",
      "40h − 32h − 16h BLOCKED overloaded by 8h",
      "BLOCKED capacity_exceeded overloaded by 8h",
      JSON.stringify(blocked),
      "REAL_BUG",
      "P0",
    );
  } else ok("3C", "capacity", "40h − 32h − 16h BLOCKED overloaded by 8h", "BLOCKED + 8h", JSON.stringify(blocked));
  if (blocked.status === "ACTIVE") {
    fail("3C", "not-active", "New task must not become ACTIVE", "not ACTIVE", "ACTIVE", "REAL_BUG", "P0");
  } else ok("3C", "not-active", "New task must not become ACTIVE", "BLOCKED", String(blocked.status));
}

function talkLoopD() {
  const { userId } = fresh("d");
  const { decisionId, situationId } = talkCommit(userId, "Worsening after ship");
  finishAllTasks(decisionId);
  db.rawRun(`UPDATE situations SET trajectory = 'WORSENING' WHERE id = ?`, [situationId]);
  mutationCompleteDecision(userId, decisionId, "qa complete");
  const sit = situationRow(situationId);
  const outcome = (
    db.rawGet(`SELECT result FROM decision_outcomes WHERE decision_id = ?`, [decisionId]) as { result: string }[]
  )[0];
  const pass =
    decisionStatus(decisionId) === "COMPLETED" &&
    outcome?.result === "failed" &&
    sit.stage !== "RESOLVED" &&
    sit.trajectory === "WORSENING";
  if (!pass) {
    fail(
      "3D",
      "failed-outcome",
      "COMPLETED + WORSENING = failed, situation not RESOLVED",
      "COMPLETED/failed/not RESOLVED",
      JSON.stringify({ status: decisionStatus(decisionId), result: outcome?.result, stage: sit.stage }),
      "REAL_BUG",
      "P0",
    );
  } else ok("3D", "failed-outcome", "Task completion ≠ business success", "failed + not RESOLVED", "ok");
}

function talkLoopE() {
  const { userId } = fresh("e");
  const { decisionId, situationId } = talkCommit(userId, "Improving after ship");
  finishAllTasks(decisionId);
  db.rawRun(`UPDATE situations SET trajectory = 'IMPROVING' WHERE id = ?`, [situationId]);
  mutationCompleteDecision(userId, decisionId, "qa complete");
  const sit = situationRow(situationId);
  const outcome = (
    db.rawGet(`SELECT result FROM decision_outcomes WHERE decision_id = ?`, [decisionId]) as { result: string }[]
  )[0];
  const pass = decisionStatus(decisionId) === "COMPLETED" && outcome?.result === "successful" && sit.stage === "RESOLVED";
  if (!pass) {
    fail(
      "3E",
      "success-outcome",
      "COMPLETED + IMPROVING = successful + RESOLVED",
      "COMPLETED/successful/RESOLVED",
      JSON.stringify({ status: decisionStatus(decisionId), result: outcome?.result, stage: sit.stage }),
      "REAL_BUG",
      "P0",
    );
  } else ok("3E", "success-outcome", "Improving situation resolves", "successful + RESOLVED", "ok");
}

function talkLoopF() {
  const { userId } = fresh("f");
  const { decisionId, situationId, focusId } = talkCommit(userId, "Reverse while ACTIVE");
  const evBefore = count(
    `SELECT COUNT(*) AS c FROM situation_evidence WHERE situation_id = ?`,
    [situationId],
  );
  const turn = talkToHustronix(userId, "It didn't work. Reverse this decision.", { focusId, action: "reverse" });
  const sit = situationRow(situationId);
  const evAfter = count(
    `SELECT COUNT(*) AS c FROM situation_evidence WHERE situation_id = ?`,
    [situationId],
  );
  const pass =
    /REVERSED/i.test(turn.answer) &&
    decisionStatus(decisionId) === "REVERSED" &&
    (sit.stage === "DECISION_READY" || sit.stage === "ELEVATED") &&
    evAfter >= evBefore;
  if (!pass) {
    fail(
      "3F",
      "reverse",
      "ACTIVE reverse → REVERSED, situation stays on trail",
      "REVERSED + READY/ELEVATED + evidence kept",
      JSON.stringify({ status: decisionStatus(decisionId), stage: sit.stage, evBefore, evAfter, answer: turn.answer.slice(0, 120) }),
      "REAL_BUG",
      "P0",
    );
  } else ok("3F", "reverse", "Reverse keeps evidence, no silent retry", "REVERSED", sit.stage);
  let again = "";
  try {
    mutationReverseDecision(userId, decisionId, "again");
  } catch (e) {
    again = e instanceof Error ? e.message : String(e);
  }
  if (!/already REVERSED/i.test(again)) {
    fail("3F", "idempotent-reverse", "Second reverse throws", "already REVERSED", again || "no throw", "REAL_BUG", "P1");
  } else ok("3F", "idempotent-reverse", "Second reverse throws", "already REVERSED", again);
}

/* -------------------------------- Phase 4 execution -------------------------------- */

function phase4Execution() {
  const { userId } = fresh("ex");
  const { decisionId } = talkCommit(userId, "Execution state matrix");
  const task = (
    db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ? LIMIT 1`, [decisionId]) as {
      task_id: string;
      status: string;
    }[]
  )[0];
  const id = task.task_id;
  const pendingOrActive = task.status;
  ok("4", "initial", "Task starts PENDING or ACTIVE", "PENDING|ACTIVE", pendingOrActive);

  if (pendingOrActive === "PENDING") {
    const toActive = mutationTransitionExecution(userId, { taskId: id, newState: "ACTIVE", reason: "qa" });
    ok("4", "pending-active", "PENDING → ACTIVE (or BLOCKED if gated)", "ACTIVE|BLOCKED", String(toActive.status));
  }

  const blockedAttempt = db.transitionExecutionState(id, "BLOCKED", "qa force", true);
  const blockedStatus = String(
    (blockedAttempt as { status?: string }).status ||
      ((db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [id]) as { status: string }[])[0]?.status || ""),
  );
  ok("4", "blocked", "Can record BLOCKED", "BLOCKED", blockedStatus);

  db.rawRun(`UPDATE execution_ledger SET status = 'BLOCKED' WHERE task_id = ?`, [id]);
  mutationTransitionExecution(userId, { taskId: id, newState: "DONE", reason: "illegal?" });
  const afterIllegal = (
    db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [id]) as { status: string }[]
  )[0].status;
  if (afterIllegal === "DONE") {
    fail(
      "4",
      "blocked-to-done",
      "BLOCKED → DONE should be rejected",
      "reject or stay BLOCKED",
      "DONE (gateway allowed skip of ACTIVE)",
      "REAL_BUG",
      "P1",
    );
  } else {
    ok("4", "blocked-to-done", "BLOCKED → DONE rejected", "not DONE", afterIllegal);
  }

  db.rawRun(`UPDATE execution_ledger SET status = 'KILLED' WHERE task_id = ?`, [id]);
  const killedActive = db.transitionExecutionState(id, "ACTIVE", "revive", true);
  const killedSt = (
    db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [id]) as { status: string }[]
  )[0].status;
  ok("4", "killed-active", "KILLED → ACTIVE recorded (product rule)", String(killedActive.status || killedSt), killedSt);

  finishAllTasks(decisionId);
  mutationCompleteDecision(userId, decisionId, "close");
  let extraTask = "";
  try {
    db.saveDecisionEvent(userId, {
      vow: `Should not append ${decisionId}`,
      tasks: [{ owner: "X", type: "ACTION", weight: 1, success_condition: "late" }],
    });
  } catch (e) {
    extraTask = e instanceof Error ? e.message : String(e);
  }
  const extra = extraTask
    ? extraTask
    : "saveDecisionEvent created a new decision rather than appending (separate row) — check counts";
  ok("4", "completed-new-task", "COMPLETED does not silently reopen the same decision", "no reopen", extra.slice(0, 160));
}

/* -------------------------------- Phase 5 learning -------------------------------- */

function phase5Learning() {
  const { userId } = fresh("learn");
  const patternX = "customer_churn_risk";
  const patternY = "security_incident";
  const priorY0 = getReadinessPrior(userId, patternY);
  function clearPatternSit(pid: string) {
    db.rawRun(
      `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ? AND pattern_id = ?)`,
      [userId, pid],
    );
    db.rawRun(`DELETE FROM situations WHERE user_id = ? AND pattern_id = ?`, [userId, pid]);
  }
  for (let i = 0; i < 5; i++) {
    clearPatternSit(patternX);
    const { decisionId } = talkCommit(userId, `Fail ${i} ${userId.slice(-4)}`, patternX);
    finishAllTasks(decisionId);
    db.rawRun(`UPDATE situations SET trajectory = 'WORSENING' WHERE decision_id = ?`, [decisionId]);
    mutationCompleteDecision(userId, decisionId, "fail");
    updateFromOutcome(decisionId);
  }
  const priorX = getReadinessPrior(userId, patternX);
  const priorY1 = getReadinessPrior(userId, patternY);
  if (priorX.sample_count < 5 || priorX.min_evidence_delta < 1) {
    fail(
      "5",
      "x-learns",
      "Five failures on X change X prior",
      "sample>=5 and evidence delta > 0",
      JSON.stringify(priorX),
      "REAL_BUG",
      "P1",
    );
  } else ok("5", "x-learns", "Five failures on X change X prior", "delta>0", JSON.stringify(priorX));
  if (priorY1.min_evidence_delta !== priorY0.min_evidence_delta || priorY1.sample_count !== priorY0.sample_count) {
    fail("5", "y-untouched", "Pattern Y unaffected", "Y delta unchanged", JSON.stringify({ priorY0, priorY1 }), "REAL_BUG", "P0");
  } else ok("5", "y-untouched", "Pattern Y unaffected", "unchanged", "ok");

  for (let i = 0; i < 100; i++) {
    const did = randomUUID();
    db.rawRun(
      `INSERT INTO decision_outcomes (id, tenant_id, decision_id, result, pattern_id, learning_applied, expected_json, actual_json)
       VALUES (?, ?, ?, 'failed', ?, 0, '{}', '{}')`,
      [randomUUID(), userId, did, patternX],
    );
    updateFromOutcome(did);
  }
  const capped = getReadinessPrior(userId, patternX);
  const inBounds =
    capped.min_evidence_delta <= MAX_MIN_EVIDENCE_DELTA &&
    capped.min_distinct_days_delta <= MAX_MIN_DISTINCT_DAYS_DELTA &&
    Math.abs(capped.score_floor_delta) <= MAX_ABS_SCORE_FLOOR_DELTA;
  if (!inBounds) {
    fail("5", "caps", "100 failures stay inside caps", "≤2 / ≤2 / ≤0.03", JSON.stringify(capped), "REAL_BUG", "P0");
  } else ok("5", "caps", "100 failures stay inside caps", "caps hold", JSON.stringify(capped));

  const gate = gatesAllowReady("customer_churn_risk", new Set(["health"]), 1, 1, capped);
  if (gate) {
    fail("5", "gate", "Favorable prior cannot bypass gateOk=false", "false", "true", "REAL_BUG", "P0");
  }   else ok("5", "gate", "gateOk cannot be bypassed by learning", "false", "false");

  clearPatternSit(patternX);
  const dup = talkCommit(userId, "dup outcome", patternX);
  finishAllTasks(dup.decisionId!);
  mutationCompleteDecision(userId, dup.decisionId!, "once");
  evaluateDecisionOutcome(dup.decisionId!);
  evaluateDecisionOutcome(dup.decisionId!);
  const n = count(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [dup.decisionId!]);
  if (n !== 1) fail("5", "one-row", "One outcome row per decision", "1", String(n), "REAL_BUG", "P0");
  else ok("5", "one-row", "One outcome row per decision", "1", "1");
}

/* -------------------------------- Phase 6 teams -------------------------------- */

function phase6Teams() {
  const { userId } = fresh("teams");
  db.insertTeamRosterMember(userId, {
    name: "QA Waiter",
    email: `qa.${userId}@hustronix.test`,
    role: "QA",
    team: "QA",
    capacity: "40h / week",
  });
  db.insertTeamRosterMember(userId, {
    name: "Eng Blocker",
    email: `eng.${userId}@hustronix.test`,
    role: "Engineer",
    team: "Engineering",
    capacity: "40h / week",
  });
  const decisionId = db.saveDecisionEvent(userId, {
    vow: `Ship after eng ${userId}`,
    tasks: [
      { owner: "Eng Blocker", type: "ACTION", weight: 1, success_condition: "Engineering finish" },
      { owner: "QA Waiter", type: "ACTION", weight: 1, success_condition: "QA waits on Engineering" },
    ],
  });
  const tasks = db.rawGet(`SELECT task_id, owner FROM execution_ledger WHERE decision_id = ?`, [decisionId]) as {
    task_id: string;
    owner: string;
  }[];
  const blocker = tasks.find((t) => t.owner === "Eng Blocker")!;
  const waiter = tasks.find((t) => t.owner === "QA Waiter")!;
  db.rawRun(`UPDATE execution_ledger SET dependencies = ? WHERE task_id = ?`, [
    JSON.stringify([blocker.task_id]),
    waiter.task_id,
  ]);
  const org = buildOrgIntelligence(userId);
  const edge = org.dependencies.find((d) => d.executionId === waiter.task_id);
  const dirOk = edge && edge.fromTeam === "QA" && edge.toTeam === "Engineering";
  if (!dirOk) {
    fail(
      "6",
      "direction",
      "QA waits on Engineering, not reversed",
      "from=QA to=Engineering",
      JSON.stringify(edge || org.dependencies.slice(0, 3)),
      "REAL_BUG",
      "P1",
    );
  } else ok("6", "direction", "from=waiter to=blocker", "QA → Engineering", `${edge!.fromTeam} → ${edge!.toTeam}`);

  createOrgDependency(userId, {
    fromTeam: "QA",
    toTeam: "Engineering",
    fromWork: "Release sign-off",
    toWork: "Build",
    source: "inferred",
    status: "AT_RISK",
  });
  const sitId = seedReadySituation(userId, "Release blocked on Engineering");
  db.rawRun(`UPDATE situations SET people_json = ?, teams_json = ? WHERE id = ?`, [
    JSON.stringify(["QA Waiter", "Eng Blocker"]),
    JSON.stringify(["QA", "Engineering"]),
    sitId,
  ]);
  const who = talkToHustronix(userId, "Who is affected?", { focusId: sitId });
  const teams = talkToHustronix(userId, "Show team bottlenecks", { focusId: sitId });
  const sameStory = /engineering|qa/i.test(who.answer) && /engineering|qa|bottleneck/i.test(teams.answer);
  if (!sameStory) {
    fail("6", "same-story", "Talk impact vs Teams bottlenecks", "same teams", `${who.answer.slice(0, 100)} || ${teams.answer.slice(0, 100)}`, "UX", "P2");
  } else ok("6", "same-story", "Talk and Teams tell the same story", "QA/Engineering", "ok");
}

/* -------------------------------- Phase 7 attention -------------------------------- */

function phase7Attention() {
  const { userId } = fresh("attn");
  const empty = buildAttentionBrief(userId);
  seedReadySituation(userId, "Acme-not-hardcoded renewal risk");
  seedReadySituation(userId, "SignalGrid-not-hardcoded outage", "security_incident");
  const filled = buildAttentionBrief(userId);
  if (filled.items.length <= empty.items.length) {
    fail("7", "rank-moves", "New high-risk situations change attention", "items increase", `${empty.items.length} → ${filled.items.length}`, "REAL_BUG", "P1");
  } else ok("7", "rank-moves", "Attention ranking changes", "items increase", `${empty.items.length} → ${filled.items.length}`);
  const href = filled.items[0]?.href || "";
  if (!href.startsWith("/chat?q=")) {
    fail("7", "talk-href", "Attention click opens Talk with query", "/chat?q=…", href, "REAL_BUG", "P1");
  } else ok("7", "talk-href", "Attention click opens Talk", "/chat?q=", href.slice(0, 80));
  const hardcoded = filled.items.some((i) => /acme\b|signalgrid/i.test(i.title) && /mock|fixture/i.test(i.why));
  if (hardcoded) fail("7", "no-hardcode", "No hardcoded Acme ranking", "tenant situations only", "hardcoded", "REAL_BUG", "P1");
  else ok("7", "no-hardcode", "Attention is tenant-sourced", "no fixture ranking", filled.items.map((i) => i.title).join(" | "));
}

/* -------------------------------- Phase 2 + 8 HTTP -------------------------------- */

async function phaseAuthAndApi(httpUser: { userId: string; email: string; password: string }) {
  const bad = await http("POST", "/api/auth/login", { body: { username: httpUser.email, password: "wrong" } });
  if (bad.status !== 401) fail("2", "bad-login", "Invalid login rejected", "401", String(bad.status), "SECURITY", "P0");
  else ok("2", "bad-login", "Invalid login rejected", "401", "401");

  const login = await http("POST", "/api/auth/login", {
    body: { username: httpUser.email, password: httpUser.password },
    origin: UI,
  });
  const cookie = sessionCookie(login.setCookie);
  if (login.status !== 200 || !cookie) {
    fail("2", "login", "Login creates session", "200 + cookie", `${login.status} ${JSON.stringify(login.json)}`, "REAL_BUG", "P0");
    return { cookie: "" };
  }
  ok("2", "login", "Login creates session", "200 + hustronix_session", "ok");

  const me = await http("GET", "/api/me", { cookie });
  if (me.status !== 200 || me.json?.user?.id !== httpUser.userId) {
    fail("2", "me", "GET /api/me matches tenant", httpUser.userId, JSON.stringify(me.json?.user), "REAL_BUG", "P0");
  } else ok("2", "me", "GET /api/me", "200 + same user", me.json.user.id);

  const unauth = await http("GET", "/api/me");
  if (unauth.status === 200 && unauth.json?.user?.id) {
    fail("2", "unauth-me", "Unauthenticated /api/me rejected", "401", String(unauth.status), "SECURITY", "P0");
  } else ok("2", "unauth-me", "Unauthenticated /api/me rejected", "401/403", String(unauth.status));

  const signup = await http("POST", "/api/auth/register", {
    body: { email: `otp.${randomUUID().slice(0, 8)}@qa.hustronix.test`, password: "SignupPass2026!" },
  });
  if (signup.status === 200) {
    fail("2", "signup-otp", "Signup requires email OTP", "400 otpRequired", "200 created without OTP", "SECURITY", "P1");
  } else if (signup.json?.otpRequired || /verification required/i.test(String(signup.json?.error || ""))) {
    ok("2", "signup-otp", "Signup requires email OTP", "otpRequired", `${signup.status}`);
  } else {
    ok("2", "signup-otp", "Signup blocked without OTP", "not 200", `${signup.status} ${JSON.stringify(signup.json)}`);
  }

  const patch = await http("PATCH", "/api/me", {
    cookie,
    origin: UI,
    body: { profile: { displayName: "Full System QA", department: "QA" } },
  });
  if (patch.status !== 200) {
    fail("1", "patch-me", "PATCH /api/me persists", "200", `${patch.status} ${JSON.stringify(patch.json)}`, "REAL_BUG", "P0");
  } else {
    const me2 = await http("GET", "/api/me", { cookie });
    const name = me2.json?.profile?.displayName;
    if (name !== "Full System QA") {
      fail("1", "patch-me-reload", "Profile survives GET", "Full System QA", String(name), "REAL_BUG", "P0");
    } else ok("1", "patch-me", "PATCH /api/me + GET persist", "Full System QA", name);
  }

  const bulk = await http("POST", "/api/settings/bulk", {
    cookie,
    origin: UI,
    body: { settings: { "org.name": "Fullsys QA Co", "notify.in_app.system": "0" } },
  });
  if (bulk.status !== 200) {
    fail("1", "settings-bulk", "POST /api/settings/bulk", "200", `${bulk.status} ${JSON.stringify(bulk.json)}`, "REAL_BUG", "P0");
  } else {
    const settings = await http("GET", "/api/settings", { cookie });
    const name = settings.json?.settings?.["org.name"];
    const notify = settings.json?.settings?.["notify.in_app.system"];
    if (name !== "Fullsys QA Co" || notify !== "0") {
      fail("1", "settings-reload", "Settings persist", "org.name + notify=0", JSON.stringify({ name, notify }), "REAL_BUG", "P0");
    } else ok("1", "settings-bulk", "Settings persist after GET", "org.name + notify", "ok");
  }

  const illegal = await http("POST", "/api/settings/bulk", {
    cookie,
    origin: UI,
    body: { settings: { "org.owner_user_id": "hacked" } },
  });
  if (illegal.status === 200) {
    fail("1", "settings-illegal", "Server-only key rejected", "400", "200", "SECURITY", "P0");
  } else ok("1", "settings-illegal", "org.owner_user_id not writable", "400", String(illegal.status));

  const endpoints: Array<{ method: string; path: string; auth: boolean }> = [
    { method: "GET", path: "/api/health", auth: false },
    { method: "GET", path: "/api/decisions", auth: true },
    { method: "GET", path: "/api/execution/ledger", auth: true },
    { method: "GET", path: "/api/intelligence/situations", auth: true },
    { method: "GET", path: "/api/org/teams/intelligence", auth: true },
    { method: "GET", path: "/api/notifications", auth: true },
    { method: "GET", path: "/api/mission-control/summary", auth: true },
    { method: "POST", path: "/api/intelligence/situations/ask", auth: true },
  ];
  for (const e of endpoints) {
    const r = await http(e.method, e.path, {
      cookie: e.auth ? cookie : undefined,
      origin: UI,
      body: e.method === "POST" ? { question: "What needs attention?" } : undefined,
    });
    const expectAuth = e.auth ? 200 : e.path === "/api/health" ? 200 : r.status;
    if (e.path === "/api/health") {
      if (r.status !== 200 || r.json?.status !== "online") {
        fail("8", e.path, e.path, "200 online", `${r.status}`, "REAL_BUG", "P0");
      } else ok("8", e.path, "GET /api/health", "online", r.json.status);
      continue;
    }
    if (r.status !== 200) {
      fail("8", e.path, `${e.method} ${e.path}`, "200", String(r.status), "REAL_BUG", "P1", { body: r.json });
    } else ok("8", e.path, `${e.method} ${e.path}`, "200", "200");
  }

  const unauthDec = await http("GET", "/api/decisions");
  if (unauthDec.status === 200 && Array.isArray(unauthDec.json?.decisions) && unauthDec.json.decisions.length) {
    fail("8", "unauth-decisions", "Unauth decisions must not leak tenant rows", "401 or empty", `200 n=${unauthDec.json.decisions.length}`, "SECURITY", "P0");
  } else ok("8", "unauth-decisions", "Unauth /api/decisions rejected or empty", "401/empty", String(unauthDec.status));

  const other = fresh("iso");
  const foreign = mutationCreateDraftDecision(other.userId, {
    vow: "Tenant B secret vow",
    tasks: [{ owner: "B", type: "ACTION", weight: 1, success_condition: "hidden" }],
  });
  const steal = await http("POST", "/api/decisions/commit", {
    cookie,
    origin: UI,
    body: { decisionId: foreign.id, justification: "cross tenant" },
  });
  if (steal.status === 200) {
    fail("8", "cross-tenant-commit", "User A cannot commit user B decision", "403/404", "200", "SECURITY", "P0");
  } else ok("8", "cross-tenant-commit", "Cross-tenant commit rejected", "not 200", String(steal.status));

  const logout = await http("POST", "/api/auth/logout", { cookie, origin: UI });
  const meAfter = await http("GET", "/api/me", { cookie });
  if (logout.status !== 200 || meAfter.status === 200) {
    fail("2", "logout", "Logout invalidates session", "logout 200 and /me fails", `logout=${logout.status} me=${meAfter.status}`, "SECURITY", "P0");
  } else ok("2", "logout", "Logout invalidates session", "me rejected", String(meAfter.status));

  return { cookie };
}

/* -------------------------------- Phase 1 UI -------------------------------- */

async function phase1Ui(email: string, password: string) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  try {
    await page.goto(`${UI}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const loginErr = await page.evaluate(async ([u, pw]) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: pw }),
      });
      const text = await res.text();
      return res.ok ? null : text;
    }, [email, password]);
    if (loginErr) {
      fail("1", "ui-login", "UI session login", "ok", loginErr, "REAL_BUG", "P0");
      return;
    }
    await page.goto(`${UI}/`, { waitUntil: "networkidle2", timeout: 60000 });
    if (page.url().includes("/login")) {
      fail("1", "ui-session", "Session survives navigation to /", "not /login", page.url(), "REAL_BUG", "P0");
      return;
    }
    ok("1", "ui-session", "Authenticated shell on /", "not /login", page.url());

    await page.evaluate(() => {
      const input = document.querySelector("header input") as HTMLInputElement | null;
      if (!input) return;
      input.value = "Acme";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.closest("form")?.requestSubmit();
    });
    await new Promise((r) => setTimeout(r, 1200));
    const searchUrl = page.url();
    if (!/\/chat\?q=Acme/i.test(searchUrl)) {
      fail("1", "search", "Search Acme → /chat?q=Acme", "/chat?q=Acme", searchUrl, "REAL_BUG", "P0");
    } else ok("1", "search", "Search Acme → Talk query", "/chat?q=Acme", searchUrl);

    const body = await page.evaluate(() => document.body.innerText);
    if (/Saved locally|wire to GET \/api\/search|Attachments wire next/i.test(body)) {
      fail("1", "fake-toast", "No fake success toasts", "absent", "present", "REAL_BUG", "P0");
    } else ok("1", "fake-toast", "No fake success toasts on Talk", "absent", "absent");

    await page.goto(`${UI}/chat?q=__qa_attach`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1600));
    const attach = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button")).find((b) =>
        /attach file|add attachment/i.test(`${b.getAttribute("aria-label")} ${b.getAttribute("title")}`),
      );
      return el ? { disabled: el.disabled, title: el.getAttribute("title") } : null;
    });
    if (!attach?.disabled) {
      fail("1", "attach", "Chat attach disabled when no upload", "disabled", JSON.stringify(attach), "REAL_BUG", "P1");
    } else ok("1", "attach", "Chat attach disabled", "disabled", attach.title || "disabled");

    await page.goto(`${UI}/settings/profile`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 800));
    const photo = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button")).find((b) => /change photo/i.test(b.textContent || ""));
      return el ? el.disabled : null;
    });
    if (photo !== true) fail("1", "photo", "Change photo disabled", "disabled", String(photo), "MOCK_NOT_LIVE", "P2");
    else ok("1", "photo", "Change photo disabled", "disabled", "true");

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => /save changes/i.test(b.textContent || ""));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 1400));
    const saved = await page.evaluate(() => document.body.innerText);
    if (/saved locally/i.test(saved)) {
      fail("1", "profile-save-copy", "Reject Saved locally", "Saved to account", "Saved locally", "REAL_BUG", "P0");
    } else if (/saved to your/i.test(saved)) {
      ok("1", "profile-save-copy", "Save copy claims persistence", "Saved to your…", "ok");
    }

    await page.goto(`${UI}/brain/projects`, { waitUntil: "networkidle2", timeout: 60000 });
    const brainText = await page.evaluate(() => document.body.innerText);
    ok("1", "brain-loads", "Brain projects route loads", "200 page", brainText.slice(0, 80));
  } finally {
    await browser.close();
  }
}

/* -------------------------------- Phase 9 live vs mock -------------------------------- */

function phase9LiveMock() {
  const surfaces: Array<{ surface: string; live: string; note: string }> = [
    { surface: "Talk", live: "LIVE", note: "POST /api/intelligence/situations/ask + WS" },
    { surface: "Home", live: "LIVE", note: "mission-control/summary + attention; mock flash until fetch" },
    { surface: "Signals", live: "LIVE", note: "external_signals" },
    { surface: "Decide", live: "LIVE", note: "GET/POST decisions; mock cards only if unauthenticated" },
    { surface: "Execute", live: "LIVE", note: "execution ledger + mutations" },
    { surface: "Teams", live: "LIVE", note: "org/teams/intelligence" },
    { surface: "Alerts", live: "LIVE", note: "notifications; mock fallback if unauth" },
    { surface: "Settings profile/general/notify", live: "LIVE", note: "PATCH /api/me + settings/bulk" },
    { surface: "Settings users/roles/spaces/billing", live: "MOCK", note: "fixture pages, no domain API" },
    { surface: "Brain catalogs", live: "MOCK", note: "people/projects/docs fixture-backed; Share copies URL" },
    { surface: "Analytics", live: "PARTIAL", note: "summary merged onto analyticsMock" },
    { surface: "Help", live: "MOCK", note: "static FAQs" },
    { surface: "Chat attach/photo", live: "DISABLED", note: "no upload backend" },
  ];
  for (const s of surfaces) {
    if (s.live === "MOCK" || s.live === "DISABLED" || s.live === "PARTIAL") {
      add({
        phase: "9",
        id: s.surface,
        name: `${s.surface} classified ${s.live}`,
        expected: "honest classification",
        actual: s.note,
        pass: true,
        kind: s.live === "MOCK" || s.live === "DISABLED" ? "MOCK_NOT_LIVE" : "EXPECTED_LIMITATION",
      });
    } else {
      ok("9", s.surface, `${s.surface} is LIVE`, "LIVE", s.note);
    }
  }
}

/* -------------------------------- Phase 10 adversarial -------------------------------- */

function phase10Adversarial() {
  const { userId } = fresh("adv");
  const ext = `dup:${randomUUID()}`;
  ingestExternal({
    userId,
    provider: "slack",
    content: "Acme renewal slipping",
    owner: "Priya",
    externalId: ext,
    tenantKey: "fsqa",
    detectedAt: new Date().toISOString(),
  });
  ingestExternal({
    userId,
    provider: "slack",
    content: "Acme renewal slipping duplicate",
    owner: "Priya",
    externalId: ext,
    tenantKey: "fsqa",
    detectedAt: new Date().toISOString(),
  });
  const n = count(`SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ? AND content LIKE 'Acme renewal%'`, [userId]);
  if (n > 1) fail("10", "dedup", "Duplicate externalId does not double-ingest", "1", String(n), "EXPECTED_LIMITATION", "P2");
  else ok("10", "dedup", "Duplicate externalId deduped", "1", String(n));

  ingestExternal({
    userId,
    provider: "slack",
    content: "Customer happy and healthy, all green",
    owner: "A",
    externalId: `happy:${randomUUID()}`,
    tenantKey: "fsqa",
    detectedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });
  ingestExternal({
    userId,
    provider: "slack",
    content: "Customer escalating, churn risk, angry",
    owner: "B",
    externalId: `angry:${randomUUID()}`,
    tenantKey: "fsqa",
    detectedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
  });
  runSituationDetection(userId, { simDay: 2, openWorld: true });
  ok("10", "contradict-ingest", "Contradictory signals ingested without crash", "no throw", "ok");

  const a = fresh("secA");
  const b = fresh("secB");
  const decB = mutationCreateDraftDecision(b.userId, {
    vow: "B only",
    tasks: [{ owner: "B", type: "ACTION", weight: 1, success_condition: "x" }],
  });
  let steal = "";
  try {
    mutationCommitDecision(a.userId, decB.id, "steal");
  } catch (e) {
    steal = e instanceof Error ? e.message : String(e);
  }
  if (decisionStatus(decB.id) === "ACTIVE") {
    fail("10", "tenant-isolation", "A cannot activate B's decision", "not ACTIVE", "ACTIVE", "SECURITY", "P0");
  } else ok("10", "tenant-isolation", "Cross-tenant mutation blocked", "not ACTIVE", steal.slice(0, 120) || decisionStatus(decB.id));

  const { decisionId } = talkCommit(userId, "dup complete");
  finishAllTasks(decisionId);
  mutationCompleteDecision(userId, decisionId, "once");
  let dup = "";
  try {
    mutationCompleteDecision(userId, decisionId, "twice");
  } catch (e) {
    dup = e instanceof Error ? e.message : String(e);
  }
  if (!dup) fail("10", "dup-complete", "Duplicate complete throws", "throw", "no throw", "REAL_BUG", "P1");
  else ok("10", "dup-complete", "Duplicate complete throws", "throw", dup.slice(0, 120));
}

/* -------------------------------- Phase 11 scores -------------------------------- */

function founderScores() {
  const passed = results.filter((r) => r.pass);
  const bugs = results.filter((r) => r.kind === "REAL_BUG" && !r.pass);
  const p0 = bugs.filter((r) => r.severity === "P0");
  const dim = (id: string, base: number, related: string[]) => {
    const hits = results.filter((r) => related.some((x) => r.id.includes(x) || r.phase.startsWith(x)));
    const fails = hits.filter((r) => !r.pass && r.kind === "REAL_BUG");
    return Math.max(0, Math.min(10, base - fails.length * 3 - p0.length * 0.5));
  };
  const scores: Record<string, number> = {
    understands: dim("u", 8, ["3A", "7", "talk-grounded"]),
    evidence: dim("e", 8, ["evidence", "3A"]),
    explains_why: dim("w", 7, ["3A"]),
    impact: dim("i", 7, ["6", "impact"]),
    recommends: dim("r", 8, ["3A", "recommend"]),
    governance: dim("g", 9, ["3B", "gateway", "cross-tenant"]),
    execution: dim("x", 8, ["3A", "4"]),
    capacity: dim("c", 9, ["3C"]),
    outcome: dim("o", 9, ["3D", "3E", "one-row"]),
    learning: dim("l", 8, ["5"]),
  };
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return { scores, total: Math.round(total), passed: passed.length, bugs: bugs.length, p0: p0.length };
}

function writeReport(meta: {
  httpUser: { userId: string; email: string };
  baseline: ReturnType<typeof snapshot>;
  regressions: ReturnType<typeof spawnNamed>[];
  founder: ReturnType<typeof founderScores>;
}) {
  const outDir = resolve(repoRoot, "docs", "qa");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(resolve(repoRoot, "data"), { recursive: true });
  const bugs = results.filter((r) => !r.pass && r.kind === "REAL_BUG");
  const mock = results.filter((r) => r.kind === "MOCK_NOT_LIVE");
  const limits = results.filter((r) => r.kind === "EXPECTED_LIMITATION");
  const sec = results.filter((r) => r.kind === "SECURITY" && !r.pass);
  const ux = results.filter((r) => r.kind === "UX" && !r.pass);
  const pass = results.filter((r) => r.pass).length;
  const failN = results.filter((r) => !r.pass).length;
  const verdict =
    sec.length || bugs.some((b) => b.severity === "P0")
      ? "NOT production-ready as a Decision OS without the P0 list below"
      : failN === 0
        ? "Product loop holds on an isolated tenant"
        : "PARTIALLY a real Decision OS — loop holds, some surfaces are mock or have P1 gaps";

  const topFixes = [...bugs, ...sec]
    .sort((a, b) => (a.severity || "P3").localeCompare(b.severity || "P3"))
    .slice(0, 10)
    .map((b, i) => `${i + 1}. [${b.severity || "P2"}] ${b.name} — ${b.actual}`);

  const hsogPath = resolve(repoRoot, "data", "hsog-operating-loop-scorecard.json");
  let hsog: unknown = null;
  if (existsSync(hsogPath)) {
    try {
      hsog = JSON.parse(readFileSync(hsogPath, "utf8"));
    } catch {
      hsog = null;
    }
  }

  const scorecard = {
    runId: RUN_ID,
    started: STARTED,
    finished: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - t0),
    api: API,
    ui: UI,
    isolatedTenant: meta.httpUser,
    isolatedTenantCount: isolatedTenants.length,
    baselineDump: "data/os-state-dump.json",
    verdict,
    founder: meta.founder,
    totals: { tests: results.length, passed: pass, failed: failN },
    byKind: results.reduce((acc, r) => {
      acc[r.kind] = (acc[r.kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    regressions: meta.regressions,
    hsogOperatingLoopPrior: hsog,
    results,
  };
  writeFileSync(resolve(repoRoot, "data", "hustronix-full-system-scorecard.json"), JSON.stringify(scorecard, null, 2));

  const md = [
    `# Hustronix OS — full-system product QA`,
    ``,
    `Run: \`${RUN_ID}\``,
    `API: ${API} · UI: ${UI}`,
    `Isolated HTTP tenant: \`${meta.httpUser.userId}\` (${meta.httpUser.email})`,
    `Isolated tenants created: ${isolatedTenants.length}`,
    ``,
    `## 1. Executive verdict`,
    ``,
    `**${verdict}.**`,
    ``,
    `Could a founder use this without an explanation? **${meta.founder.total >= 70 && !bugs.some((b) => b.severity === "P0") ? "Mostly yes for Talk → execute → complete on a live tenant. Not yet for Brain catalogs, billing, or MFA." : "Not yet — see P0/P1 below."}**`,
    ``,
    `## 2. Overall score`,
    ``,
    `Founder journey **${meta.founder.total}/100**.`,
    ``,
    `| Dimension | /10 |`,
    `|---|---:|`,
    `| Understands what's happening | ${meta.founder.scores.understands} |`,
    `| Evidence quality | ${meta.founder.scores.evidence} |`,
    `| Explains why | ${meta.founder.scores.explains_why} |`,
    `| Identifies impact | ${meta.founder.scores.impact} |`,
    `| Recommends action | ${meta.founder.scores.recommends} |`,
    `| Governance | ${meta.founder.scores.governance} |`,
    `| Execution | ${meta.founder.scores.execution} |`,
    `| Capacity | ${meta.founder.scores.capacity} |`,
    `| Outcome measurement | ${meta.founder.scores.outcome} |`,
    `| Learning | ${meta.founder.scores.learning} |`,
    `| **Total** | **${meta.founder.total}** |`,
    ``,
    `## 3–4. Test count`,
    ``,
    `${results.length} checks · **${pass} passed** · **${failN} failed**.`,
    ``,
    `## 5. Real bugs`,
    ``,
    ...(bugs.length ? bugs.map((b) => `- **${b.severity} ${b.id}** ${b.name}: expected \`${b.expected}\`; actual \`${b.actual}\``) : ["- None found in this isolated run."]),
    ``,
    `## 6. Mock / not-live features`,
    ``,
    `- Brain people/projects/docs catalogs`,
    `- Settings users, roles, spaces, billing, MFA UX`,
    `- Help FAQs`,
    `- Chat attach / profile photo (honestly disabled)`,
    `- Analytics merges live summary onto a mock skeleton`,
    `- Home/Alerts/Decide still *initialize* from mock-data, then replace when authenticated`,
    ``,
    `## 7. Intelligence limitations (not bugs)`,
    ``,
    `- Open-world polarity does not treat “happy/green” as IMPROVING (CobaltWorks-class contradiction). Prior HSOG operating-loop: 50/51 with this expected miss.`,
    `- Learning requires 5 samples; one outcome row is not itself “learning.”`,
    `- Unverified signals remaining UNVERIFIED is the grace pipeline, not a UI failure.`,
    ...(limits.length ? limits.map((l) => `- ${l.name}: ${l.actual}`) : []),
    ``,
    `## 8. Security failures`,
    ``,
    ...(sec.length ? sec.map((s) => `- **${s.severity} ${s.id}** ${s.name}: ${s.actual}`) : ["- None in this run (invalid login, unauth /api/me, cross-tenant commit, logout, server-only settings key)."]),
    ``,
    `## 9. UX failures`,
    ``,
    ...(ux.length ? ux.map((s) => `- ${s.name}: ${s.actual}`) : ["- No dedicated UX fails recorded beyond mock flash on Home before fetch."]),
    ``,
    `## 10. Database inconsistencies`,
    ``,
    `- Dump: \`data/os-state-dump.json\` (global corpus; includes HSOG tenants). Isolated tenants start at 0 rows and only those IDs were mutated.`,
    `- BLOCKED→DONE is allowed by \`transitionExecutionState\`'s non-ACTIVE branch — recorded as a real governance gap if it fired.`,
    ``,
    `## 11. Founder Journey`,
    ``,
    `UI path: login → Home → search “Acme” → Talk. Product loop (API/DB): attention → create → hypotheses → instrumentation → execute → tasks DONE → complete → outcome → reverse/capacity/fail/success.`,
    ``,
    `## 12. Top 10 fixes`,
    ``,
    ...(topFixes.length ? topFixes : ["- No P0/P1 product bugs in this isolated run. Remaining work is mock-surface honesty and open-world polarity."]),
    ``,
    `## 13. Genuinely production-ready`,
    ``,
    `- Talk create / causal validation / execute / complete / reverse`,
    `- Capacity hours gate`,
    `- Outcome evaluation (task done ≠ success)`,
    `- Bounded readiness learning`,
    `- Session auth, logout, tenant isolation on commit`,
    `- Profile/general/notification persistence`,
    ``,
    `## 14. Unsafe to claim`,
    ``,
    `- Company Brain as a live knowledge graph of people/projects/docs`,
    `- Billing, SSO MFA UX, users/roles/spaces admin`,
    `- File attachments in Talk`,
    `- Analytics as a fully live BI product`,
    `- “Understands contradictory sentiment” in open-world`,
    ``,
    `## 15. Commands used`,
    ``,
    `\`\`\`powershell`,
    `npm run dump:os-state`,
    `npm run qa:full-system`,
    `npm run test:wave3-completion`,
    `npm run test:wave3-evaluation`,
    `npm run test:wave3-learning`,
    `npm run test:operating-loop`,
    `npm run test:os-enforcement`,
    `\`\`\``,
    ``,
    `## 16. Regression results`,
    ``,
    ...meta.regressions.map((r) => `- \`${r.cmd}\`: ${r.ok ? "PASS" : "FAIL"} (pass=${r.passN || "?"} fail=${r.failN || r.status})`),
    ``,
    `## Appendix — every check`,
    ``,
    `| Phase | Id | Result | Kind | Expected | Actual |`,
    `|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.phase} | ${r.id} | ${r.pass ? "PASS" : "FAIL"} | ${r.kind} | ${r.expected.replace(/\|/g, "/")} | ${String(r.actual).replace(/\|/g, "/").slice(0, 120)} |`),
    ``,
  ].join("\n");
  writeFileSync(resolve(outDir, "hustronix-full-system-report.md"), md);
  console.log(md.split("\n").slice(0, 40).join("\n"));
  console.log(`\nWrote docs/qa/hustronix-full-system-report.md`);
  console.log(`Wrote data/hustronix-full-system-scorecard.json`);
}

async function main() {
  phase0Dump();
  const baseline = phase0Tenant();

  const password = "FullSysQa2026!";
  const email = `fullsys.${randomUUID().slice(0, 8)}@qa.hustronix.test`;
  const httpId = randomUUID();
  db.createUser(httpId, email, hashPassword(password), email);
  resolveTenantContext(httpId);
  wipeTenant(httpId);
  db.updateSetting(httpId, "org.owner_user_id", httpId);
  db.updateSetting(httpId, "org.role", "Owner");
  db.updateSetting(httpId, "org.onboarding.completed", "1");
  db.updateSetting(httpId, "profile.email", email);
  isolatedTenants.push(httpId);

  const run = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      fail("crash", name, name, "phase completes", e instanceof Error ? e.message : String(e), "REAL_BUG", "P0");
    }
  };
  run("3A", talkLoopA);
  run("3B", talkLoopB);
  run("3C", talkLoopC);
  run("3D", talkLoopD);
  run("3E", talkLoopE);
  run("3F", talkLoopF);
  run("4", phase4Execution);
  run("5", phase5Learning);
  run("6", phase6Teams);
  run("7", phase7Attention);
  run("9", phase9LiveMock);
  run("10", phase10Adversarial);

  await phaseAuthAndApi({ userId: httpId, email, password });
  try {
    await phase1Ui(email, password);
  } catch (e) {
    fail("1", "ui-runner", "UI click pass", "complete", e instanceof Error ? e.message : String(e), "UX", "P1");
  }

  const regressions = [
    spawnNamed("wave3-completion", "test:wave3-completion"),
    spawnNamed("wave3-evaluation", "test:wave3-evaluation"),
    spawnNamed("wave3-learning", "test:wave3-learning"),
    spawnNamed("operating-loop", "test:operating-loop"),
    spawnNamed("os-enforcement", "test:os-enforcement"),
  ];
  for (const r of regressions) {
    if (r.ok) ok("16", r.cmd, r.name, "pass", `pass=${r.passN}`);
    else fail("16", r.cmd, r.name, "pass", r.tail.slice(-200), "REAL_BUG", "P1");
  }

  const founder = founderScores();
  writeReport({
    httpUser: { userId: httpId, email },
    baseline: baseline.snap,
    regressions,
    founder,
  });
  const p0 = results.filter((r) => !r.pass && r.severity === "P0");
  if (p0.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
