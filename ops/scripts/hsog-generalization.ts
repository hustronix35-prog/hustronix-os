/**
 * Generalization + Chat E2E + de-escalation suite.
 *
 *   npm run hsog:generalization
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
import { buildUnseenCorpus } from "../../apps/api/src/integrations/hsog/unseenCorpus.js";
import {
  DEFAULT_CHAT_TURNS,
  evaluateChatE2E,
  evaluateUnseenGeneralization,
} from "../../apps/api/src/integrations/hsog/unseenEval.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
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
    `DELETE FROM external_event_dedup WHERE tenant_key = 'unseen_generalization'`,
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
  const userId = ensureUser("hsog_generalization");
  resolveTenantContext(userId);
  wipe(userId);

  const corpus = buildUnseenCorpus();
  const byDay = new Map<number, typeof corpus.artifacts>();
  for (const a of corpus.artifacts) {
    const list = byDay.get(a.day) || [];
    list.push(a);
    byDay.set(a.day, list);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  console.log("HSOG generalization suite");
  console.log(`Unseen artifacts: ${corpus.artifacts.length} · scenarios: ${corpus.scenarios.length}`);
  console.log("Rules: no playbooks · no HSOG scenario meta · emergent discovery\n");

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
          tenantKey: "unseen_generalization",
          detectedAt,
          owner: a.author,
          meta: {
            unseen: true,
            sim_day: day,
            source_system: a.source,
            corpus_external_id: a.external_id,
          },
        });
      } catch (e: any) {
        console.warn(`ingest fail ${a.external_id}: ${e?.message || e}`);
      }
    }
    runSituationDetection(userId, { simDay: day });
  }

  const gen = evaluateUnseenGeneralization(userId, corpus);
  console.log(gen.markdown);
  console.log("");

  const chat = evaluateChatE2E(userId, DEFAULT_CHAT_TURNS);
  console.log(chat.markdown);

  const dataOut = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "hsog");
  mkdirSync(dataOut, { recursive: true });
  mkdirSync(docsOut, { recursive: true });
  writeFileSync(
    resolve(docsOut, "hsog-generalization-report.md"),
    gen.markdown + "\n\n" + chat.markdown + "\n",
  );
  writeFileSync(
    resolve(dataOut, "hsog-generalization-scorecard.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        user_id: userId,
        generalization: {
          discovery_rate: gen.discovery_rate,
          scenarios_discovered: gen.scenarios_discovered,
          scenarios_total: gen.scenarios_total,
          avg_lead: gen.avg_lead,
          deescalations_ok: gen.deescalations_ok,
          deescalations_total: gen.deescalations_total,
          rows: gen.rows,
        },
        chat: { passed: chat.passed, total: chat.total, turns: chat.turns },
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${resolve(docsOut, "hsog-generalization-report.md")}`);
}

main();
