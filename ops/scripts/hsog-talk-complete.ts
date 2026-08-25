/**
 * Complete Talk to Hustronix loop on the last intelligence tenant.
 *
 * ASK → UNDERSTAND → EVIDENCE → IMPACT → RECOMMEND → CREATE → VALIDATE → EXECUTE
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { repoRoot } from "../../apps/api/src/config.js";
import { talkToHustronix, type TalkActionId } from "../../apps/api/src/intelligence/situation-chat.js";

const user = db.getUser("hsog_cust_intel") as { id: string } | undefined;
if (!user) {
  console.error("No hsog_cust_intel tenant — run npm run hsog:customer-path:intelligence first.");
  process.exit(1);
}

type Step = { name: string; ok: boolean; answer: string; intent?: string; extra?: string };

const steps: Step[] = [];
let focusId: string | null = null;
let decisionId: string | null = null;

function run(name: string, question: string, action?: TalkActionId | null, check?: (t: ReturnType<typeof talkToHustronix>) => boolean) {
  const t = talkToHustronix(user!.id, question, { focusId, action: action || null });
  if (t.focus_id) focusId = t.focus_id;
  if (t.decision_id) decisionId = t.decision_id;
  const ok = check ? check(t) : t.grounded && t.answer.length > 40;
  steps.push({
    name,
    ok,
    intent: t.intent,
    answer: t.answer,
    extra: `focus=${t.focus_id || "—"} decision=${t.decision_id || "—"} actions=[${t.actions.map((a) => a.label).join("; ")}]`,
  });
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${name} (${t.intent})`);
  console.log(t.answer);
  if (t.actions.length) console.log("chips:", t.actions.map((a) => a.label).join(" | "));
  return t;
}

console.log("TALK TO HUSTRONIX — complete loop (Wave 0)");
console.log(`tenant=${user.id}`);

run("ASK / UNDERSTAND (company)", "What's going wrong in the company?");
run("SITUATION (Acme)", "What's happening with Acme?", null, (t) => /acme/i.test(t.answer) && !/ingestion outage/i.test(t.answer.slice(0, 120)));
run("EVIDENCE", "What evidence supports that?");
run("IMPACT", "Who is affected?");
run("RECOMMEND", "What should we do?");
run("CREATE DECISION", "Create the decision.", "create_decision", (t) => !!t.decision_id && /DRAFT|already exists|validate/i.test(t.answer));
run("HYPOTHESES", "What else could be true?", "hypotheses", (t) => /% —/.test(t.answer) || /hypothesis|explanation/i.test(t.answer));
run("INSTRUMENTATION", "Instrumentation is OK.", "instrumentation", (t) => /instrumentation confirmed|complete|execute/i.test(t.answer));
run("EXECUTE", "Execute it.", "execute", (t) => {
  if (!decisionId) return false;
  const row = db.getDecisionLedgerRow(decisionId);
  const n = (
    db.rawGet(`SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id = ?`, [decisionId]) as { c: number }[]
  )[0];
  return String(row?.status) === "ACTIVE" && Number(n?.c || 0) >= 1 && /ACTIVE/i.test(t.answer);
});

if (decisionId) {
  const tasks = db.rawGet(`SELECT task_id, status FROM execution_ledger WHERE decision_id = ?`, [
    decisionId,
  ]) as { task_id: string; status: string }[];
  for (const t of tasks) {
    if (t.status === "PENDING" || t.status === "BLOCKED") {
      db.transitionExecutionState(t.task_id, "ACTIVE", "talk-complete activate");
    }
    const after = (
      db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [t.task_id]) as { status: string }[]
    )[0];
    if (after?.status === "ACTIVE") {
      db.transitionExecutionState(t.task_id, "DONE", "talk-complete finish");
    }
  }
  const stillActive = String(db.getDecisionLedgerRow(decisionId)?.status) === "ACTIVE";
  steps.push({
    name: "FINISH TASKS",
    ok: stillActive && tasks.length >= 1,
    answer: stillActive
      ? `All ${tasks.length} task(s) DONE. Decision stayed ACTIVE (no auto-complete).`
      : `Expected ACTIVE after tasks DONE, got ${db.getDecisionLedgerRow(decisionId)?.status}`,
    extra: `decision=${decisionId} tasks=${tasks.length}`,
  });
  run("MARK AS DONE", "Mark as done.", "complete", (t) => {
    const row = db.getDecisionLedgerRow(decisionId!);
    const n = (
      db.rawGet(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [decisionId]) as {
        c: number;
      }[]
    )[0];
    return String(row?.status) === "COMPLETED" && Number(n?.c || 0) >= 1 && /COMPLETED/i.test(t.answer);
  });
}

const passed = steps.filter((s) => s.ok).length;
const md = [
  "TALK TO HUSTRONIX — COMPLETE LOOP (Wave 0)",
  "────────────────────────────────────────",
  `tenant: ${user.id}`,
  `passed: ${passed}/${steps.length}`,
  "",
  ...steps.flatMap((s) => [`### ${s.ok ? "✓" : "✗"} ${s.name}`, s.extra || "", "", s.answer, ""]),
].join("\n");

const dataOut = resolve(repoRoot, "data");
const docsOut = resolve(repoRoot, "docs", "hsog");
mkdirSync(dataOut, { recursive: true });
mkdirSync(docsOut, { recursive: true });
writeFileSync(resolve(docsOut, "hsog-talk-complete-report.md"), md + "\n");
writeFileSync(
  resolve(dataOut, "hsog-talk-complete-scorecard.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      user_id: user.id,
      passed,
      total: steps.length,
      decision_id: decisionId,
      steps: steps.map((s) => ({ name: s.name, ok: s.ok, intent: s.intent, extra: s.extra, answer: s.answer })),
    },
    null,
    2,
  ),
);

console.log(`\n${passed}/${steps.length} steps passed`);
console.log(`Wrote ${resolve(docsOut, "hsog-talk-complete-report.md")}`);
if (passed < steps.length) process.exit(1);
