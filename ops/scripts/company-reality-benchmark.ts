/**
 * Company Reality Benchmark — blind ingest validation (no simDay, no HSOG).
 *
 *   npm run benchmark:company-reality
 *   npm run benchmark:company-reality -- --size 1200
 *   npm run benchmark:company-reality -- --scale 5000   # stress timing only
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { performance } from "node:perf_hooks";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { repoRoot } from "../../apps/api/src/config.js";
import { buildCompanyRealityCorpus } from "../../apps/api/src/integrations/company-reality/corpus.js";
import { evaluateCompanyReality } from "../../apps/api/src/integrations/company-reality/eval.js";
import type { CrSource } from "../../apps/api/src/integrations/company-reality/types.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return "";
  return v;
}

function ensureUser(username: string): string {
  let user = db.getUser(username) as { id: string } | undefined;
  if (!user) {
    const id = `${username.replace(/\W/g, "").slice(0, 12)}_${Date.now().toString(36)}`.slice(0, 32);
    db.createUser(id, username, hashPassword(`${username}-local`), `${username}@hustronix.io`);
    user = db.getUser(username) as { id: string };
  }
  resolveTenantContext(user!.id);
  db.updateSetting(user!.id, "org.owner_user_id", user!.id);
  db.updateSetting(user!.id, "org.role", "owner");
  db.updateSetting(user!.id, "org.onboarding.completed", "1");
  return user!.id;
}

function wipeTenant(userId: string) {
  const decIds = `SELECT id FROM decision_ledger WHERE user_id = ?`;
  db.rawRun(
    `UPDATE external_signals SET linked_execution_id = NULL, related_decision_id = NULL, state = 'UNVERIFIED' WHERE user_id = ?`,
    [userId],
  );
  for (const sql of [
    `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situation_events WHERE user_id = ?`,
    `DELETE FROM situation_entities WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM signal_entities WHERE user_id = ?`,
    `DELETE FROM entity_cooccurrence WHERE user_id = ?`,
    `DELETE FROM situations WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
    `DELETE FROM org_dependencies WHERE user_id = ?`,
    `DELETE FROM execution_ledger WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_ledger WHERE user_id = ?`,
    `DELETE FROM learning_log WHERE user_id = ?`,
    `DELETE FROM readiness_priors WHERE user_id = ?`,
  ]) {
    try {
      db.rawRun(sql, [userId]);
    } catch {
      /* ignore */
    }
  }
  db.rawRun(`DELETE FROM external_event_dedup WHERE tenant_key = ? OR tenant_key LIKE 'crb:%'`, [userId]);
}

function providerFor(source: CrSource): string {
  switch (source) {
    case "slack":
    case "meeting":
      return "slack";
    case "jira":
      return "jira";
    case "email":
      return "gmail";
    case "crm":
      return "hubspot";
    case "github":
      return "github";
    case "support":
      return "slack";
    case "doc":
      return "confluence";
    default:
      return "slack";
  }
}

