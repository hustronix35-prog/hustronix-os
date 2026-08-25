/**
 * Investigate known limitations: dependency chains + parallel entity stories.
 * No engine changes — report only.
 *
 *   npm run probe:limitations
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { repoRoot } from "../../apps/api/src/config.js";
import { ensureUser } from "./hsog-operating-loop-lib.js";

process.env.HUSTRONIX_INTEL_NO_LLM = "1";

function tenant(prefix: string): string {
  return ensureUser(`${prefix}_${randomUUID().slice(0, 8)}`.slice(0, 28));
}

function wipe(userId: string) {
  for (const sql of [
    `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situations WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
    `DELETE FROM org_dependencies WHERE user_id = ?`,
  ]) {
    try {
      db.rawRun(sql, [userId]);
    } catch {
      /* ignore */
    }
  }
}

function probeDependencies() {
  const userId = tenant("dep_chain");
  const lines: [string, string][] = [
    ["2026-03-01", "Engineering blocked on Security for production credentials — cannot ship the connector."],
    ["2026-03-03", "Security waiting on Legal for data-processing language before credential exception approval."],
    ["2026-03-05", "Legal review queue: Security credential exception for Engineering still pending contract clause."],
    ["2026-03-07", "Engineering standup: still blocked — Security says Legal has not cleared the exception."],
  ];
  for (const [d, c] of lines) {
    ingestExternal({
      userId,
      provider: "slack",
      content: c,
      externalId: `dep:${d}`,
      tenantKey: userId,
      detectedAt: `${d}T12:00:00Z`,
      owner: "slack:team",
    });
  }
  runSituationDetection(userId);
  const deps = db.rawGet(
    `SELECT from_team, from_work, to_team, to_work, status FROM org_dependencies WHERE user_id = ?`,
    [userId],
  ) as { from_team: string; from_work: string; to_team: string; to_work: string; status: string }[];
  const talk = talkToHustronix(userId, "Who is waiting on whom? Where is the bottleneck?");
  return { userId, deps, talk: talk.answer.slice(0, 600) };
}

function probeParallelAcme() {
  const userId = tenant("acme_parallel");
  const lines: [string, string][] = [
    ["2026-04-01", "Acme renewal conversation isn't going well — sponsor stopped responding."],
    ["2026-04-03", "Acme support escalations spiking; customer evaluating an alternative vendor."],
    ["2026-04-05", "Acme implementation milestone slipped two weeks — connector still unstable."],
    ["2026-04-07", "Acme SIEM export alert: unusual admin access path flagged during implementation."],
    ["2026-04-09", "Acme exec escalation: implementation delay driving renewal risk."],
  ];
  for (const [d, c] of lines) {
    ingestExternal({
      userId,
      provider: "slack",
      content: c,
      externalId: `acme:${d}`,
      tenantKey: userId,
      detectedAt: `${d}T12:00:00Z`,
      owner: "slack:cs",
    });
  }
  runSituationDetection(userId);
  const sits = db.rawGet(
    `SELECT id, pattern_id, title, primary_entity_key, stage, evidence_count FROM situations WHERE user_id = ? AND (primary_entity_key = 'acme' OR title LIKE '%Acme%')`,
    [userId],
  ) as {
    id: string;
    pattern_id: string;
    title: string;
    primary_entity_key: string;
    stage: string;
    evidence_count: number;
  }[];
  const evidence: Record<string, string[]> = {};
  for (const s of sits) {
    evidence[s.id] = (
      db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [s.id]) as {
        snippet: string;
      }[]
    ).map((r) => r.snippet || "");
  }
  return { userId, situations: sits, evidence };
}

function main() {
  const dep = probeDependencies();
  const par = probeParallelAcme();

  const md = [
    `# Limitation Probes`,
    ``,
    `## 1 — Dependency chain (Eng → Security → Legal)`,
    ``,
    `| from | to | status |`,
    `|---|---|---|`,
    ...dep.deps.map((d) => `| ${d.from_team} | ${d.to_team} | ${d.status} |`),
    ``,
    `**Talk bottleneck answer:** ${dep.talk.replace(/\n/g, " ")}`,
    ``,
    `**Assessment:** ${
      dep.deps.some((d) => /engineering/i.test(d.from_team) && /security/i.test(d.to_team))
        ? "Direction partially inferred"
        : "Direction missing or inverted — limitation confirmed"
    }`,
    ``,
    `## 2 — Parallel Acme stories (churn vs implementation vs security)`,
    ``,
    `Situations for Acme: **${par.situations.length}**`,
    ``,
    ...par.situations.map((s) => `- \`${s.pattern_id}\` · ${s.title} · stage=${s.stage} · evidence=${s.evidence_count}`),
    ``,
    ...par.situations.flatMap((s) => [
      `### ${s.title}`,
      ...((par.evidence[s.id] || []).map((sn) => `- ${sn.slice(0, 100)}`) || ["- (none)"]),
      ``,
    ]),
    `**Assessment:** ${
      par.situations.length >= 2
        ? "Multiple situations kept separate"
        : "Stories merged — limitation / bug to review"
    }`,
    ``,
  ].join("\n");

  const out = resolve(repoRoot, "docs", "qa");
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "limitation-probes-report.md"), md + "\n");
  console.log(md);

  wipe(dep.userId);
  wipe(par.userId);
}

main();
