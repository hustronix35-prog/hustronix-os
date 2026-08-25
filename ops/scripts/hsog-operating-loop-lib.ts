/**
 * HSOG operating-loop helpers. Evaluator only — does not change product code.
 */
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { talkToHustronix, type TalkActionId } from "../../apps/api/src/intelligence/situation-chat.js";
import {
  mutationCompleteDecision,
  mutationCreateDraftDecision,
  mutationReverseDecision,
} from "../../apps/api/src/security/mutation-handlers.js";

export type FailureClass =
  | "REAL_PRODUCT_BUG"
  | "HSOG_HARNESS_BUG"
  | "EXPECTED_LIMITATION"
  | "BENCHMARK_ARTIFACT";

export type Check = {
  id: string;
  letter: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  classification?: FailureClass;
  severity?: "high" | "medium" | "low";
  root_cause?: string;
  recommended_fix?: string;
  evidence?: Record<string, unknown>;
};

export function ensureUser(username: string): string {
  let user = db.getUser(username) as { id: string } | undefined;
  if (!user) {
    const id = randomUUID().replace(/-/g, "").slice(0, 28);
    db.createUser(id, username, hashPassword(`${username}-local`), `${username}@hustronix.io`);
    user = db.getUser(username) as { id: string };
  }
  resolveTenantContext(user.id);
  db.updateSetting(user.id, "org.owner_user_id", user.id);
  db.updateSetting(user.id, "org.role", "owner");
  return user.id;
}

