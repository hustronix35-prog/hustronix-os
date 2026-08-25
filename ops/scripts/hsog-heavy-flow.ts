/**
 * Heavy company-flow: real provider ingest + concurrent executions + HSOG grades.
 *
 *   npx tsx ops/scripts/hsog-heavy-flow.ts
 *   npx tsx ops/scripts/hsog-heavy-flow.ts --observe-user spandan
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { mutationCommitDecision, mutationCreateDraftDecision, mutationTransitionExecution } from "../../apps/api/src/security/mutation-handlers.js";
import { reprocessUnenrichedSignals } from "../../apps/api/src/intelligence/index.js";
import { loadHsogBundle } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { ingestHsogViaProviders } from "../../apps/api/src/integrations/hsog/providerIngest.js";
import { PLAYBOOKS } from "../../apps/api/src/integrations/hsog/ingestHsog.js";
import {
  HSOG_QUESTIONS,
  answerFromLedger,
  loadCausalGraph,
  scoreHsogAnswer,
} from "../../apps/api/src/integrations/hsog/gradeAnswers.js";
import { repoRoot } from "../../apps/api/src/config.js";

const FLOW_USER = "hsog_flow";

db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return "";
  return v;
}

function observeUser(username: string) {
  const user = db.getUser(username) || db.getUserById(username);
  if (!user) return { username, error: "not found" };
  const userId = (user as { id: string }).id;
  const bySource = db.rawGet(
    `SELECT source, COUNT(*) AS n FROM external_signals WHERE user_id = ? GROUP BY source ORDER BY n DESC`,
    [userId],
  ) as { source: string; n: number }[];
  const bySubtype = db.rawGet(
    `SELECT COALESCE(source_subtype,'(none)') AS subtype, COUNT(*) AS n
     FROM external_signals WHERE user_id = ? GROUP BY source_subtype ORDER BY n DESC LIMIT 20`,
    [userId],
  ) as { subtype: string; n: number }[];
  const exec = db.rawGet(
    `SELECT e.status, COUNT(*) AS n
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ?
     GROUP BY e.status`,
    [userId],
  ) as { status: string; n: number }[];
  const decisions = db.rawGet(
    `SELECT status, COUNT(*) AS n FROM decision_ledger WHERE user_id = ? GROUP BY status`,
    [userId],
  ) as { status: string; n: number }[];
  return { username, userId, signalsBySource: bySource, subtypes: bySubtype, executions: exec, decisions };
}

function ensureFlowUser(): string {
  let user = db.getUser(FLOW_USER) as { id: string } | undefined;
  if (!user) {
    const id = `hsogflow_${Date.now().toString(36)}`.slice(0, 32);
    db.createUser(id, FLOW_USER, hashPassword("hsog-flow-local"), "hsog.flow@hustronix.io");
    user = db.getUser(FLOW_USER) as { id: string };
  }
  resolveTenantContext(user.id);
  return user.id;
}

function bumpOwnerCapacity(owners: string[]) {
  for (const owner of owners) {
    db.rawRun(
      `INSERT INTO owner_reputation (owner, failed_executions, successful_executions, reputation_modifier, is_locked)
       VALUES (?, 0, 2, 5.0, 0)
       ON CONFLICT(owner) DO UPDATE SET reputation_modifier = 5.0, is_locked = 0`,
      [owner],
    );
  }
}

async function runConcurrentExecutions(userId: string, scenarioIds: string[]) {
  const owners = ["Imani", "Renata", "Elena", "Jordan", "Ethan", "Omar", "Noor", "Marcus", "Helen", "Leah", "Priya", "Skye", "Chris", "Caleb"];
  bumpOwnerCapacity(owners);
  const created: string[] = [];
  for (const sid of scenarioIds) {
    const play = PLAYBOOKS[sid];
    if (!play) continue;
    const { id } = mutationCreateDraftDecision(userId, {
      vow: `[flow] ${play.vow}`,
      expected_outcomes: [{ metric: sid, target: "Operate like a real company week" }],
      constraints: play.constraints,
      tasks: play.tasks.map((t) => ({
        type: "ACTION",
        owner: t.owner,
        weight: 1,
        success_condition: t.success_condition,
      })),
    });
    if (db.getDecisionTenant(id) === userId) created.push(id);
  }

  if (created[0]) {
    try {
      mutationCommitDecision(userId, created[0], "HSOG heavy flow — activate primary scenario");
    } catch (e) {
      console.warn("[heavy-flow] activate:", e instanceof Error ? e.message : e);
    }
  }

  const tasks = db.rawGet(
    `SELECT e.task_id, e.owner, e.status
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ? AND e.status = 'PENDING'`,
    [userId],
  ) as { task_id: string; owner: string; status: string }[];

  const t0 = Date.now();
  const activateResults = await Promise.all(
    tasks.map((t) =>
      Promise.resolve().then(() => {
        try {
          return { taskId: t.task_id, owner: t.owner, ...mutationTransitionExecution(userId, { taskId: t.task_id, newState: "ACTIVE", reason: "Sprint parallel start" }) };
        } catch (e) {
          return { taskId: t.task_id, owner: t.owner, status: "ERROR", error: e instanceof Error ? e.message : String(e) };
        }
      }),
    ),
  );
  const activateMs = Date.now() - t0;

  const activeNow = activateResults.filter((r) => String((r as { status?: string }).status) === "ACTIVE");
  const doneBurst = await Promise.all(
    activeNow.slice(0, Math.min(8, activeNow.length)).map((r) =>
      Promise.resolve().then(() => {
        try {
          return mutationTransitionExecution(userId, {
            taskId: (r as { taskId: string }).taskId,
            newState: "DONE",
            reason: "Parallel close-out after evidence check",
          });
        } catch (e) {
          return { status: "ERROR", error: e instanceof Error ? e.message : String(e) };
        }
      }),
    ),
  );

  const byStatus: Record<string, number> = {};
  for (const r of activateResults) {
    const s = String((r as { status?: string }).status || "UNKNOWN");
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  const doneOk = doneBurst.filter((r) => String((r as { status?: string }).status) === "DONE").length;

  return {
    decisionsCreated: created.length,
    tasksConsidered: tasks.length,
    activateMs,
    activateByStatus: byStatus,
    doneInParallel: doneOk,
    ownersInFlight: [...new Set(tasks.map((t) => t.owner))],
  };
}

async function main() {
  const observe = arg("--observe-user") || "spandan";
  const observed = observeUser(observe);

  const userId = ensureFlowUser();
  const { path, bundle } = loadHsogBundle(arg("--bundle") || "");
  const ctx = resolveTenantContext(userId);

  const scenarioIds = [...new Set((bundle.events || []).map((e) => e.scenario_id))];
  const exec = await runConcurrentExecutions(userId, scenarioIds);
  const ingestStarted = Date.now();
  const channels = ingestHsogViaProviders(userId, bundle);
  const ingestMs = Date.now() - ingestStarted;
  const enriched = await reprocessUnenrichedSignals(userId, 250);

  const causal = loadCausalGraph();
  const answers = [];
  const grades = [];
  for (const q of HSOG_QUESTIONS) {
    const ans = await answerFromLedger(userId, q, causal);
    answers.push(ans);
    grades.push({ ...scoreHsogAnswer(q, ans, causal), retrieved: ans.retrieved, recommended_next_action: ans.recommended_next_action });
  }
  const avg = grades.reduce((s, g) => s + g.score_0_to_4, 0) / Math.max(grades.length, 1);
  const passed = grades.filter((g) => g.passed).length;

  const sourceMix = db.rawGet(
    `SELECT source, COUNT(*) AS n FROM external_signals WHERE user_id = ? GROUP BY source ORDER BY n DESC`,
    [userId],
  ) as { source: string; n: number }[];

  const report = {
    generated_at: new Date().toISOString(),
    observe_existing: observed,
    heavy_flow: {
      user: FLOW_USER,
      userId,
      orgId: ctx.orgId,
      bundle: path,
      ingest_ms: ingestMs,
      channels,
      source_mix: sourceMix,
      enriched,
      executions: exec,
    },
    accuracy: {
      questions: grades.length,
      passed,
      average_score_0_to_4: Math.round(avg * 100) / 100,
      letter:
        avg >= 3.5 ? "A" : avg >= 2.5 ? "B" : avg >= 1.5 ? "C" : avg >= 0.75 ? "D" : "F",
      results: grades,
    },
    answers,
  };

  const outDir = resolve(repoRoot, "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "hsog-heavy-scorecard.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nScorecard → ${outPath}`);
  console.log(
    `Grade ${report.accuracy.letter}: ${passed}/${grades.length} passed, avg ${report.accuracy.average_score_0_to_4}/4`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
