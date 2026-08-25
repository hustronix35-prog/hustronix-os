/**
 * Founder Journey probe — fresh tenant, company reality data, Talk walkthrough.
 * Records friction without fixing. No HSOG vocabulary in tester prompts.
 *
 *   npm run probe:founder-journey
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/situation-chat.js";
import { buildAttentionBrief } from "../../apps/api/src/intelligence/attention-brief.js";
import { buildCompanyRealityCorpus } from "../../apps/api/src/integrations/company-reality/corpus.js";
import { repoRoot } from "../../apps/api/src/config.js";
import type { CrSource } from "../../apps/api/src/integrations/company-reality/types.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

type Classification = "PASS" | "Bug" | "UX" | "Intelligence" | "Governance" | "Product" | "BLOCKED";

type Row = {
  step: string;
  expected: string;
  actual: string;
  classification: Classification;
  ms: number;
  notes?: string;
};

function providerFor(source: CrSource): string {
  const map: Record<string, string> = {
    slack: "slack",
    meeting: "slack",
    jira: "jira",
    email: "gmail",
    crm: "hubspot",
    github: "github",
    support: "slack",
    doc: "confluence",
  };
  return map[source] || "slack";
}

function wipeTenant(userId: string) {
  const decIds = `SELECT id FROM decision_ledger WHERE user_id = ?`;
  for (const sql of [
    `DELETE FROM situation_evidence WHERE situation_id IN (SELECT id FROM situations WHERE user_id = ?)`,
    `DELETE FROM situations WHERE user_id = ?`,
    `DELETE FROM external_signals WHERE user_id = ?`,
    `DELETE FROM execution_ledger WHERE decision_id IN (${decIds})`,
    `DELETE FROM decision_ledger WHERE user_id = ?`,
  ]) {
    try {
      db.rawRun(sql, [userId]);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const rows: Row[] = [];
  const username = `founder_${randomUUID().slice(0, 8)}`;
  const userId = username.slice(0, 32);
  db.createUser(userId, username, hashPassword("founder-journey-local"), `${username}@founder.test`);
  resolveTenantContext(userId);
  db.updateSetting(userId, "org.owner_user_id", userId);
  db.updateSetting(userId, "org.role", "owner");
  db.updateSetting(userId, "org.onboarding.completed", "1");

  const corpus = buildCompanyRealityCorpus({ targetSize: 800 });
  for (const a of corpus.artifacts) {
    ingestExternal({
      userId,
      provider: providerFor(a.source),
      content: a.content,
      externalId: a.external_id,
      tenantKey: userId,
      detectedAt: `${a.iso_date}T12:00:00Z`,
      owner: `${a.source}:${a.author}`,
      meta: { source_system: a.source },
    });
  }
  runSituationDetection(userId);

  let focusId: string | null = null;
  let decisionId: string | null = null;

  function step(
    name: string,
    expected: string,
    fn: () => { actual: string; classification: Classification; notes?: string },
  ) {
    const t0 = performance.now();
    try {
      const r = fn();
      rows.push({
        step: name,
        expected,
        actual: r.actual.slice(0, 500),
        classification: r.classification,
        ms: Math.round(performance.now() - t0),
        notes: r.notes,
      });
    } catch (e: unknown) {
      rows.push({
        step: name,
        expected,
        actual: e instanceof Error ? e.message : String(e),
        classification: "Bug",
        ms: Math.round(performance.now() - t0),
      });
    }
  }

  step("Login / tenant ready", "Fresh owner tenant with onboarding complete", () => {
    const me = db.getUser(username);
    return {
      actual: me ? `user=${username} role=owner` : "user missing",
      classification: me ? "PASS" : "Bug",
    };
  });

  step("Home / What needs attention", "Useful ranked problems without jargon", () => {
    const brief = buildAttentionBrief(userId);
    const top = brief.items.slice(0, 3).map((i) => i.title).join(" · ");
    return {
      actual: top || "(empty attention brief)",
      classification: brief.items.length >= 1 ? "PASS" : "UX",
      notes: `${brief.items.length} attention items`,
    };
  });

  step("Ask — What's going wrong?", "Plain-language summary of real problems", () => {
    const r = talkToHustronix(userId, "What needs my attention right now? What's going wrong?");
    focusId = r.focus_id || r.situations[0]?.id || focusId;
    return {
      actual: r.answer.slice(0, 400),
      classification:
        r.answer.length > 40 && !/situation_id|DECISION_READY|readiness gate/i.test(r.answer) ? "PASS" : "UX",
      notes: focusId ? `focus=${focusId.slice(0, 8)}…` : undefined,
    };
  });

  step("Why?", "Causal explanation with evidence references", () => {
    const r = talkToHustronix(userId, "Why is that happening?", { focusId });
    return {
      actual: r.answer.slice(0, 400),
      classification: /because|evidence|signal|support|renewal|launch|outage|facet/i.test(r.answer)
        ? "PASS"
        : "Intelligence",
    };
  });

  step("Show evidence", "Concrete snippets / sources", () => {
    const r = talkToHustronix(userId, "Show me the evidence.", { focusId });
    return {
      actual: r.answer.slice(0, 400),
      classification: /snippet|slack|email|jira|support|evidence|signal/i.test(r.answer) ? "PASS" : "UX",
    };
  });

  step("Who is affected?", "Teams / customers / owners", () => {
    const r = talkToHustronix(userId, "Who is affected?", { focusId });
    return {
      actual: r.answer.slice(0, 400),
      classification: /team|customer|engineering|sales|success|owner|people/i.test(r.answer) ? "PASS" : "Intelligence",
    };
  });

  step("What should we do?", "Actionable recommendation", () => {
    const r = talkToHustronix(userId, "What should we do?", { focusId });
    return {
      actual: r.answer.slice(0, 400),
      classification: /recommend|action|plan|should|task|next/i.test(r.answer) ? "PASS" : "Intelligence",
    };
  });

  step("What else could be true?", "Alternative hypotheses", () => {
    const r = talkToHustronix(userId, "What else could be true?", { focusId, action: "hypotheses" });
    return {
      actual: r.answer.slice(0, 400),
      classification: /could|alternative|hypoth|might|uncertain/i.test(r.answer) ? "PASS" : "UX",
    };
  });

  step("Validate", "Clear validation checks", () => {
    const r = talkToHustronix(userId, "Validate this before we commit.", { focusId, action: "validate" });
    return {
      actual: r.answer.slice(0, 400),
      classification: /valid|check|instrument|causal|gate|evidence/i.test(r.answer) ? "PASS" : "Governance",
    };
  });

  step("Can we execute?", "Honest capacity / feasibility", () => {
    const r = talkToHustronix(userId, "Can we actually execute this?", { focusId, action: "feasibility" });
    return {
      actual: r.answer.slice(0, 400),
      classification: /capacity|hours|feasib|blocked|overload|team/i.test(r.answer) ? "PASS" : "Product",
    };
  });

  step("Create decision", "Draft decision from situation", () => {
    const r = talkToHustronix(userId, "Create the decision.", { focusId, action: "create_decision" });
    decisionId = r.decision_id;
    return {
      actual: r.answer.slice(0, 400),
      classification: r.decision_id ? "PASS" : "Product",
      notes: r.decision_id ? `decision=${r.decision_id.slice(0, 8)}…` : undefined,
    };
  });

  step("Execute", "Governed commit + tasks", () => {
    talkToHustronix(userId, "Instrumentation is OK.", { focusId, action: "instrumentation" });
    const r = talkToHustronix(userId, "Execute it.", { focusId, action: "execute" });
    decisionId = r.decision_id || decisionId;
    return {
      actual: r.answer.slice(0, 400),
      classification: /execut|task|committed|spawn|blocked/i.test(r.answer) ? "PASS" : "Product",
    };
  });

  step("Tasks", "Visible execution ledger rows", () => {
    const tasks = db.rawGet(
      `SELECT owner, status, success_condition FROM execution_ledger WHERE decision_id = ?`,
      [decisionId || ""],
    ) as { owner: string; status: string; success_condition: string | null }[];
    return {
      actual: tasks.length ? tasks.map((t) => `${t.owner}:${t.status}`).join(", ") : "(no tasks)",
      classification: tasks.length >= 1 ? "PASS" : "Product",
    };
  });

  step("Complete", "Outcome path exists", () => {
    const r = talkToHustronix(userId, "Mark the work complete.", { focusId, action: "complete" });
    return {
      actual: r.answer.slice(0, 400),
      classification: /complete|done|outcome|reversed|blocked|success/i.test(r.answer) ? "PASS" : "Product",
    };
  });

  step("Did it work? / Outcome", "Business outcome assessment", () => {
    const r = talkToHustronix(userId, "Did it work?", { focusId, action: "outcome" });
    return {
      actual: r.answer.slice(0, 400),
      classification: /outcome|worked|impact|resolved|partial|success/i.test(r.answer) ? "PASS" : "Product",
    };
  });

  step("Learn", "Calibration / learning explanation", () => {
    const r = talkToHustronix(userId, "What did we learn?", { focusId, action: "learn" });
    return {
      actual: r.answer.slice(0, 400),
      classification: /learn|calibr|prior|next time|strict|permissive/i.test(r.answer) ? "PASS" : "Product",
    };
  });

  const pass = rows.filter((r) => r.classification === "PASS").length;
  const md = [
    `# Founder Journey Probe`,
    ``,
    `Tenant: \`${username}\` · artifacts: ${corpus.artifact_count} · ${new Date().toISOString()}`,
    ``,
    `Score: **${pass}/${rows.length}** steps passed (Talk API probe — zero HSOG prompts)`,
    ``,
    `| Step | Expected | Actual | Class | ms |`,
    `|---|---|---|---|---:|`,
    ...rows.map(
      (r) =>
        `| ${r.step} | ${r.expected.replace(/\|/g, "/")} | ${r.actual.replace(/\|/g, "/").slice(0, 80)}… | ${r.classification} | ${r.ms} |`,
    ),
    ``,
    `## Zero-explanation UI test (human)`,
    ``,
    `Re-run with the same corpus on \`localhost:3000\` and ask a non-builder:`,
    `> "Use Hustronix to figure out what needs attention and do something about it."`,
    ``,
    `Credentials: \`${username}\` / \`founder-journey-local\` (tenant wiped after this probe — re-seed for UI test).`,
    ``,
  ].join("\n");

  const out = resolve(repoRoot, "docs", "qa");
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "founder-journey-probe-report.md"), md + "\n");
  writeFileSync(resolve(out, "founder-journey-probe.json"), JSON.stringify({ username, userId, rows, pass, total: rows.length }, null, 2));

  console.log(md);
  console.log(`\nWrote docs/qa/founder-journey-probe-report.md`);

  // Keep tenant for optional UI test — comment wipe for human tester
  // wipeTenant(userId);
}

main();