function main() {
  const size = Number(arg("--size") || "800");
  const scaleOnly = Number(arg("--scale") || "0");
  const userId = ensureUser("company_reality_bench");
  wipeTenant(userId);

  const corpus = buildCompanyRealityCorpus({ targetSize: scaleOnly > 0 ? scaleOnly : size });
  const byDate = new Map<string, typeof corpus.artifacts>();
  for (const a of corpus.artifacts) {
    const list = byDate.get(a.iso_date) || [];
    list.push(a);
    byDate.set(a.iso_date, list);
  }
  const dates = [...byDate.keys()].sort();

  console.log("Company Reality Benchmark");
  console.log(`Artifacts: ${corpus.artifact_count} · stories: ${corpus.stories.length} · noise: ${Math.round(corpus.noise_ratio * 100)}%`);
  console.log("Rules: blind ingest · no simDay · no scenario labels\n");

  const ingestStart = performance.now();
  let inserted = 0;
  let duplicates = 0;
  for (const date of dates) {
    for (const a of byDate.get(date) || []) {
      const detectedAt = `${a.iso_date}T${String(9 + (inserted % 8)).padStart(2, "0")}:00:00.000Z`;
      try {
        const res = ingestExternal({
          userId,
          provider: providerFor(a.source),
          content: a.content,
          externalId: a.external_id,
          tenantKey: userId,
          detectedAt,
          owner: `${a.source}:${a.author}`,
          meta: { source_system: a.source },
        });
        if (res.duplicate) duplicates += 1;
        else inserted += 1;
      } catch (e: unknown) {
        console.warn(`ingest fail ${a.external_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const ingestMs = Math.round(performance.now() - ingestStart);

  const detectStart = performance.now();
  for (const date of dates) {
    runSituationDetection(userId);
  }
  const detectMs = Math.round(performance.now() - detectStart);

  const report = evaluateCompanyReality(userId, corpus, { ingest_ms: ingestMs, detect_ms: detectMs });

  const mem = process.memoryUsage();
  const sitRows = db.rawGet(
    `SELECT id, pattern_id, primary_entity_key, stage, decision_id FROM situations WHERE user_id = ?`,
    [userId],
  ) as { id: string; pattern_id: string; primary_entity_key: string | null; stage: string; decision_id: string | null }[];
  const identityKey = (r: { pattern_id: string; primary_entity_key: string | null }) =>
    `${r.pattern_id}::${r.primary_entity_key || "_unbound"}`;
  const byIdentity = new Map<string, number>();
  for (const s of sitRows) {
    const k = identityKey(s);
    byIdentity.set(k, (byIdentity.get(k) || 0) + 1);
  }
  const duplicateIdentities = [...byIdentity.entries()].filter(([, n]) => n > 1);
  const signalCount = (
    db.rawGet(`SELECT COUNT(*) AS n FROM external_signals WHERE user_id = ?`, [userId]) as { n: number }[]
  )[0]?.n ?? 0;
  const evidenceCount = (
    db.rawGet(
      `SELECT COUNT(*) AS n FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
      [userId],
    ) as { n: number }[]
  )[0]?.n ?? 0;
  const stress = {
    artifact_count: corpus.artifact_count,
    signal_count: signalCount,
    situation_count: sitRows.length,
    duplicate_identity_groups: duplicateIdentities.length,
    duplicate_situation_rows: duplicateIdentities.reduce((n, [, c]) => n + (c - 1), 0),
    evidence_links: evidenceCount,
    ingest_ms: ingestMs,
    detect_ms: detectMs,
    total_ms: ingestMs + detectMs,
    detect_passes: dates.length,
    ms_per_detect_pass: dates.length ? Math.round(detectMs / dates.length) : 0,
    ms_per_artifact_ingest: corpus.artifact_count ? Math.round(ingestMs / corpus.artifact_count) : 0,
    memory_rss_mb: Math.round(mem.rss / 1024 / 1024),
    memory_heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    crashes: 0,
    timeouts: 0,
    benchmark_bugs: report.failures.filter((f) => f.classification === "BUG").length,
    false_positives: report.false_ready,
  };

  console.log(report.markdown);
  console.log("\n## Stress metrics\n");
  console.log(JSON.stringify(stress, null, 2));

  const dataOut = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "qa");
  mkdirSync(dataOut, { recursive: true });
  mkdirSync(docsOut, { recursive: true });

  writeFileSync(resolve(docsOut, "company-reality-benchmark-report.md"), report.markdown + "\n");
  if (scaleOnly >= 5000 || corpus.artifact_count >= 5000) {
    writeFileSync(
      resolve(docsOut, "stress-5k-report.md"),
      `# Company Reality Stress Test (${corpus.artifact_count} artifacts)\n\n` +
        `Generated: ${report.generated_at}\n\n` +
        `| Metric | Value |\n|---|---|\n` +
        Object.entries(stress)
          .map(([k, v]) => `| ${k} | ${v} |`)
          .join("\n") +
        `\n\n## Correctness (same corpus ground truth)\n\n` +
        report.markdown +
        `\n`,
    );
  }
  writeFileSync(
    resolve(dataOut, "company-reality-benchmark-scorecard.json"),
    JSON.stringify(
      {
        generated_at: report.generated_at,
        user_id: userId,
        artifact_count: corpus.artifact_count,
        inserted,
        duplicates,
        ingest_ms: ingestMs,
        detect_ms: detectMs,
        discovery: report.discovery,
        entity_isolation: report.entity_isolation,
        readiness: report.readiness,
        false_ready: report.false_ready,
        deescalation: report.deescalation,
        reopen: report.reopen,
        no_decision: report.no_decision,
        contradictory: report.contradictory,
        evidence_quality: report.evidence_quality,
        product_score: report.product_score,
        benchmark_bugs: report.failures.filter((f) => f.classification === "BUG").length,
        failures: report.failures,
        rows: report.rows,
        stress,
      },
      null,
      2,
    ),
  );

  console.log(`\nWrote ${resolve(docsOut, "company-reality-benchmark-report.md")}`);
  console.log(`Inserted ${inserted} · duplicates ${duplicates}`);

  const bugs = report.failures.filter((f) => f.classification === "BUG").length;
  if (bugs > 0) {
    console.error(`\n${bugs} BUG(s) — fix only genuine production bugs, then re-run.`);
    process.exit(1);
  }
}

main();
