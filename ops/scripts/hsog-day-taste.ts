/**
 * Day-basis heavy taste of Decision OS with HSOG (2–3 months of sim time).
 * Regression / replay harness — not the primary intelligence definition.
 * Primary evaluator: npm run hsog:operating-loop
 *
 *   npm run hsog:day-taste
 *   npx tsx ops/scripts/hsog-day-taste.ts --through-day 100 --quiet-days
 *   npx tsx ops/scripts/hsog-day-taste.ts --observe-user spandan
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { loadHsogBundle } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { runDayTaste } from "../../apps/api/src/integrations/hsog/daySim.js";
import { repoRoot } from "../../apps/api/src/config.js";

const DAY_USER = "hsog_days";

/** Deterministic enrich during chronological taste — do not burn coordinator tokens. */
process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";

db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

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

function ensureDayUser(): string {
  let user = db.getUser(DAY_USER) as { id: string } | undefined;
  if (!user) {
    const id = `hsogdays_${Date.now().toString(36)}`.slice(0, 32);
    db.createUser(id, DAY_USER, hashPassword("hsog-days-local"), "hsog.days@hustronix.io");
    user = db.getUser(DAY_USER) as { id: string };
  }
  resolveTenantContext(user.id);
  return user.id;
}

function wipeTenantSignals(userId: string) {
  /** Fresh chronological run — wipe prior day-taste ledger for this tenant only. */
  const decIds = `SELECT id FROM decision_ledger WHERE user_id = ?`;
  db.rawRun(
    `UPDATE external_signals SET linked_execution_id = NULL, related_decision_id = NULL, state = 'UNVERIFIED'
     WHERE user_id = ?`,
    [userId],
  );
  db.rawRun(`DELETE FROM clarification_requests WHERE user_id = ?`, [userId]);
  db.rawRun(`DELETE FROM action_ledger WHERE decision_id IN (${decIds})`, [userId]);
  db.rawRun(`DELETE FROM decision_outcomes WHERE decision_id IN (${decIds})`, [userId]);
  db.rawRun(`DELETE FROM conflicts WHERE decision_id IN (${decIds})`, [userId]);
  db.rawRun(`DELETE FROM simulation_runs WHERE decision_id IN (${decIds})`, [userId]);
  db.rawRun(`UPDATE beliefs SET source_decision_id = NULL WHERE source_decision_id IN (${decIds})`, [userId]);
  db.rawRun(`DELETE FROM learning_log WHERE user_id = ?`, [userId]);
  db.rawRun(`DELETE FROM execution_ledger WHERE decision_id IN (${decIds})`, [userId]);
  db.rawRun(`DELETE FROM decision_ledger WHERE user_id = ?`, [userId]);
  db.rawRun(`DELETE FROM external_signals WHERE user_id = ?`, [userId]);
  /**
   * Provider ingest uses global external_event_dedup. Without clearing hsog:* keys,
   * a second day-taste run reports all duplicates and the ledger stays empty.
   */
  db.rawRun(
    `DELETE FROM external_event_dedup
     WHERE external_id LIKE 'hsog:%'
        OR external_id LIKE 'hsog-%'
        OR tenant_key = 'hsog'
        OR tenant_key LIKE 'hsog:%'`,
  );
}