export function wipeTenant(userId: string) {
  const decIds = `SELECT id FROM decision_ledger WHERE user_id = ?`;
  const stmts = [
    `UPDATE external_signals SET linked_execution_id = NULL, related_decision_id = NULL, state = 'UNVERIFIED' WHERE user_id = ?`,
    `DELETE FROM clarification_requests WHERE user_id = ?`,
    `DELETE FROM action_ledger WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_outcomes WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_outcomes WHERE tenant_id = ?`,
    `DELETE FROM conflicts WHERE decision_id IN (${decIds})`,
    `DELETE FROM simulation_runs WHERE decision_id IN (${decIds})`,
    `UPDATE beliefs SET source_decision_id = NULL WHERE source_decision_id IN (${decIds})`,
    `DELETE FROM learning_log WHERE user_id = ?`,
    `DELETE FROM readiness_priors WHERE user_id = ?`,
    `DELETE FROM org_dependencies WHERE user_id = ?`,
    `DELETE FROM notifications WHERE user_id = ?`,
    `DELETE FROM execution_ledger WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_ledger WHERE user_id = ?`,
    `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situation_events WHERE user_id = ?`,
    `DELETE FROM situation_entities WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM signal_entities WHERE user_id = ?`,
    `DELETE FROM entity_cooccurrence WHERE user_id = ?`,
    `DELETE FROM situations WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
  ];
  for (const sql of stmts) {
    try {
      db.rawRun(sql, [userId]);
    } catch {
      /* optional table */
    }
  }
}

export function check(
  letter: string,
  id: string,
  name: string,
  pass: boolean,
  expected: string,
  actual: string,
  extra?: Partial<Check>,
): Check {
  return { letter, id, name, pass, expected, actual, ...extra };
}

export function fail(
  letter: string,
  id: string,
  name: string,
  expected: string,
  actual: string,
  classification: FailureClass,
  severity: Check["severity"],
  root_cause: string,
  recommended_fix: string,
  evidence?: Record<string, unknown>,
): Check {
  return {
    letter,
    id,
    name,
    pass: false,
    expected,
    actual,
    classification,
    severity,
    root_cause,
    recommended_fix,
    evidence,
  };
}

export type SimArt = {
  day: number;
  source: "slack" | "jira" | "gmail" | "hubspot" | "github";
  author: string;
  content: string;
  slug: string;
};

export function ingestSim(userId: string, art: SimArt, tenantKey = "operating_loop") {
  const provider =
    art.source === "slack"
      ? "slack"
      : art.source === "jira"
        ? "jira"
        : art.source === "gmail"
          ? "gmail"
          : art.source === "hubspot"
            ? "hubspot"
            : "github";
  ingestExternal({
    userId,
    provider,
    content: art.content,
    owner: art.author,
    externalId: `oloop:${art.slug}:d${art.day}:${randomUUID().slice(0, 8)}`,
    tenantKey,
    detectedAt: new Date(Date.UTC(2026, 0, 1 + art.day, 12, 0, 0)).toISOString(),
    meta: { sim_day: art.day, source_system: art.source, operating_loop: true },
  });
}

export function ingestDays(
  userId: string,
  arts: SimArt[],
  opts?: { openWorld?: boolean },
) {
  const byDay = new Map<number, SimArt[]>();
  for (const a of arts) {
    const list = byDay.get(a.day) || [];
    list.push(a);
    byDay.set(a.day, list);
  }
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const a of byDay.get(day) || []) ingestSim(userId, a);
    runSituationDetection(userId, { simDay: day, openWorld: opts?.openWorld });
  }
}

export function listSituations(userId: string) {
  return db.rawGet(
    `SELECT id, pattern_id, title, stage, trajectory, confidence, evidence_count,
            awareness_day, forming_day, elevated_day, decision_ready_day, decision_id,
            entities_json, facets_json, sources_json, explanation, readiness_score
     FROM situations WHERE user_id = ?`,
    [userId],
  ) as Array<{
    id: string;
    pattern_id: string;
    title: string;
    stage: string;
    trajectory: string;
    confidence: number;
    evidence_count: number;
    awareness_day: number | null;
    forming_day: number | null;
    elevated_day: number | null;
    decision_ready_day: number | null;
    decision_id: string | null;
    entities_json: string | null;
    facets_json: string | null;
    sources_json: string | null;
    explanation: string | null;
    readiness_score: number | null;
  }>;
}

export function finishAllTasks(decisionId: string) {
  const tasks = db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [
    decisionId,
  ]) as { task_id: string; status: string }[];
  for (const t of tasks) {
    if (t.status === "PENDING" || t.status === "BLOCKED") {
      try {
        db.transitionExecutionState(t.task_id, "ACTIVE", "oloop activate", true);
      } catch {
        /* already active / blocked */
      }
    }
    const after = (
      db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [t.task_id]) as { status: string }[]
    )[0];
    if (after?.status === "ACTIVE") {
      db.transitionExecutionState(t.task_id, "DONE", "oloop finish", true);
    }
  }
  return tasks.length;
}

export function seedReadySituation(
  userId: string,
  title: string,
  patternId?: string,
): string {
  const id = randomUUID();
  const pid = patternId || `open_world_test_${id.slice(0, 8)}`;
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
     VALUES (?, ?, ?, ?, 'DECISION_READY', 0.86, 'WORSENING', 12,
       'Evaluator-seeded decision-ready situation for operating-loop product tests.', ?, ?, ?, 2)`,
    [
      id,
      userId,
      pid,
      title,
      JSON.stringify(["Northwind"]),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Restore the SLA", "Weekly exec update"]),
    ],
  );
  const sigA = randomUUID();
  const sigB = randomUUID();
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigA, userId, `${title} reported`],
  );
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
     VALUES (?, ?, 'SLACK', ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
    [sigB, userId, `${title} SLA miss flagged`],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'ops', 12, ?)`,
    [randomUUID(), id, sigA, `${title} warehouse delay.`],
  );
  db.rawRun(
    `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
     VALUES (?, ?, ?, 'sales', 14, ?)`,
    [randomUUID(), id, sigB, `${title} SLA miss.`],
  );
  return id;
}

export function talkCommit(userId: string, title: string, patternId?: string) {
  const sitId = seedReadySituation(userId, title, patternId);
  const created = talkToHustronix(userId, "Create the decision.", {
    action: "create_decision",
    focusId: sitId,
  });
  talkToHustronix(userId, "What else could be true?", { focusId: sitId, action: "hypotheses" });
  talkToHustronix(userId, "Instrumentation is OK.", { focusId: sitId, action: "instrumentation" });
  const executed = talkToHustronix(userId, "Execute it.", { focusId: sitId, action: "execute" });
  return {
    situationId: sitId,
    decisionId: created.decision_id || executed.decision_id,
    focusId: created.focus_id,
    executeAnswer: executed.answer,
  };
}

export function insertOutcomeRow(
  userId: string,
  patternId: string,
  result: string,
  decisionId = randomUUID(),
) {
  db.rawRun(
    `INSERT INTO decision_outcomes
      (id, tenant_id, decision_id, result, pattern_id, learning_applied, expected_json, actual_json)
     VALUES (?, ?, ?, ?, ?, 0, '{}', '{}')`,
    [randomUUID(), userId, decisionId, result, patternId],
  );
  return decisionId;
}

export { talkToHustronix, mutationCompleteDecision, mutationCreateDraftDecision, mutationReverseDecision };
export type { TalkActionId };
