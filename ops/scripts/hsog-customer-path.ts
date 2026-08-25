/**
 * HSOG customer-path validation — same ingest seam a real customer would use.
 * Regression suite for blind ingest modes. Primary OS evaluator is
 * `npm run hsog:operating-loop`.
 *
 * Ground truth stays offline. Blind artifacts → provider transforms → ingestExternal.
 * No event_type→playbook, no finalizeExecuted, no seeded deps.
 *
 *   npm run hsog:customer-path
 *   npm run hsog:customer-path -- --mode chrono
 *   npm run hsog:customer-path -- --mode stream
 *   npm run hsog:customer-path -- --mode sources
 *   npm run hsog:customer-path -- --mode isolated
 *   npm run hsog:customer-path -- --mode noise
 *   npm run hsog:customer-path -- --mode conflict
 *   npm run hsog:customer-path -- --mode ooo
 *   npm run hsog:customer-path -- --mode dup
 *   npm run hsog:customer-path -- --mode all
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { loadHsogBundle, resolveHsogBundlePath } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { repoRoot } from "../../apps/api/src/config.js";
import {
  defaultHsogDataDir,
  exportDualCorpus,
  filterBlindByScenario,
  filterBlindBySources,
  injectConflicts,
  injectNoise,
  outOfOrderCopy,
  type BlindCustomerBundle,
  type HsogGroundTruth,
} from "../../apps/api/src/integrations/hsog/customerPathCorpus.js";
import {
  ingestBlindBundle,
  ingestChronological,
  type CustomerIngestStats,
} from "../../apps/api/src/integrations/hsog/customerPathIngest.js";
import { evaluateCustomerPath } from "../../apps/api/src/integrations/hsog/customerPathEval.js";
import {
  buildScenarioTiming,
  evaluateIntelligenceLead,
} from "../../apps/api/src/integrations/hsog/intelligenceLeadEval.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

function seedRosterFromBundle(userId: string, gt: HsogGroundTruth) {
  for (const p of gt.people || []) {
    const email = (p.email || `${p.id}@hustronix.io`).toLowerCase();
    try {
      db.upsertTeamRosterByEmail(userId, {
        name: p.name,
        email,
        role: p.role || "Member",
        team: p.department || "General",
        capacity: "40h / week",
        slackId: p.first_name || p.name.split(/\s+/)[0],
      });
    } catch {
      /* ignore */
    }
  }
}

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
    `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situation_events WHERE user_id = ?`,
    `DELETE FROM situations WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
  ]) {
    try {
      db.rawRun(sql, [userId]);
    } catch {
      /* optional */
    }
  }
  db.rawRun(
    `DELETE FROM external_event_dedup
     WHERE tenant_key = 'customer_path' OR external_id LIKE 'cust:%'`,
  );
}

type RunResult = {
  mode: string;
  label: string;
  ingest: CustomerIngestStats;
  report_md: string;
  scenarios_detected: string;
  extra?: Record<string, unknown>;
};

async function runOnce(
  username: string,
  mode: string,
  label: string,
  blind: BlindCustomerBundle,
  gt: HsogGroundTruth,
  ingestFn: (userId: string) => CustomerIngestStats,
): Promise<RunResult> {
  const userId = ensureUser(username);
  wipeTenant(userId);
  seedRosterFromBundle(userId, gt);
  const ingest = ingestFn(userId);
  const report = await evaluateCustomerPath(userId, gt, mode);
  console.log("\n" + report.markdown + "\n");
  return {
    mode,
    label,
    ingest,
    report_md: report.markdown,
    scenarios_detected: report.scenarios_detected,
    extra: {
      evidence_accuracy: report.evidence_accuracy,
      dependency_accuracy: report.dependency_accuracy,
      owner_accuracy: report.owner_accuracy,
      retrieval: report.retrieval,
      false_positives: report.false_positives,
      signals: report.signals,
      decisions: report.decisions,
      execution: report.execution,
      detection: report.detection,
    },
  };
}

async function main() {
  const mode = (arg("--mode") || "chrono").toLowerCase();
  const throughDay = Number(arg("--through-day") || "132");
  const sourcePath = resolveHsogBundlePath(arg("--bundle") || "");
  const { path: bundlePath, bundle } = loadHsogBundle(arg("--bundle") || "");
  const outDir = defaultHsogDataDir(repoRoot);
  const { groundTruth, blind } = exportDualCorpus(bundle, bundlePath || sourcePath, outDir);

  console.log(`HSOG customer-path suite`);
  console.log(`Source (labeled, offline): ${bundlePath || sourcePath}`);
  console.log(`Blind artifacts: ${blind.artifacts.length} · scenarios in GT: ${groundTruth.scenarios.length}`);
  console.log(`Mode: ${mode} · through-day: ${throughDay}`);
  console.log(`Rules: no playbooks · no finalizeExecuted · no scenario meta in OS\n`);

  const results: RunResult[] = [];
  const dataOut = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "hsog");
  mkdirSync(dataOut, { recursive: true });
  mkdirSync(docsOut, { recursive: true });

  const modes =
    mode === "all"
      ? ["intelligence", "chrono", "stream", "sources", "isolated", "noise", "conflict", "ooo", "dup"]
      : [mode];

  for (const m of modes) {
    if (m === "intelligence") {
      const userId = ensureUser("hsog_cust_intel");
      wipeTenant(userId);
      seedRosterFromBundle(userId, groundTruth);
      console.log("\n=== Intelligence lead-time (blind chrono) ===\n");
      const ingest = ingestChronological(userId, blind, { throughDay, detectEveryDays: 1 });
      const timing = buildScenarioTiming(bundle);
      const lead = evaluateIntelligenceLead(userId, groundTruth, timing, ingest.detection_timeline);
      console.log(lead.markdown + "\n");
      writeFileSync(resolve(docsOut, "hsog-intelligence-lead-report.md"), lead.markdown + "\n");
      writeFileSync(
        resolve(dataOut, "hsog-intelligence-lead-scorecard.json"),
        JSON.stringify(
          {
            ...lead,
            ingest: {
              attempted: ingest.attempted,
              inserted: ingest.inserted,
              duplicates: ingest.duplicates,
              errors: ingest.errors,
              by_source: ingest.by_source,
            },
            detection_timeline: ingest.detection_timeline,
            timing,
          },
          null,
          2,
        ),
      );
      results.push({
        mode: "intelligence",
        label: "Intelligence lead-time / synthesis / action",
        ingest,
        report_md: lead.markdown,
        scenarios_detected: `${lead.scenarios_detected}/${lead.scenarios_total}`,
        extra: {
          avg_lead_vs_declaration: lead.avg_lead_vs_declaration,
          rows: lead.rows,
          detection_timeline: ingest.detection_timeline,
        },
      });
    } else if (m === "chrono") {
      results.push(
        await runOnce(
          "hsog_cust_chrono",
          "chrono",
          "Chronological day-by-day",
          blind,
          groundTruth,
          (uid) => ingestChronological(uid, blind, { throughDay, detectEveryDays: 1 }),
        ),
      );
    } else if (m === "stream") {
      results.push(
        await runOnce(
          "hsog_cust_stream",
          "stream",
          "Real-time stream (per-event cadence)",
          blind,
          groundTruth,
          (uid) =>
            ingestBlindBundle(uid, blind, {
              order: "timestamp",
              stream: true,
              throughDay,
            }),
        ),
      );
    } else if (m === "sources") {
      const combos: { label: string; sources: string[] }[] = [
        { label: "Slack only", sources: ["slack"] },
        { label: "Jira only", sources: ["jira"] },
        { label: "Slack + Jira", sources: ["slack", "jira"] },
        { label: "Slack + Jira + Meetings", sources: ["slack", "jira", "meeting"] },
        { label: "All sources", sources: [...new Set(blind.artifacts.map((a) => a.source))] },
      ];
      const ablation: Array<{ label: string; detected: string; inserted: number }> = [];
      for (const c of combos) {
        const filtered = filterBlindBySources(blind, c.sources);
        const r = await runOnce(
          `hsog_cust_src_${c.sources.join("_").slice(0, 20)}`,
          "sources",
          c.label,
          filtered,
          groundTruth,
          (uid) => ingestChronological(uid, filtered, { throughDay, detectEveryDays: 2 }),
        );
        results.push(r);
        ablation.push({
          label: c.label,
          detected: r.scenarios_detected,
          inserted: r.ingest.inserted,
        });
      }
      console.log("\nSource ablation summary");
      console.log("| Sources | Detection | Inserted |");
      console.log("|---|---:|---:|");
      for (const a of ablation) {
        console.log(`| ${a.label} | ${a.detected} | ${a.inserted} |`);
      }
      writeFileSync(resolve(dataOut, "hsog-customer-path-sources.json"), JSON.stringify(ablation, null, 2));
    } else if (m === "isolated") {
      for (const sc of groundTruth.scenarios) {
        const filtered = filterBlindByScenario(blind, groundTruth, sc.id);
        results.push(
          await runOnce(
            `hsog_cust_iso_${sc.id.slice(0, 18)}`,
            "isolated",
            `Isolated: ${sc.id}`,
            filtered,
            groundTruth,
            (uid) => ingestChronological(uid, filtered, { throughDay, detectEveryDays: 1 }),
          ),
        );
      }
    } else if (m === "noise") {
      const noisy = injectNoise(blind, { noiseRatio: 0.8 });
      results.push(
        await runOnce(
          "hsog_cust_noise",
          "noise",
          "80% ambient noise + serious signals",
          noisy,
          groundTruth,
          (uid) => ingestChronological(uid, noisy, { throughDay, detectEveryDays: 2 }),
        ),
      );
    } else if (m === "conflict") {
      const conf = injectConflicts(blind);
      results.push(
        await runOnce(
          "hsog_cust_conflict",
          "conflict",
          "Conflicting launch narratives",
          conf,
          groundTruth,
          (uid) => ingestChronological(uid, conf, { throughDay, detectEveryDays: 1 }),
        ),
      );
    } else if (m === "ooo") {
      const ooo = outOfOrderCopy(blind);
      results.push(
        await runOnce(
          "hsog_cust_ooo",
          "ooo",
          "Out-of-order ingest (timestamps preserved)",
          ooo,
          groundTruth,
          (uid) =>
            ingestBlindBundle(uid, ooo, {
              order: "as_is",
              throughDay,
              detect: true,
            }),
        ),
      );
    } else if (m === "dup") {
      const userId = ensureUser("hsog_cust_dup");
      wipeTenant(userId);
      seedRosterFromBundle(userId, groundTruth);
      const first = ingestChronological(userId, blind, { throughDay, detectEveryDays: 2 });
      const second = ingestChronological(userId, blind, { throughDay, detectEveryDays: 2 });
      const report = await evaluateCustomerPath(userId, groundTruth, "dup");
      const dupOk = second.inserted === 0 && second.duplicates >= first.inserted * 0.9;
      console.log("\n" + report.markdown);
      console.log(
        `\nDuplicate ingest: run1 inserted=${first.inserted} · run2 inserted=${second.inserted} duplicates=${second.duplicates} · ${dupOk ? "PASS" : "FAIL"}`,
      );
      results.push({
        mode: "dup",
        label: "Duplicate corpus re-ingest",
        ingest: second,
        report_md: report.markdown,
        scenarios_detected: report.scenarios_detected,
        extra: {
          run1: first,
          run2: second,
          duplicate_pass: dupOk,
          decisions: report.decisions,
        },
      });
    } else {
      console.error(`Unknown mode: ${m}`);
      process.exit(1);
    }
  }

  const scorecard = {
    generated_at: new Date().toISOString(),
    architecture: "customer_path",
    rules: [
      "blind input only",
      "production ingestExternal / transforms",
      "no event_type→playbook",
      "no finalizeExecuted",
      "ground truth never ingested",
    ],
    through_day: throughDay,
    results: results.map((r) => ({
      mode: r.mode,
      label: r.label,
      scenarios_detected: r.scenarios_detected,
      ingest: r.ingest,
      extra: r.extra,
    })),
  };

  writeFileSync(resolve(dataOut, "hsog-customer-path-scorecard.json"), JSON.stringify(scorecard, null, 2));
  const md = [
    "# Hustronix HSOG customer-path report",
    "",
    `Generated: ${scorecard.generated_at}`,
    "",
    "## Rules",
    "",
    ...scorecard.rules.map((r) => `- ${r}`),
    "",
    "## Runs",
    "",
    ...results.map((r) => [`### ${r.label} (\`${r.mode}\`)`, "", "```", r.report_md, "```", ""].join("\n")),
  ].join("\n");
  writeFileSync(resolve(docsOut, "hsog-customer-path-report.md"), md);
  console.log(`\nWrote ${resolve(dataOut, "hsog-customer-path-scorecard.json")}`);
  console.log(`Wrote ${resolve(docsOut, "hsog-customer-path-report.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