function writeMarkdownReport(report: Awaited<ReturnType<typeof runDayTaste>>, outPath: string) {
  const lines: string[] = [];
  lines.push(`# HSOG day-taste report`);
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Tenant: \`${report.userId}\` · through day **${report.through_day}** (${report.days_simulated} ticks)`);
  lines.push(`Bundle: \`${report.bundle_path}\``);
  lines.push("");
  lines.push(`## Overall grade: **${report.grade.letter}** (${report.grade.overall_0_to_100}/100)`);
  lines.push("");
  lines.push(report.grade.verdict);
  lines.push("");
  lines.push("| Component | Score |");
  lines.push("|---|---:|");
  for (const [k, v] of Object.entries(report.grade.components)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push("");
  lines.push("## Retrieval accuracy (HSOG rubric)");
  lines.push("");
  lines.push(
    `Letter **${report.accuracy.letter}** · avg ${report.accuracy.average_score_0_to_4}/4 · ${report.accuracy.passed}/${report.accuracy.total} passed`,
  );
  lines.push("");
  lines.push("## Day fidelity & decisions");
  lines.push("");
  lines.push(
    `- Event days with ingest: ${report.day_fidelity.days_with_ingest}/${report.day_fidelity.event_days}`,
  );
  lines.push(
    `- Trigger → commit: ${report.day_fidelity.decisions_committed_on_or_after_trigger}/${report.day_fidelity.trigger_events} (${report.day_fidelity.decision_on_trigger_pct}%)`,
  );
  lines.push(
    `- Active vows: ${report.execution_health.active_vows} · executions: ${JSON.stringify(report.execution_health.by_status)}`,
  );
  lines.push(
    `- Corpus alive (GRACE/LINKED/UNVERIFIED): ${report.execution_health.corpus_grace_or_linked} · wrongly killed: ${report.execution_health.corpus_killed}`,
  );
  lines.push("");
  lines.push("## Break attempts");
  lines.push("");
  lines.push(`Passed ${report.breaks.passed}/${report.breaks.total}`);
  if (report.breaks.failed.length) {
    lines.push("");
    lines.push("### Failed (system broke or soft-fail)");
    for (const b of report.breaks.failed) {
      lines.push(`- **${b.name}**: expected ${b.expected}, got ${b.actual} — ${b.detail}`);
    }
  }
  lines.push("");
  lines.push("## Day journal (condensed)");
  lines.push("");
  for (const j of report.journal) {
    if (!j.events.length && !j.decisions.length && !j.breaks.length) continue;
    lines.push(`### Day ${j.day} (${j.date})`);
    for (const e of j.events) {
      lines.push(`- **Event** \`${e.event_type}\` [${e.scenario_id}]: ${e.summary}`);
    }
    for (const s of j.suggestions.slice(0, 4)) {
      lines.push(`- *Suggestion:* ${s}`);
    }
    for (const d of j.decisions) {
      lines.push(`- **Decision ${d.action}** (${d.scenario_id}): ${d.detail}`);
    }
    if (j.executions.activated || j.executions.done || j.executions.blocked) {
      lines.push(
        `- Executions: +ACTIVE ${j.executions.activated}, DONE ${j.executions.done}, BLOCKED ${j.executions.blocked}`,
      );
    }
    for (const b of j.breaks) {
      lines.push(`- Break \`${b.name}\`: ${b.passed ? "PASS" : "FAIL"} (${b.actual}) — ${b.detail}`);
    }
    lines.push("");
  }
  writeFileSync(outPath, lines.join("\n"), "utf8");
}

async function main() {
  if (has("--help") || has("-h")) {
    console.log(`Usage: npx tsx ops/scripts/hsog-day-taste.ts [options]
  --through-day N     Sim day ceiling (default min(90, max event day) ≈ 3 months)
  --quiet-days        Also tick days with no corpus events
  --no-breaks         Skip adversarial probes
  --no-wipe           Keep prior hsog_days ledger
  --bundle PATH       os_ingest.json override
  --observe-user NAME Snapshot another tenant after run`);
    return;
  }

  const userId = ensureDayUser();
  if (!has("--no-wipe")) wipeTenantSignals(userId);

  const { path, bundle } = loadHsogBundle(arg("--bundle") || "");
  const throughRaw = arg("--through-day");
  const throughDay = throughRaw ? Number(throughRaw) : undefined;

  console.log(`Day-taste tenant=${DAY_USER} (${userId}) bundle=${path}`);
  const report = await runDayTaste({
    userId,
    bundle,
    bundlePath: path,
    throughDay,
    includeQuietDays: has("--quiet-days"),
    breaks: !has("--no-breaks"),
  });

  const outDir = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "hsog");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(docsOut, { recursive: true });
  const jsonPath = resolve(outDir, "hsog-day-taste-scorecard.json");
  const mdPath = resolve(docsOut, "hsog-day-taste-report.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeMarkdownReport(report, mdPath);

  const summary = {
    grade: report.grade,
    accuracy: {
      letter: report.accuracy.letter,
      avg: report.accuracy.average_score_0_to_4,
      passed: `${report.accuracy.passed}/${report.accuracy.total}`,
    },
    day_fidelity: report.day_fidelity,
    execution_health: report.execution_health,
    breaks: { passed: report.breaks.passed, total: report.breaks.total, failed: report.breaks.failed.length },
    days_simulated: report.days_simulated,
    json: jsonPath,
    report: mdPath,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nOverall ${report.grade.letter} ${report.grade.overall_0_to_100}/100 — ${report.grade.verdict}`);
  console.log(`Scorecard → ${jsonPath}`);
  console.log(`Narrative → ${mdPath}`);

  if (arg("--observe-user")) {
    const name = arg("--observe-user") || "spandan";
    const u = db.getUser(name) || db.getUserById(name);
    if (u) {
      const id = (u as { id: string }).id;
      const states = db.rawGet(
        `SELECT state, COUNT(1) AS n FROM external_signals WHERE user_id = ? GROUP BY state`,
        [id],
      );
      console.log(`observe ${name}:`, states);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
