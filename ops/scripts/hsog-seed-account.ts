/**
 * Seed a real login account (default: spandan) with ~4 months of HSOG company data.
 * Chronological day loop + executed look for Decide / Execute / Teams / Analytics.
 *
 *   npm run hsog:seed-spandan
 *   npx tsx ops/scripts/hsog-seed-account.ts --user spandan --through-day 132
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { loadHsogBundle } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { runDayTaste, finalizeExecutedLook } from "../../apps/api/src/integrations/hsog/daySim.js";
import { runHsogIngest } from "../../apps/api/src/integrations/hsog/ingestHsog.js";
import { createOrgDependency } from "../../apps/api/src/org/intelligence.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { repoRoot } from "../../apps/api/src/config.js";

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

function wipeTenant(userId: string) {
  const decIds = `SELECT id FROM decision_ledger WHERE user_id = ?`;
  db.rawRun(
    `UPDATE external_signals SET linked_execution_id = NULL, related_decision_id = NULL, state = 'UNVERIFIED'
     WHERE user_id = ?`,
    [userId],
  );
  db.rawRun(`DELETE FROM clarification_requests WHERE user_id = ?`, [userId]);
  try {
    db.rawRun(`DELETE FROM action_ledger WHERE decision_id IN (${decIds})`, [userId]);
  } catch {
    /* table may be empty / missing FK */
  }
  try {
    db.rawRun(`DELETE FROM decision_outcomes WHERE decision_id IN (${decIds})`, [userId]);
  } catch {
    /* optional */
  }
  try {
    db.rawRun(`DELETE FROM conflicts WHERE decision_id IN (${decIds})`, [userId]);
  } catch {
    /* optional */
  }
  try {
    db.rawRun(`DELETE FROM simulation_runs WHERE decision_id IN (${decIds})`, [userId]);
  } catch {
    /* optional */
  }
  try {
    db.rawRun(`UPDATE beliefs SET source_decision_id = NULL WHERE source_decision_id IN (${decIds})`, [userId]);
  } catch {
    /* optional */
  }
  try {
    db.rawRun(`DELETE FROM learning_log WHERE user_id = ?`, [userId]);
  } catch {
    /* optional */
  }
  try {
    db.rawRun(`DELETE FROM org_dependencies WHERE user_id = ?`, [userId]);
  } catch {
    /* optional */
  }
  try {
    db.rawRun(`DELETE FROM notifications WHERE user_id = ?`, [userId]);
  } catch {
    /* optional */
  }
  db.rawRun(`DELETE FROM execution_ledger WHERE decision_id IN (${decIds})`, [userId]);
  db.rawRun(`DELETE FROM decision_ledger WHERE user_id = ?`, [userId]);
  db.rawRun(`DELETE FROM external_signals WHERE user_id = ?`, [userId]);
  db.rawRun(
    `DELETE FROM external_event_dedup
     WHERE external_id LIKE 'hsog:%'
        OR external_id LIKE 'hsog-%'
        OR tenant_key = 'hsog'
        OR tenant_key LIKE 'hsog:%'`,
  );
}

function seedCrossTeamDependencies(userId: string) {
  const edges: Array<{
    fromTeam: string;
    fromWork: string;
    toTeam: string;
    toWork: string;
    status: "ON_TRACK" | "AT_RISK" | "DELAYED";
  }> = [
    {
      fromTeam: "engineering backend",
      fromWork: "Fix SignalGrid data delays",
      toTeam: "customer success",
      toWork: "Acme renewal recovery plan",
      status: "AT_RISK",
    },
    {
      fromTeam: "security",
      fromWork: "Urgent audit paperwork",
      toTeam: "sales",
      toWork: "Northstar / SentryLine deal approval",
      status: "DELAYED",
    },
    {
      fromTeam: "engineering",
      fromWork: "NexusAI proof trail",
      toTeam: "product",
      toWork: "Hold NexusAI 2.0 launch",
      status: "ON_TRACK",
    },
    {
      fromTeam: "qa support",
      fromWork: "FlowOps approval testing",
      toTeam: "product",
      toWork: "Keep new feature off outside beta",
      status: "ON_TRACK",
    },
    {
      fromTeam: "finance",
      fromWork: "Redo Q3 forecast",
      toTeam: "executive",
      toWork: "Brief on coverage gaps",
      status: "ON_TRACK",
    },
    {
      fromTeam: "hr ops",
      fromWork: "Hiring freeze policy",
      toTeam: "security",
      toWork: "Compliance analyst and ops exceptions",
      status: "ON_TRACK",
    },
  ];
  for (const e of edges) createOrgDependency(userId, e);
}

async function main() {
  if (has("--help") || has("-h")) {
    console.log(`Usage: npx tsx ops/scripts/hsog-seed-account.ts --user spandan [options]
  --through-day N   default 132 (~4 months of corpus)
  --no-wipe         keep existing ledger rows
  --bundle PATH     os_ingest override`);
    return;
  }

  const userArg = arg("--user") || "spandan";
  const user = db.getUser(userArg) || db.getUserById(userArg);
  if (!user) {
    console.error(`User not found: ${userArg}`);
    process.exit(1);
  }
  const userId = (user as { id: string }).id;
  resolveTenantContext(userId);
  db.updateSetting(userId, "org.owner_user_id", userId);
  db.updateSetting(userId, "org.role", "owner");

  if (!has("--no-wipe")) wipeTenant(userId);

  const { path, bundle } = loadHsogBundle(arg("--bundle") || "");
  const throughDay = Number(arg("--through-day") || 132);

  /** Org profile settings for Teams / Analytics labels. */
  await runHsogIngest({ ...bundle, events: [] }, path, {
    userId,
    decisions: false,
    enrich: false,
    activateScenarioId: null,
    startSprint: false,
    orgProfile: true,
  });

  console.log(`Seeding ${userArg} (${userId}) through day ${throughDay}…`);
  const report = await runDayTaste({
    userId,
    bundle,
    bundlePath: path,
    throughDay,
    includeQuietDays: false,
    breaks: false,
    finalizeExecuted: true,
  });

  seedCrossTeamDependencies(userId);
  /** Ensure blind situations + deps exist, then re-finalize executed look for UI. */
  runSituationDetection(userId);
  finalizeExecutedLook(userId);

  const fin = { note: "finalize applied inside runDayTaste" };
  const snap = {
    signals: db.rawGet(
      `SELECT state, COUNT(1) AS n FROM external_signals WHERE user_id = ? GROUP BY state`,
      [userId],
    ),
    decisions: db.rawGet(
      `SELECT status, COUNT(1) AS n FROM decision_ledger WHERE user_id = ? GROUP BY status`,
      [userId],
    ),
    executions: db.rawGet(
      `SELECT e.status, COUNT(1) AS n FROM execution_ledger e
       INNER JOIN decision_ledger d ON d.id = e.decision_id
       WHERE d.user_id = ? GROUP BY e.status`,
      [userId],
    ),
    finalize: fin,
    grade: report.grade,
    accuracy: report.accuracy,
  };

  const outDir = resolve(repoRoot, "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `hsog-seed-${userArg}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ user: userArg, userId, throughDay, bundle: path, snap, report }, null, 2),
  );

  console.log(JSON.stringify(snap, null, 2));
  console.log(`\nSeeded ${userArg}: ${report.days_simulated} days · grade ${report.grade.letter} ${report.grade.overall_0_to_100}`);
  console.log(`Wrote ${outPath}`);
  console.log(`
Log into os-ui as ${userArg}:
  Home / Signals / Decide / Tasks / Teams / Analytics / Company Brain
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
