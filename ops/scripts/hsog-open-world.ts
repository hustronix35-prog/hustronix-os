/**
 * Open-world intelligence suite — no theme lexicon, no HSOG pattern catalog.
 *
 *   npm run hsog:open-world
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { repoRoot } from "../../apps/api/src/config.js";
import { buildOpenWorldCorpus } from "../../apps/api/src/integrations/hsog/openWorldCorpus.js";
import {
  evaluateOpenWorld,
  evaluateOpenWorldChat,
} from "../../apps/api/src/integrations/hsog/openWorldEval.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
process.env.HUSTRONIX_OPEN_WORLD = "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

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
  return user!.id;
}

function wipe(userId: string) {
  const stmts = [
    `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situation_events WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situation_entities WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM signal_entities WHERE user_id = ?`,
    `DELETE FROM entity_cooccurrence WHERE user_id = ?`,
    `DELETE FROM situations WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
    `DELETE FROM org_dependencies WHERE user_id = ?`,
    `DELETE FROM execution_ledger WHERE decision_id IN (SELECT id FROM decision_ledger WHERE user_id = ?)`,
    `DELETE FROM decision_ledger WHERE user_id = ?`,
    `DELETE FROM learning_log WHERE user_id = ?`,
    `DELETE FROM readiness_priors WHERE user_id = ?`,
    `DELETE FROM external_event_dedup WHERE tenant_key = 'open_world'`,
  ];
  for (const sql of stmts) {
    try {
      if (sql.includes("external_event_dedup")) db.rawRun(sql);
      else db.rawRun(sql, [userId]);
    } catch {
      /* ignore */
    }
  }
}

function providerFor(source: string): string {
  const s = source.toLowerCase();
  if (s === "slack" || s === "meeting") return "slack";
  if (s === "jira") return "jira";
  if (s === "email") return "gmail";
  if (s === "crm") return "hubspot";
  return "slack";
}

function main() {
  const userId = ensureUser("hsog_open_world");
  resolveTenantContext(userId);
  wipe(userId);

  const corpus = buildOpenWorldCorpus();
  const byDay = new Map<number, typeof corpus.artifacts>();
  for (const a of corpus.artifacts) {
    const list = byDay.get(a.day) || [];
    list.push(a);
    byDay.set(a.day, list);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  console.log("Hustronix open-world suite");
  console.log(
    `Artifacts: ${corpus.artifacts.length} · stories: ${corpus.stories.filter((s) => s.should_discover).length} + noise`,
  );
  console.log("Rules: no theme lexicon · no HSOG patterns · entity+polarity only\n");

  for (const day of days) {
    const arts = byDay.get(day) || [];
    for (const a of arts) {
      const detectedAt = new Date(Date.UTC(2026, 0, 1 + day, 12, 0, 0)).toISOString();
      const externalId = `${a.external_id}:run:${Date.now().toString(36)}`;
      try {
        ingestExternal({
          userId,
          provider: providerFor(a.source),
          content: a.content,
          externalId,
          tenantKey: "open_world",
          detectedAt,
          owner: a.author,
          meta: {
            open_world: true,
            sim_day: day,
            source_system: a.source,
            corpus_external_id: a.external_id,
          },
        });
      } catch (e: any) {
        console.warn(`ingest fail ${a.external_id}: ${e?.message || e}`);
      }
    }
    runSituationDetection(userId, { simDay: day, openWorld: true });
  }

  const ow = evaluateOpenWorld(userId, corpus);
  console.log(ow.markdown);
  console.log("");
  const chat = evaluateOpenWorldChat(userId);
  console.log(chat.markdown);

  const dataOut = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "hsog");
  mkdirSync(dataOut, { recursive: true });
  mkdirSync(docsOut, { recursive: true });
  writeFileSync(resolve(docsOut, "hsog-open-world-report.md"), ow.markdown + "\n\n" + chat.markdown + "\n");
  writeFileSync(
    resolve(dataOut, "hsog-open-world-scorecard.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        user_id: userId,
        rules: [
          "no scenario ID",
          "no theme label",
          "no theme lexicon",
          "no predefined pattern",
          "no playbook",
        ],
        open_world: {
          discovery: ow.discovery,
          readiness: ow.readiness,
          deescalation: ow.deescalation,
          evidence: ow.evidence,
          false_positives: ow.false_positives,
          extra_situations: ow.extra_situations,
          action: ow.action,
          rows: ow.rows,
        },
        chat: { passed: chat.passed, total: chat.total, turns: chat.turns },
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${resolve(docsOut, "hsog-open-world-report.md")}`);
}

main();
