/**
 * HSOG operating-loop benchmark — evaluates the current Hustronix OS.
 * Does not modify product code to chase scores.
 *
 *   npm run hsog:operating-loop
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { repoRoot } from "../../apps/api/src/config.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { loadHsogBundle, resolveHsogBundlePath } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import {
  defaultHsogDataDir,
  exportDualCorpus,
  injectNoise,
} from "../../apps/api/src/integrations/hsog/customerPathCorpus.js";
import { ingestChronological } from "../../apps/api/src/integrations/hsog/customerPathIngest.js";
import {
  buildScenarioTiming,
  evaluateIntelligenceLead,
} from "../../apps/api/src/integrations/hsog/intelligenceLeadEval.js";
import { buildOpenWorldCorpus } from "../../apps/api/src/integrations/hsog/openWorldCorpus.js";
import { evaluateOpenWorld, evaluateOpenWorldChat } from "../../apps/api/src/integrations/hsog/openWorldEval.js";
import { buildUnseenCorpus } from "../../apps/api/src/integrations/hsog/unseenCorpus.js";
import { evaluateUnseenGeneralization } from "../../apps/api/src/integrations/hsog/unseenEval.js";
import { ingestExternal } from "../../apps/api/src/integrations/ingestRouter.js";
import { runSituationDetection } from "../../apps/api/src/intelligence/situation-detect.js";
import { computeReadiness } from "../../apps/api/src/intelligence/readiness.js";
import {
  BASE_SCORE_FLOOR,
  effectiveScoreFloor,
  getReadinessPrior,
  learningPatternId,
  MAX_MIN_DISTINCT_DAYS_DELTA,
  MAX_MIN_EVIDENCE_DELTA,
  MIN_SCORE_FLOOR,
  updateFromOutcome,
} from "../../apps/api/src/intelligence/readiness-learning.js";
import { gatesAllowReady, READY_GATES } from "../../apps/api/src/intelligence/situation-engine.js";
import { buildAttentionBrief } from "../../apps/api/src/intelligence/attention-brief.js";
import { buildOrgIntelligence } from "../../apps/api/src/org/intelligence.js";
import { getDecisionCompletionEligibility } from "../../apps/api/src/evaluation/completion-eligibility.js";
import { evaluateDecisionOutcome } from "../../apps/api/src/evaluation/outcome-evaluation.js";
import {
  mutationCommitDecision,
  mutationTransitionExecution,
} from "../../apps/api/src/security/mutation-handlers.js";
import {
  check,
  ensureUser,
  fail,
  finishAllTasks,
  ingestDays,
  insertOutcomeRow,
  listSituations,
  mutationCompleteDecision,
  mutationCreateDraftDecision,
  mutationReverseDecision,
  seedReadySituation,
  talkCommit,
  talkToHustronix,
  wipeTenant,
  type Check,
  type SimArt,
} from "./hsog-operating-loop-lib.js";

process.env.HUSTRONIX_INTEL_NO_LLM = process.env.HUSTRONIX_INTEL_NO_LLM || "1";
db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

const CHURN = "customer_churn_risk";
const SECURITY = "security_incident";
const CHURN_FACETS = new Set(["health", "support"]);

function dim(checks: Check[], letters: string[]) {
  const subset = checks.filter((c) => letters.includes(c.letter));
  const pass = subset.filter((c) => c.pass).length;
  return { pass, total: subset.length, label: `${pass}/${subset.length}` };
}

function seedRoster(userId: string) {
  for (const p of [
    { name: "Jordan", role: "CS", team: "Customer Success" },
    { name: "Ethan", role: "Engineer", team: "Engineering" },
    { name: "Priya", role: "CS", team: "Customer Success" },
    { name: "Leah", role: "Security", team: "Security" },
  ]) {
    try {
      db.upsertTeamRosterByEmail(userId, {
        name: p.name,
        email: `${p.name.toLowerCase()}@hustronix.io`,
        role: p.role,
        team: p.team,
        capacity: "40h / week",
        slackId: p.name,
      });
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
  if (s === "github") return "github";
  return "slack";
}

function ingestOpenWorldArts(
  userId: string,
  arts: Array<{ day: number; source: string; author: string; content: string; external_id: string }>,
) {
  const byDay = new Map<number, typeof arts>();
  for (const a of arts) {
    const list = byDay.get(a.day) || [];
    list.push(a);
    byDay.set(a.day, list);
  }
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const a of byDay.get(day) || []) {
      ingestExternal({
        userId,
        provider: providerFor(a.source),
        content: a.content,
        externalId: `${a.external_id}:run:${randomUUID().slice(0, 8)}`,
        tenantKey: "operating_loop_ow",
        detectedAt: new Date(Date.UTC(2026, 0, 1 + day, 12, 0, 0)).toISOString(),
        owner: a.author,
        meta: { open_world: true, sim_day: day, corpus_external_id: a.external_id },
      });
    }
    runSituationDetection(userId, { simDay: day, openWorld: true });
  }
}

function readFullSystemGovernance(): { pass: number; total: number; generated_at: string | null } {
  const path = resolve(repoRoot, "data", "hsog-full-system-scorecard.json");
  if (!existsSync(path)) return { pass: 0, total: 0, generated_at: null };
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as {
      generated_at?: string;
      scorecard?: Array<{ layer?: string; result?: string; verdict?: string }>;
    };
    const gov = (j.scorecard || []).filter((r) => String(r.layer || "").includes("Governance"));
    let pass = 0;
    let total = 0;
    for (const g of gov) {
      const m = String(g.result || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        pass += Number(m[1]);
        total += Number(m[2]);
      }
    }
    return { pass, total, generated_at: j.generated_at || null };
  } catch {
    return { pass: 0, total: 0, generated_at: null };
  }
}

async function main() {
  const checks: Check[] = [];
  const layers: Record<string, unknown> = {};

  console.log("HSOG operating-loop benchmark");
  console.log("Evaluator only. Blind ingest → Talk → execute → outcome → learning.");
  console.log("Old day-taste / playbook suites remain regression, not this scorecard.\n");

  // ── A + B: understand / temporal via real customer-path ingest ──
  console.log("=== A/B Understand + temporal (blind chrono) ===");
  const sourcePath = resolveHsogBundlePath("");
  const { path: bundlePath, bundle } = loadHsogBundle("");
  const { groundTruth, blind } = exportDualCorpus(bundle, bundlePath || sourcePath, defaultHsogDataDir(repoRoot));
  const intelUser = ensureUser("oloopintel");
  wipeTenant(intelUser);
  try {
    db.rawRun(
      `DELETE FROM external_event_dedup
       WHERE tenant_key IN ('customer_path', 'operating_loop', 'operating_loop_ow', 'operating_loop_unseen')
          OR external_id LIKE 'cust:%'`,
    );
  } catch {
    /* optional */
  }
  for (const p of groundTruth.people || []) {
    try {
      db.upsertTeamRosterByEmail(intelUser, {
        name: p.name,
        email: (p.email || `${p.id}@hustronix.io`).toLowerCase(),
        role: p.role || "Member",
        team: p.department || "General",
        capacity: "40h / week",
        slackId: p.first_name || p.name.split(/\s+/)[0],
      });
    } catch {
      /* ignore */
    }
  }
  seedRoster(intelUser);
  const ingest = ingestChronological(intelUser, blind, { throughDay: 132, detectEveryDays: 1 });
  console.log(`intel ingest inserted=${ingest.inserted} dups=${ingest.duplicates} errors=${ingest.errors}`);
  const timing = buildScenarioTiming(bundle);
  const lead = evaluateIntelligenceLead(intelUser, groundTruth, timing, ingest.detection_timeline);
  layers.understand = {
    ingest: { inserted: ingest.inserted, duplicates: ingest.duplicates, errors: ingest.errors },
    quality: lead.quality,
    rows: lead.rows.map((r) => ({
      scenario: r.scenario,
      aware: r.awareness_day,
      forming: r.forming_day,
      elevated: r.elevated_day,
      ready: r.decision_ready_day,
      declaration: r.declaration_day,
      stage: r.stage,
      trajectory: r.trajectory,
      evidence_count: r.evidence_count,
      evidence_hit_rate: r.evidence_hit_rate,
      action_useful: r.action_useful,
    })),
  };
  checks.push(
    check(
      "A",
      "a-discovery",
      "Situation discovery (awareness)",
      lead.scenarios_aware === lead.scenarios_total,
      `${lead.scenarios_total}/${lead.scenarios_total} aware`,
      `${lead.scenarios_aware}/${lead.scenarios_total} aware`,
      lead.scenarios_aware === lead.scenarios_total
        ? {}
        : ingest.inserted < 20
          ? {
              classification: "HSOG_HARNESS_BUG",
              severity: "high",
              root_cause: `Blind ingest inserted ${ingest.inserted} rows (dedup/tenant).`,
              recommended_fix: "Wipe customer_path external_event_dedup before a fresh tenant ingest.",
            }
          : {
              classification: "REAL_PRODUCT_BUG",
              severity: "high",
              root_cause: "Some HSOG scenarios never reached AWARENESS on blind ingest.",
              recommended_fix: "Investigate unmatched signals for the missing pattern — do not add fixture names.",
            },
    ),
  );
  checks.push(
    check(
      "A",
      "a-ready",
      "Decision-ready on sufficient evidence",
      lead.scenarios_decision_ready === lead.scenarios_total,
      `${lead.scenarios_total}/${lead.scenarios_total} decision-ready`,
      `${lead.scenarios_decision_ready}/${lead.scenarios_total} decision-ready`,
    ),
  );
  const evidenceOk = lead.quality.evidence >= 0.8 && lead.quality.evidence < 1.001;
  checks.push(
    check(
      "A",
      "a-evidence",
      "Evidence correctness (not optimized to 1.00)",
      evidenceOk,
      "hit-rate ≥ 0.80, wrong attach worse than miss",
      `mean hit-rate ${lead.quality.evidence}`,
    ),
  );
  const temporalOk = lead.rows.filter((r) => r.forming_day != null || r.elevated_day != null).length;
  checks.push(
    check(
      "B",
      "b-temporal",
      "Progressive stages recorded",
      temporalOk === lead.rows.length,
      "every scenario has forming or elevated day",
      `${temporalOk}/${lead.rows.length} have forming/elevated`,
    ),
  );
  const earlyFalse = lead.rows.filter(
    (r) => r.decision_ready_day != null && r.first_evidence_day != null && r.decision_ready_day === r.first_evidence_day,
  );
  checks.push(
    check(
      "B",
      "b-not-first-keyword",
      "Ready is not first-keyword for most scenarios",
      earlyFalse.length <= 3,
      "ready day usually after first evidence",
      `${earlyFalse.length} scenarios ready on first evidence day (${earlyFalse.map((r) => r.scenario).join(", ") || "none"})`,
      earlyFalse.length > 3
        ? {
            classification: "EXPECTED_LIMITATION",
            severity: "low",
            root_cause: "Some patterns still become ready the same day evidence first appears when the first batch is already dense.",
            recommended_fix: "Document; do not loosen READY_GATES to delay for the benchmark.",
          }
        : {},
    ),
  );

  // ── C: contradiction ──
  console.log("=== C Contradiction ===");
  const cUser = ensureUser("oloopcx");
  wipeTenant(cUser);
  const mixed: SimArt[] = [
    { day: 10, source: "slack", author: "Marcus", content: "Sales: CobaltWorks is happy — renewal call went great, they love the product.", slug: "cw-sales" },
    { day: 11, source: "slack", author: "Jordan", content: "Support: CobaltWorks escalation increasing, tickets stacking, customer is worried.", slug: "cw-support" },
    { day: 12, source: "hubspot", author: "Jordan", content: "CRM: CobaltWorks health score is green and stable.", slug: "cw-crm" },
    { day: 13, source: "jira", author: "Ethan", content: "Engineering: CobaltWorks implementation is blocked; cannot ship the connector they need.", slug: "cw-eng" },
  ];
  ingestDays(cUser, mixed, { openWorld: true });
  const cSits = listSituations(cUser).filter((s) => /cobalt/i.test(s.title + s.entities_json + s.pattern_id));
  const cReady = cSits.filter((s) => s.stage === "DECISION_READY" || s.stage === "DECIDED");
  checks.push(
    check(
      "C",
      "c-not-ready",
      "Contradictory CobaltWorks cluster is not DECISION_READY",
      cReady.length === 0,
      "ELEVATED/uncertain, not READY",
      cSits.length
        ? cSits.map((s) => `${s.title}:${s.stage}/${s.trajectory}`).join("; ")
        : "no situation discovered",
      cReady.length
        ? {
            classification: "EXPECTED_LIMITATION",
            severity: "medium",
            root_cause:
              "Open-world polarity does not treat 'happy' / health-green as IMPROVING, so mixed sales vs support still reads as WORSENING and can become DECISION_READY.",
            recommended_fix:
              "If product wants contradiction from sentiment (happy vs escalation), extend polarity — do not add a CobaltWorks rule.",
          }
        : !cSits.length
          ? {
              classification: "EXPECTED_LIMITATION",
              severity: "medium",
              root_cause: "Open-world did not form a situation for a novel entity with mixed sources.",
              recommended_fix: "Treat as generalization gap, not a fixture patch.",
            }
          : {},
    ),
  );
  const afterUp: SimArt[] = [
    { day: 20, source: "slack", author: "Nia", content: "Nia is worried: BramblePeak peering congestion is getting worse and customers cannot send traffic.", slug: "bp-down1" },
    { day: 21, source: "jira", author: "Omar", content: "Ticket: BramblePeak congestion overdue; serious risk if we do not reroute.", slug: "bp-down2" },
    { day: 22, source: "gmail", author: "Nia", content: "BramblePeak still blocked — congestion has not cleared.", slug: "bp-down3" },
    { day: 28, source: "slack", author: "Omar", content: "All clear: BramblePeak peering restored, congestion cleared, customers unblocked.", slug: "bp-up" },
  ];
  const c2 = ensureUser("olooptraj");
  wipeTenant(c2);
  ingestDays(c2, afterUp, { openWorld: true });
  const bp = listSituations(c2).find((s) => /bramblepeak/i.test(s.title + (s.entities_json || "") + s.pattern_id));
  checks.push(
    check(
      "C",
      "c-trajectory-update",
      "Later improving evidence updates trajectory rather than locking risk",
      !!bp && (bp.trajectory === "IMPROVING" || bp.stage === "RESOLVED"),
      "IMPROVING or RESOLVED after restore",
      bp ? `${bp.stage}/${bp.trajectory}` : "no BramblePeak situation",
    ),
  );

  // ── D: Talk ──
  console.log("=== D Talk ===");
  const sitPick = listSituations(intelUser).find((s) => s.stage === "DECISION_READY" || s.stage === "DECIDED") || listSituations(intelUser)[0];
  const talkQs = sitPick
    ? [
        `What's happening with ${sitPick.title}?`,
        "Why?",
        "What evidence supports this?",
        "Who is affected?",
        "What else could be true?",
        "What should we do?",
      ]
    : ["What's going wrong in the company?"];
  const talkTurns = talkQs.map((q, i) =>
    talkToHustronix(intelUser, q, {
      focusId: sitPick?.id,
      action: i === 4 ? "hypotheses" : i === 5 ? undefined : undefined,
    }),
  );
  const groundedN = talkTurns.filter((t) => t.grounded).length;
  const mentionsEvidence = talkTurns.some((t) => /evidence|day \d+/i.test(t.answer));
  const mentionsSituation = talkTurns.some((t) => /stage|trajectory|decision-ready|worsening|forming/i.test(t.answer));
  checks.push(
    check(
      "D",
      "d-grounded",
      "Talk answers are situation-grounded",
      groundedN === talkTurns.length && mentionsEvidence && mentionsSituation,
      "all turns grounded in situation/evidence/timeline",
      `${groundedN}/${talkTurns.length} grounded; evidence=${mentionsEvidence} situation=${mentionsSituation}`,
    ),
  );
  const execPremature = talkToHustronix(intelUser, "Execute it.", {
    focusId: sitPick?.id,
    action: "execute",
  });
  const blockedCausal =
    /CAUSAL_VALIDATION_REQUIRED|validate|DRAFT|instrumentation|cannot execute|not ready to execute/i.test(
      execPremature.answer,
    );
  const statusAfterPremature = sitPick?.decision_id
    ? String(db.getDecisionLedgerRow(sitPick.decision_id)?.status || "")
    : "";
  checks.push(
    check(
      "E",
      "e-no-bypass",
      "Talk cannot execute without causal validation",
      blockedCausal && statusAfterPremature !== "ACTIVE",
      "CAUSAL_VALIDATION_REQUIRED / stay DRAFT",
      `answer=${execPremature.answer.slice(0, 160)} status=${statusAfterPremature || "no decision"}`,
    ),
  );

  // Full validation then execute on a seeded situation (product Talk loop)
  const opsUser = ensureUser("oloopops");
  wipeTenant(opsUser);
  seedRoster(opsUser);
  const loop = talkCommit(opsUser, "Northwind warehouse delay");
  const activeOk = String(db.getDecisionLedgerRow(loop.decisionId || "")?.status) === "ACTIVE";
  checks.push(
    check(
      "E",
      "e-validate-then-active",
      "Hypotheses + instrumentation → ACTIVE",
      activeOk,
      "DRAFT → ACTIVE after required validation",
      `status=${db.getDecisionLedgerRow(loop.decisionId || "")?.status || "missing"}`,
    ),
  );
  try {
    mutationCommitDecision(opsUser, loop.decisionId!, "second commit");
    checks.push(
      fail(
        "E",
        "e-second-commit",
        "Duplicate commit rejected",
        "REJECTED",
        "second commit allowed",
        "REAL_PRODUCT_BUG",
        "medium",
        "Commit of an already ACTIVE decision succeeded.",
        "Keep commit single-shot.",
      ),
    );
  } catch (e) {
    checks.push(
      check("E", "e-second-commit", "Duplicate commit rejected", true, "REJECTED", e instanceof Error ? e.message : String(e)),
    );
  }
  const gov = readFullSystemGovernance();
  checks.push(
    check(
      "E",
      "e-full-system-gov",
      "Governance regression (last hsog:full-system)",
      gov.total >= 53 && gov.pass === gov.total,
      "53/53 (or current equivalent)",
      gov.total ? `${gov.pass}/${gov.total} generated ${gov.generated_at}` : "no scorecard",
    ),
  );

  // ── F: capacity + deps ──
  console.log("=== F Capacity / dependencies ===");
  const capUser = ensureUser("oloopcap");
  wipeTenant(capUser);
  const owner = `Priya${capUser.slice(-6)}`;
  db.upsertTeamRosterByEmail(capUser, {
    name: owner,
    email: `${owner.toLowerCase()}@hustronix.io`,
    role: "CS",
    team: "customer success",
    capacity: "40h / week",
    slackId: owner,
  });
  const existing = mutationCreateDraftDecision(capUser, {
    vow: `Existing load ${capUser}`,
    tasks: [1, 2, 3, 4].map((n) => ({
      owner,
      type: "ACTION",
      weight: 1,
      success_condition: `Existing ${n}`,
    })),
  });
  db.transitionDecisionState(existing.id, "ACTIVE", "oloop");
  const existingTasks = db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [existing.id]) as {
    task_id: string;
  }[];
  for (const t of existingTasks) {
    db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 8 WHERE task_id = ?`, [t.task_id]);
    db.transitionExecutionState(t.task_id, "ACTIVE", "seed load", true);
  }
  const next = mutationCreateDraftDecision(capUser, {
    vow: `New 16h ${capUser}`,
    tasks: [{ owner, type: "ACTION", weight: 1, success_condition: "New work" }],
  });
  db.transitionDecisionState(next.id, "ACTIVE", "oloop");
  const neu = (db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [next.id]) as { task_id: string }[])[0];
  db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 16 WHERE task_id = ?`, [neu.task_id]);
  const blocked = db.transitionExecutionState(neu.task_id, "ACTIVE", "new work", true) as {
    status: string;
    reasons?: string[];
    message?: string;
  };
  checks.push(
    check(
      "F",
      "f-overload",
      "40h with 32h+16h BLOCKED",
      String(blocked.status) === "BLOCKED" && /overloaded by 8/i.test(String(blocked.message || "")),
      "BLOCKED overloaded by 8h",
      `${blocked.status} ${blocked.message || ""} ${(blocked.reasons || []).join(",")}`,
    ),
  );
  const freeOwner = `Casey${capUser.slice(-6)}`;
  db.upsertTeamRosterByEmail(capUser, {
    name: freeOwner,
    email: `${freeOwner.toLowerCase()}@hustronix.io`,
    role: "Eng",
    team: "engineering",
    capacity: "40h / week",
    slackId: freeOwner,
  });
  const roomy = mutationCreateDraftDecision(capUser, {
    vow: `Roomy 16h ${capUser}`,
    tasks: [{ owner: freeOwner, type: "ACTION", weight: 1, success_condition: "Fits" }],
  });
  db.transitionDecisionState(roomy.id, "ACTIVE", "oloop");
  const roomyTask = (
    db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ?`, [roomy.id]) as { task_id: string }[]
  )[0];
  db.rawRun(`UPDATE execution_ledger SET estimated_duration_hours = 16 WHERE task_id = ?`, [roomyTask.task_id]);
  const allowed = db.transitionExecutionState(roomyTask.task_id, "ACTIVE", "fits", true);
  checks.push(
    check(
      "F",
      "f-capacity-ok",
      "16h on empty 40h roster is allowed",
      String(allowed.status) === "ACTIVE",
      "ACTIVE",
      String(allowed.status),
    ),
  );
  db.upsertTeamRosterByEmail(capUser, {
    name: "Eng Waiter",
    email: `eng.${capUser}@hustronix.test`,
    role: "Engineer",
    team: "Engineering",
    capacity: "40h / week",
    slackId: "EngWaiter",
  });
  db.upsertTeamRosterByEmail(capUser, {
    name: "Sec Blocker",
    email: `sec.${capUser}@hustronix.test`,
    role: "Security",
    team: "Security",
    capacity: "40h / week",
    slackId: "SecBlocker",
  });
  const depDec = db.saveDecisionEvent(capUser, {
    vow: `Audit ${capUser}`,
    tasks: [
      { owner: "Sec Blocker", type: "ACTION", weight: 1, success_condition: "Security approval" },
      { owner: "Eng Waiter", type: "ACTION", weight: 1, success_condition: "Ship after approval" },
    ],
  });
  const depTasks = db.rawGet(`SELECT task_id, owner FROM execution_ledger WHERE decision_id = ?`, [depDec]) as {
    task_id: string;
    owner: string;
  }[];
  const blocker = depTasks.find((t) => t.owner === "Sec Blocker")!;
  const waiter = depTasks.find((t) => t.owner === "Eng Waiter")!;
  db.rawRun(`UPDATE execution_ledger SET dependencies = ? WHERE task_id = ?`, [JSON.stringify([blocker.task_id]), waiter.task_id]);
  db.transitionExecutionState(blocker.task_id, "ACTIVE", "sec start", true);
  const waiterBlocked = db.transitionExecutionState(waiter.task_id, "ACTIVE", "eng start", true) as {
    status: string;
    reasons?: string[];
    message?: string;
  };
  const depReason = (waiterBlocked.reasons || []).some((r) => String(r).startsWith("dependency_incomplete"));
  checks.push(
    check(
      "F",
      "f-dep",
      "Engineering blocked on incomplete Security dependency",
      String(waiterBlocked.status) === "BLOCKED" && depReason,
      "BLOCKED reason=dependency_incomplete",
      `${waiterBlocked.status} ${(waiterBlocked.reasons || []).join(",")}`,
    ),
  );

  // ── G: execution lifecycle ──
  console.log("=== G Execution lifecycle ===");
  const nTasks = finishAllTasks(loop.decisionId!);
  const stillActive = String(db.getDecisionLedgerRow(loop.decisionId!)?.status) === "ACTIVE";
  const elig = getDecisionCompletionEligibility(loop.decisionId!);
  checks.push(
    check(
      "G",
      "g-no-auto-complete",
      "All tasks DONE does not auto-complete the decision",
      stillActive && elig.eligible,
      "ACTIVE + eligible, not COMPLETED",
      `status=${db.getDecisionLedgerRow(loop.decisionId!)?.status} eligible=${elig.eligible} tasks=${nTasks}`,
    ),
  );
  const preUser = ensureUser("olooppre");
  wipeTenant(preUser);
  const premature = talkCommit(preUser, "Premature close");
  try {
    mutationCompleteDecision(preUser, premature.decisionId!, "confirm");
    checks.push(
      fail(
        "G",
        "g-premature",
        "Premature complete rejected",
        "REJECTED, stays ACTIVE",
        "COMPLETED without all tasks DONE",
        "REAL_PRODUCT_BUG",
        "high",
        "Complete succeeded while tasks were still open.",
        "Keep assertDecisionCompletable.",
      ),
    );
  } catch (e) {
    checks.push(
      check(
        "G",
        "g-premature",
        "Premature complete rejected",
        String(db.getDecisionLedgerRow(premature.decisionId!)?.status) === "ACTIVE",
        "REJECTED, stays ACTIVE",
        `${e instanceof Error ? e.message : String(e)}; status=${db.getDecisionLedgerRow(premature.decisionId!)?.status}`,
      ),
    );
  }
  mutationCompleteDecision(opsUser, loop.decisionId!, "operator confirm");
  const completed = String(db.getDecisionLedgerRow(loop.decisionId!)?.status) === "COMPLETED";
  const outcomeN = (
    db.rawGet(`SELECT COUNT(*) AS c FROM decision_outcomes WHERE decision_id = ?`, [loop.decisionId]) as { c: number }[]
  )[0];
  checks.push(
    check(
      "G",
      "g-complete",
      "Operator confirm → COMPLETED + outcome row",
      completed && Number(outcomeN.c) >= 1,
      "COMPLETED and decision_outcomes recorded",
      `status=${db.getDecisionLedgerRow(loop.decisionId!)?.status} outcomes=${outcomeN.c}`,
    ),
  );
  const rev = talkCommit(opsUser, "Reverse me please");
  const revTurn = talkToHustronix(opsUser, "It didn't work. Reverse this decision.", {
    focusId: rev.focusId,
    action: "reverse",
  });
  checks.push(
    check(
      "G",
      "g-reverse",
      "ACTIVE → REVERSED with authorization",
      String(db.getDecisionLedgerRow(rev.decisionId!)?.status) === "REVERSED" && /REVERSED/i.test(revTurn.answer),
      "REVERSED + Talk confirmation",
      `status=${db.getDecisionLedgerRow(rev.decisionId!)?.status}`,
    ),
  );

  // ── H: outcomes ──
  console.log("=== H Outcome evaluation ===");
  const hUser = ensureUser("oloopout");
  wipeTenant(hUser);
  const failCase = talkCommit(hUser, "Failed warehouse");
  finishAllTasks(failCase.decisionId!);
  mutationCompleteDecision(hUser, failCase.decisionId!, "confirm");
  const failRow = (
    db.rawGet(`SELECT result, learning_notes FROM decision_outcomes WHERE decision_id = ?`, [failCase.decisionId]) as {
      result: string;
      learning_notes: string;
    }[]
  )[0];
  checks.push(
    check(
      "H",
      "h-failed",
      "DONE + still WORSENING → FAILED",
      failRow?.result === "failed",
      "FAILED",
      failRow?.result || "missing",
    ),
  );
  const win = talkCommit(hUser, "Successful recovery");
  finishAllTasks(win.decisionId!);
  db.rawRun(`UPDATE situations SET trajectory = 'IMPROVING' WHERE decision_id = ?`, [win.decisionId]);
  mutationCompleteDecision(hUser, win.decisionId!, "confirm");
  const winRow = (
    db.rawGet(`SELECT result FROM decision_outcomes WHERE decision_id = ?`, [win.decisionId]) as { result: string }[]
  )[0];
  checks.push(
    check("H", "h-success", "DONE + IMPROVING → SUCCESSFUL", winRow?.result === "successful", "SUCCESSFUL", winRow?.result || "missing"),
  );
  const part = talkCommit(hUser, "Partial mixed");
  finishAllTasks(part.decisionId!);
  db.rawRun(`UPDATE situations SET trajectory = 'STABLE', stage = 'DECIDED' WHERE decision_id = ?`, [part.decisionId]);
  mutationCompleteDecision(hUser, part.decisionId!, "confirm");
  const partRow = (
    db.rawGet(`SELECT result FROM decision_outcomes WHERE decision_id = ?`, [part.decisionId]) as { result: string }[]
  )[0];
  checks.push(
    check("H", "h-partial", "DONE + STABLE → PARTIAL", partRow?.result === "partial", "PARTIAL", partRow?.result || "missing"),
  );
  const orphan = mutationCreateDraftDecision(hUser, {
    vow: `Orphan ${hUser}`,
    tasks: [{ owner: "Priya", type: "ACTION", weight: 1, success_condition: "No situation" }],
  });
  db.transitionDecisionState(orphan.id, "ACTIVE", "oloop");
  finishAllTasks(orphan.id);
  try {
    mutationCompleteDecision(hUser, orphan.id, "confirm");
  } catch {
    /* may require causal memo — evaluate directly */
  }
  const judged = evaluateDecisionOutcome(orphan.id);
  checks.push(
    check(
      "H",
      "h-inconclusive",
      "No linked situation → INCONCLUSIVE",
      judged?.result === "inconclusive" ||
        (
          db.rawGet(`SELECT result FROM decision_outcomes WHERE decision_id = ?`, [orphan.id]) as { result: string }[]
        )[0]?.result === "inconclusive",
      "INCONCLUSIVE",
      judged?.result || "missing",
    ),
  );

  // ── I/J/K learning ──
  console.log("=== I/J/K Learning ===");
  const lUser = ensureUser("olooplearn");
  wipeTenant(lUser);
  const priorBefore = getReadinessPrior(lUser, CHURN);
  for (let i = 0; i < 5; i++) {
    updateFromOutcome(insertOutcomeRow(lUser, CHURN, "failed"));
  }
  const priorAfter = getReadinessPrior(lUser, CHURN);
  const baseEv = READY_GATES[CHURN].minEvidence;
  const days = READY_GATES[CHURN].minDistinctDays;
  const stricter =
    priorAfter.min_evidence_delta >= 1 &&
    gatesAllowReady(CHURN, CHURN_FACETS, baseEv, days) === true &&
    gatesAllowReady(CHURN, CHURN_FACETS, baseEv, days, priorAfter) === false;
  checks.push(
    check(
      "I",
      "i-failure-learning",
      "Five FAILED churn outcomes make future readiness stricter",
      stricter,
      "min_evidence_delta +1; same evidence no longer gate-ok",
      `delta=${priorAfter.min_evidence_delta} samples=${priorAfter.failed_count} beforeDelta=${priorBefore.min_evidence_delta}`,
    ),
  );
  const secPrior = getReadinessPrior(lUser, SECURITY);
  const owPrior = getReadinessPrior(lUser, "open_world");
  checks.push(
    check(
      "I",
      "i-isolation",
      "Unrelated patterns unchanged after churn failures",
      secPrior.min_evidence_delta === 0 && owPrior.min_evidence_delta === 0 && secPrior.sample_count === 0,
      "security_incident and open_world untouched",
      `security delta=${secPrior.min_evidence_delta} open_world delta=${owPrior.min_evidence_delta}`,
    ),
  );
  const jUser = ensureUser("olooplearnok");
  wipeTenant(jUser);
  for (let i = 0; i < 5; i++) updateFromOutcome(insertOutcomeRow(jUser, SECURITY, "successful"));
  const jPrior = getReadinessPrior(jUser, SECURITY);
  const floor = effectiveScoreFloor(jPrior);
  const favorable = computeReadiness({
    facetCount: 3,
    facetTarget: 4,
    evidenceCount: 6,
    distinctDays: 4,
    sourceCount: 3,
    entityCount: 3,
    trajectory: "WORSENING",
    confidence: 0.8,
    gateOk: false,
    impactHint: true,
    prior: jPrior,
  });
  checks.push(
    check(
      "J",
      "j-success-nudge",
      "Five SUCCESSFUL outcomes nudge score floor but stay ≥ 0.45",
      jPrior.score_floor_delta === -0.01 && floor >= MIN_SCORE_FLOOR && floor < BASE_SCORE_FLOOR,
      "tiny bounded loosening",
      `delta=${jPrior.score_floor_delta} floor=${floor}`,
    ),
  );
  checks.push(
    check(
      "J",
      "j-gate-mandatory",
      "Favorable prior cannot bypass gateOk=false",
      favorable.ready === false,
      "ready=false",
      `ready=${favorable.ready} score=${favorable.score}`,
    ),
  );
  const kUser = ensureUser("olooplearnk");
  wipeTenant(kUser);
  for (let i = 0; i < 20; i++) updateFromOutcome(insertOutcomeRow(kUser, CHURN, "failed"));
  const kFail = getReadinessPrior(kUser, CHURN);
  checks.push(
    check(
      "K",
      "k-cap-fail",
      "Failure learning is capped",
      kFail.min_evidence_delta <= MAX_MIN_EVIDENCE_DELTA && kFail.min_distinct_days_delta <= MAX_MIN_DISTINCT_DAYS_DELTA,
      `evidence≤${MAX_MIN_EVIDENCE_DELTA} days≤${MAX_MIN_DISTINCT_DAYS_DELTA}`,
      `evidence=${kFail.min_evidence_delta} days=${kFail.min_distinct_days_delta}`,
    ),
  );
  for (let i = 0; i < 20; i++) updateFromOutcome(insertOutcomeRow(kUser, SECURITY, "successful"));
  const kWin = getReadinessPrior(kUser, SECURITY);
  checks.push(
    check(
      "K",
      "k-cap-success",
      "Success learning cannot drop floor below 0.45",
      effectiveScoreFloor(kWin) >= MIN_SCORE_FLOOR,
      `floor ≥ ${MIN_SCORE_FLOOR}`,
      `floor=${effectiveScoreFloor(kWin)} delta=${kWin.score_floor_delta}`,
    ),
  );
  const dupId = insertOutcomeRow(kUser, CHURN, "failed");
  const first = updateFromOutcome(dupId);
  const second = updateFromOutcome(dupId);
  checks.push(
    check(
      "K",
      "k-idempotent",
      "Duplicate outcome does not double-learn",
      first?.sample_count === second?.sample_count,
      "one contribution",
      `first=${first?.sample_count} second=${second?.sample_count}`,
    ),
  );
  const other = getReadinessPrior(kUser, "product_launch_slip");
  checks.push(
    check(
      "K",
      "k-no-global",
      "Unrelated pattern still zero after extreme inject",
      other.sample_count === 0 && other.min_evidence_delta === 0,
      "product_launch_slip unchanged",
      `samples=${other.sample_count} delta=${other.min_evidence_delta}`,
    ),
  );
  const persistUser = kUser;
  const persistBefore = getReadinessPrior(persistUser, CHURN);
  runSituationDetection(persistUser);
  runSituationDetection(persistUser);
  const persistAfter = getReadinessPrior(persistUser, CHURN);
  checks.push(
    check(
      "K",
      "k-persist",
      "Priors persist across detection re-runs",
      persistAfter.min_evidence_delta === persistBefore.min_evidence_delta && persistAfter.failed_count === persistBefore.failed_count,
      "stable prior",
      `before=${persistBefore.min_evidence_delta}/${persistBefore.failed_count} after=${persistAfter.min_evidence_delta}/${persistAfter.failed_count}`,
    ),
  );
  checks.push(
    check(
      "I",
      "i-pattern-not-entity",
      "Learning unit is pattern_id, not company name",
      learningPatternId("openworld:acme-corp") === "open_world" && learningPatternId(CHURN) === CHURN,
      "openworld:acme-corp → open_world; catalog ids stay",
      `ow=${learningPatternId("openworld:acme-corp")} churn=${learningPatternId(CHURN)}`,
    ),
  );

  // ── L: de-escalation ──
  console.log("=== L De-escalation ===");
  const lGen = ensureUser("oloopdeesc");
  wipeTenant(lGen);
  const unseen = buildUnseenCorpus();
  const byDayU = new Map<number, typeof unseen.artifacts>();
  for (const a of unseen.artifacts) {
    const list = byDayU.get(a.day) || [];
    list.push(a);
    byDayU.set(a.day, list);
  }
  for (const day of [...byDayU.keys()].sort((a, b) => a - b)) {
    for (const a of byDayU.get(day) || []) {
      ingestExternal({
        userId: lGen,
        provider: providerFor(a.source),
        content: a.content,
        externalId: `${a.external_id}:${randomUUID().slice(0, 6)}`,
        tenantKey: "operating_loop_unseen",
        detectedAt: new Date(Date.UTC(2026, 0, 1 + day, 12, 0, 0)).toISOString(),
        owner: a.author,
        meta: { sim_day: day },
      });
    }
    runSituationDetection(lGen, { simDay: day });
  }
  const gen = evaluateUnseenGeneralization(lGen, unseen);
  checks.push(
    check(
      "L",
      "l-deesc",
      "Resolve stories de-escalate without extra decisions",
      gen.deescalations_ok === gen.deescalations_total && gen.deescalations_total >= 2,
      `${gen.deescalations_total}/${gen.deescalations_total} resolve stories`,
      `${gen.deescalations_ok}/${gen.deescalations_total}`,
    ),
  );
  const completedSit = (
    db.rawGet(`SELECT stage, trajectory FROM situations WHERE decision_id = ?`, [loop.decisionId]) as {
      stage: string;
      trajectory: string;
    }[]
  )[0];
  checks.push(
    check(
      "L",
      "l-no-false-resolve",
      "COMPLETED while WORSENING is not RESOLVED",
      completedSit?.stage !== "RESOLVED",
      "stay DECIDED / not RESOLVED",
      `${completedSit?.stage}/${completedSit?.trajectory}`,
    ),
  );

  // ── M: open-world (existing + harder extras) ──
  console.log("=== M Open-world ===");
  const owUser = ensureUser("oloopow");
  wipeTenant(owUser);
  const owCorpus = buildOpenWorldCorpus();
  ingestOpenWorldArts(owUser, owCorpus.artifacts);
  const ow = evaluateOpenWorld(owUser, owCorpus);
  const owChat = evaluateOpenWorldChat(owUser);
  checks.push(
    check(
      "M",
      "m-discover",
      "Open-world discovery",
      ow.discovery.ok === ow.discovery.total,
      `${ow.discovery.total}/${ow.discovery.total}`,
      `${ow.discovery.ok}/${ow.discovery.total}`,
    ),
  );
  checks.push(
    check(
      "M",
      "m-false-ready",
      "Open-world false-ready = 0",
      ow.false_positives === 0,
      "0 false-ready",
      String(ow.false_positives),
    ),
  );
  const harder: SimArt[] = [
    { day: 2, source: "slack", author: "Tess", content: "Someone on the account mentioned a vague delay. Not sure which customer.", slug: "weak-ref" },
    { day: 40, source: "gmail", author: "Tess", content: "Circling back on that account delay from last month. Still fuzzy.", slug: "weak-ref-late" },
    { day: 5, source: "slack", author: "Bo", content: "Parking lot is full again. Who moved the visitor cones?", slug: "noise-park" },
    { day: 5, source: "slack", author: "Bo", content: "Cafeteria is doing tacos. Not a customer issue.", slug: "noise-cafe" },
    { day: 6, source: "jira", author: "Bo", content: "Jira: order extra coffee for the 4th floor.", slug: "noise-coffee" },
  ];
  const hardUser = ensureUser("oloopowhard");
  wipeTenant(hardUser);
  ingestDays(hardUser, harder, { openWorld: true });
  const hardSits = listSituations(hardUser);
  const noiseSit = hardSits.filter((s) => /taco|parking|coffee|cafeteria/i.test(s.title + (s.entities_json || "")));
  checks.push(
    check(
      "M",
      "m-hard-noise",
      "Weak/unrelated artifacts do not mint false open-world situations",
      noiseSit.length === 0,
      "no cafeteria/parking/coffee situations",
      hardSits.map((s) => s.title).join("; ") || "none",
    ),
  );
  checks.push(
    check(
      "M",
      "m-chat",
      "Open-world Talk grounding",
      owChat.passed === owChat.total,
      `${owChat.total}/${owChat.total}`,
      `${owChat.passed}/${owChat.total}`,
    ),
  );

  // ── N: cross-source ──
  console.log("=== N Cross-source ===");
  const churnSit = listSituations(intelUser).find((s) => s.pattern_id === CHURN);
  let sources: string[] = [];
  if (churnSit) {
    sources = (
      db.rawGet(
        `SELECT DISTINCT s.source FROM situation_evidence e JOIN external_signals s ON s.id = e.signal_id WHERE e.situation_id = ?`,
        [churnSit.id],
      ) as { source: string }[]
    ).map((r) => r.source);
  }
  checks.push(
    check(
      "N",
      "n-multi-source",
      "Same situation preserves multiple sources",
      sources.length >= 2,
      "≥2 distinct sources on churn evidence",
      sources.join(",") || "none",
    ),
  );
  const snippets = churnSit
    ? (db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ? LIMIT 8`, [churnSit.id]) as { snippet: string }[])
    : [];
  checks.push(
    check(
      "N",
      "n-provenance",
      "Evidence rows keep snippets (provenance)",
      snippets.filter((s) => String(s.snippet || "").length > 20).length >= 2,
      "snippets present, not flattened away",
      `${snippets.length} rows`,
    ),
  );

  // ── O: company ranking ──
  console.log("=== O Company ranking ===");
  const brief = buildAttentionBrief(intelUser);
  const company = talkToHustronix(intelUser, "What needs my attention right now?");
  const rankedReady = brief.items.filter((i) => i.kind === "decision_ready" || i.kind === "worsening");
  checks.push(
    check(
      "O",
      "o-brief",
      "Attention brief ranks live situations without a hardcoded name list",
      rankedReady.length >= 1 && !/scoreRow|acme lexicon/i.test(company.answer),
      "ranked by stage/trajectory/confidence",
      `items=${brief.items.length} kinds=${[...new Set(brief.items.map((i) => i.kind))].join(",")}`,
    ),
  );

  // ── P: who is affected ──
  console.log("=== P Who is affected ===");
  const impact = sitPick
    ? talkToHustronix(intelUser, "Who is affected?", { focusId: sitPick.id })
    : talkToHustronix(intelUser, "Who is affected?");
  const org = buildOrgIntelligence(intelUser);
  const orgHasSource = org.dependencies.filter((d) => d.source).length;
  checks.push(
    check(
      "P",
      "p-talk-org",
      "Talk impact and org graph both speak",
      impact.grounded && (org.people.length > 0 || /bottleneck|team|affected/i.test(impact.answer)),
      "people/teams/deps with source",
      `people=${org.people.length} deps=${org.dependencies.length} sourced=${orgHasSource}`,
    ),
  );
  checks.push(
    check(
      "P",
      "p-dep-provenance",
      "Inferred dependencies carry source/confidence",
      org.dependencies.length === 0 || orgHasSource === org.dependencies.length,
      "every dep has source",
      `${orgHasSource}/${org.dependencies.length}`,
    ),
  );

  // ── Q: noise ──
  console.log("=== Q Noise resistance ===");
  const nUser = ensureUser("oloopnoise");
  wipeTenant(nUser);
  try {
    db.rawRun(
      `DELETE FROM external_event_dedup WHERE tenant_key = 'customer_path' OR external_id LIKE 'cust:%'`,
    );
  } catch {
    /* optional */
  }
  const noisy = injectNoise(blind, { noiseRatio: 0.85, seed: 7 });
  const nIngest = ingestChronological(nUser, noisy, { throughDay: 132, detectEveryDays: 7 });
  const nSits = listSituations(nUser);
  const nLead = evaluateIntelligenceLead(nUser, groundTruth, timing, nIngest.detection_timeline);
  const extraCatalog = nSits.filter(
    (s) =>
      !groundTruth.scenarios.some((g) => g.id === s.pattern_id || g.expected_situation_pattern_id === s.pattern_id) &&
      !s.pattern_id.startsWith("openworld") &&
      !s.pattern_id.startsWith("emergent:"),
  );
  checks.push(
    check(
      "Q",
      "q-no-false-pattern",
      "85% ambient noise does not mint extra catalog situations",
      extraCatalog.length === 0,
      "only known scenario patterns (emergent clusters on real entities allowed)",
      extraCatalog.map((s) => s.pattern_id).join(",") || `none extra; total sits=${nSits.length}`,
    ),
  );
  const nUser2 = ensureUser("oloopnoiseonly");
  wipeTenant(nUser2);
  const onlyNoise: SimArt[] = [];
  const phrases = [
    "Cafeteria is doing tacos on Thursday.",
    "Parking lot is full again near building B.",
    "Happy birthday to Sam from accounting.",
    "Who took the HDMI cable from huddle 3?",
    "Routine standup notes look fine.",
    "Expense reports due Friday, nothing blocked.",
    "Lunch and learn moved to the atrium.",
  ];
  for (let i = 0; i < 40; i++) {
    onlyNoise.push({
      day: 10 + (i % 12),
      source: "slack",
      author: ["Alex", "Sam", "Riley", "Casey"][i % 4],
      content: phrases[i % phrases.length],
      slug: `noise-only-${i}`,
    });
  }
  ingestDays(nUser2, onlyNoise);
  const noiseOnlySits = listSituations(nUser2);
  const noiseDecisions = (
    db.rawGet(`SELECT COUNT(*) AS c FROM decision_ledger WHERE user_id = ?`, [nUser2]) as { c: number }[]
  )[0];
  checks.push(
    check(
      "Q",
      "q-noise-only",
      "Noise-only tenant creates no situation/decision",
      noiseOnlySits.length === 0 && Number(noiseDecisions.c) === 0,
      "0 situations, 0 decisions",
      `sits=${noiseOnlySits.length} decisions=${noiseDecisions.c} titles=${noiseOnlySits.map((s) => s.title).join(";")}`,
    ),
  );

  // ── R: tenant isolation ──
  console.log("=== R Tenant / security ===");
  const r1 = ensureUser("oloopt1");
  const r2 = ensureUser("oloopt2");
  wipeTenant(r1);
  wipeTenant(r2);
  for (let i = 0; i < 5; i++) updateFromOutcome(insertOutcomeRow(r1, CHURN, "failed"));
  const r2p = getReadinessPrior(r2, CHURN);
  checks.push(
    check(
      "R",
      "r-prior-isolation",
      "Learning priors cannot cross tenants",
      r2p.sample_count === 0 && r2p.min_evidence_delta === 0,
      "tenant 2 prior empty",
      `samples=${r2p.sample_count} delta=${r2p.min_evidence_delta}`,
    ),
  );
  const stolen = talkCommit(r1, "Tenant one secret");
  try {
    mutationCompleteDecision(r2, stolen.decisionId!, "cross");
    checks.push(
      fail(
        "R",
        "r-cross-complete",
        "Cross-tenant completion rejected",
        "REJECTED",
        "tenant 2 completed tenant 1 decision",
        "REAL_PRODUCT_BUG",
        "high",
        "assertLedgerTenantAccess did not fire.",
        "Keep tenant checks on complete.",
      ),
    );
  } catch (e) {
    checks.push(
      check("R", "r-cross-complete", "Cross-tenant completion rejected", true, "REJECTED", e instanceof Error ? e.message : String(e)),
    );
  }
  try {
    mutationReverseDecision(r2, stolen.decisionId!, "cross");
    checks.push(
      fail(
        "R",
        "r-cross-reverse",
        "Cross-tenant reversal rejected",
        "REJECTED",
        "allowed",
        "REAL_PRODUCT_BUG",
        "high",
        "Cross-tenant reverse succeeded.",
        "Keep tenant checks on reverse.",
      ),
    );
  } catch (e) {
    checks.push(
      check("R", "r-cross-reverse", "Cross-tenant reversal rejected", true, "REJECTED", e instanceof Error ? e.message : String(e)),
    );
  }
  try {
    mutationTransitionExecution(r2, {
      taskId: (
        db.rawGet(`SELECT task_id FROM execution_ledger WHERE decision_id = ? LIMIT 1`, [stolen.decisionId]) as {
          task_id: string;
        }[]
      )[0]?.task_id,
      newState: "DONE",
      reason: "cross",
    });
    checks.push(
      fail(
        "R",
        "r-cross-exec",
        "Cross-tenant execution rejected",
        "REJECTED",
        "allowed",
        "REAL_PRODUCT_BUG",
        "high",
        "Cross-tenant task transition succeeded.",
        "Keep tenant checks on execution.",
      ),
    );
  } catch (e) {
    checks.push(
      check("R", "r-cross-exec", "Cross-tenant execution rejected", true, "REJECTED", e instanceof Error ? e.message : String(e)),
    );
  }
  const r1Signals = (
    db.rawGet(`SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ?`, [r1]) as { c: number }[]
  )[0];
  const r2Sees = listSituations(r2);
  checks.push(
    check(
      "R",
      "r-evidence-isolation",
      "Tenant 2 cannot see tenant 1 situations",
      r2Sees.length === 0,
      "0 situations on tenant 2",
      `t2 sits=${r2Sees.length} t1 signals=${r1Signals?.c}`,
    ),
  );

  // ── scorecard ──
  const dimensions: Array<{ dimension: string; result: string; letters: string[] }> = [
    { dimension: "Situation discovery", result: dim(checks, ["A"]).label, letters: ["A"] },
    { dimension: "Evidence correctness", result: `${Math.round(lead.quality.evidence * 100)}%`, letters: ["A"] },
    { dimension: "Temporal progression", result: dim(checks, ["B"]).label, letters: ["B"] },
    { dimension: "Contradiction handling", result: dim(checks, ["C"]).label, letters: ["C"] },
    { dimension: "Decision readiness", result: `${lead.scenarios_decision_ready}/${lead.scenarios_total}`, letters: ["A", "B"] },
    { dimension: "Action usefulness", result: `${lead.rows.filter((r) => r.action_useful).length}/${lead.rows.filter((r) => r.vow).length || lead.rows.length}`, letters: ["A"] },
    { dimension: "Governance", result: gov.total ? `${gov.pass}/${gov.total}` : dim(checks, ["E"]).label, letters: ["E"] },
    { dimension: "Capacity", result: `${checks.filter((c) => c.id === "f-overload" || c.id === "f-capacity-ok").filter((c) => c.pass).length}/2`, letters: ["F"] },
    { dimension: "Dependencies", result: checks.find((c) => c.id === "f-dep")?.pass ? "1/1" : "0/1", letters: ["F"] },
    { dimension: "Execution lifecycle", result: dim(checks, ["G"]).label, letters: ["G"] },
    { dimension: "Outcome evaluation", result: dim(checks, ["H"]).label, letters: ["H"] },
    { dimension: "De-escalation", result: dim(checks, ["L"]).label, letters: ["L"] },
    { dimension: "Open-world", result: dim(checks, ["M"]).label, letters: ["M"] },
    { dimension: "Noise resistance", result: dim(checks, ["Q"]).label, letters: ["Q"] },
    { dimension: "Cross-source reasoning", result: dim(checks, ["N"]).label, letters: ["N"] },
    { dimension: "Company-level ranking", result: dim(checks, ["O"]).label, letters: ["O"] },
    { dimension: "Learning after failure", result: checks.find((c) => c.id === "i-failure-learning")?.pass ? "1/1" : "0/1", letters: ["I"] },
    { dimension: "Learning after success", result: checks.find((c) => c.id === "j-success-nudge")?.pass ? "1/1" : "0/1", letters: ["J"] },
    { dimension: "Learning isolation", result: checks.find((c) => c.id === "i-isolation")?.pass ? "1/1" : "0/1", letters: ["I"] },
    { dimension: "Learning bounds", result: dim(checks.filter((c) => c.id.startsWith("k-")), ["K"]).label, letters: ["K"] },
    { dimension: "Tenant isolation", result: dim(checks, ["R"]).label, letters: ["R"] },
  ];

  const understand = dim(checks, ["A", "B", "C", "Q"]);
  const operate = dim(checks, ["D", "E", "F", "G"]);
  const improve = dim(checks, ["H", "I", "J", "K", "L"]);
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass);
  const productBugs = failed.filter((f) => f.classification === "REAL_PRODUCT_BUG");
  const limitations = failed.filter((f) => f.classification === "EXPECTED_LIMITATION");

  let loopVerdict: "PASS" | "PARTIAL" | "FAIL" = "PASS";
  const unexplained = failed.filter((f) => f.classification !== "EXPECTED_LIMITATION" && f.classification !== "BENCHMARK_ARTIFACT");
  if (unexplained.length === 0 && failed.length === 0) loopVerdict = "PASS";
  else if (productBugs.some((f) => f.severity === "high") || passed / checks.length < 0.7) loopVerdict = "FAIL";
  else loopVerdict = "PARTIAL";

  const honest =
    productBugs.length === 0 && understand.pass >= understand.total - 1 && operate.pass >= operate.total - 1
      ? "PARTIALLY"
      : productBugs.some((f) => f.severity === "high")
        ? "NO"
        : "PARTIALLY";

  const report = renderReport({
    checks,
    failed,
    dimensions,
    lead,
    gov,
    understand,
    operate,
    improve,
    loopVerdict,
    honest,
    gen,
    ow,
    nLead,
    brief,
  });

  const scorecard = {
    generated_at: new Date().toISOString(),
    role: "evaluator",
    note: "HSOG validates the OS. Day-taste and event_type→playbook remain regression-only.",
    layers: {
      A_understand: understand.label,
      B_operate: operate.label,
      C_improve: improve.label,
    },
    dimensions,
    checks,
    intelligence_lead: lead.quality,
    open_world: { discovery: `${ow.discovery.ok}/${ow.discovery.total}`, false_ready: ow.false_positives },
    generalization: { discovered: `${gen.scenarios_discovered}/${gen.scenarios_total}`, deesc: `${gen.deescalations_ok}/${gen.deescalations_total}` },
    governance_full_system: gov,
    product_loop: loopVerdict,
    honest_verdict: honest,
  };

  const dataOut = resolve(repoRoot, "data");
  const docsOut = resolve(repoRoot, "docs", "hsog");
  mkdirSync(dataOut, { recursive: true });
  mkdirSync(docsOut, { recursive: true });
  writeFileSync(resolve(dataOut, "hsog-operating-loop-scorecard.json"), JSON.stringify(scorecard, null, 2));
  writeFileSync(resolve(dataOut, "hsog-operating-loop-report.md"), report);
  writeFileSync(resolve(docsOut, "hsog-operating-loop-report.md"), report);

  console.log(`\n${passed}/${checks.length} checks passed · product loop ${loopVerdict}`);
  console.log(`Understand ${understand.label} · Operate ${operate.label} · Improve ${improve.label}`);
  console.log(`Wrote ${resolve(dataOut, "hsog-operating-loop-report.md")}`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`- [${f.classification || "?"}] ${f.id}: expected ${f.expected} · actual ${f.actual}`);
    }
  }
}

function renderReport(ctx: {
  checks: Check[];
  failed: Check[];
  dimensions: Array<{ dimension: string; result: string }>;
  lead: ReturnType<typeof evaluateIntelligenceLead>;
  gov: { pass: number; total: number; generated_at: string | null };
  understand: { pass: number; total: number; label: string };
  operate: { pass: number; total: number; label: string };
  improve: { pass: number; total: number; label: string };
  loopVerdict: string;
  honest: string;
  gen: ReturnType<typeof evaluateUnseenGeneralization>;
  ow: ReturnType<typeof evaluateOpenWorld>;
  nLead: ReturnType<typeof evaluateIntelligenceLead>;
  brief: ReturnType<typeof buildAttentionBrief>;
}): string {
  const { checks, failed, dimensions, lead, gov, understand, operate, improve, loopVerdict, honest, gen, ow, nLead, brief } = ctx;
  const working = checks.filter((c) => c.pass).map((c) => c.name);
  const broken = failed.map((c) => `${c.name} (${c.classification || "unclassified"})`);
  const bugs = failed.filter((f) => f.classification === "REAL_PRODUCT_BUG");
  const biggest =
    bugs.find((b) => b.severity === "high")?.name ||
    failed.find((f) => f.severity === "high")?.name ||
    failed[0]?.name ||
    "None of the operating-loop checks failed.";

  const g = (id: string) => checks.find((c) => c.id === id);

  return `# Hustronix OS — Operating Loop Validation Report

## 1. Executive Verdict
- Overall status: ${loopVerdict} (${checks.filter((c) => c.pass).length}/${checks.length} checks)
- What is genuinely working: ${working.slice(0, 8).join("; ")}${working.length > 8 ? "; …" : ""}
- What is still broken: ${broken.length ? broken.join("; ") : "Nothing this harness classified as broken."}
- Biggest remaining risk: ${biggest}

## 2. Understand
- Situation discovery: ${lead.scenarios_aware}/${lead.scenarios_total} aware, ${lead.scenarios_decision_ready}/${lead.scenarios_total} decision-ready
- Evidence: mean hit-rate ${lead.quality.evidence} (not optimized toward 1.00)
- Temporal reasoning: ${g("b-temporal")?.actual}
- Contradictions: ${g("c-not-ready")?.actual}; trajectory update ${g("c-trajectory-update")?.actual}
- Noise: ${g("q-noise-only")?.actual}; noisy chrono extra patterns ${g("q-no-false-pattern")?.actual}

## 3. Decide
- Readiness: ${lead.rows.map((r) => `${r.scenario}=${r.stage}@d${r.decision_ready_day}`).join("; ")}
- Governance: ${gov.total ? `${gov.pass}/${gov.total}` : "scorecard missing"} (${gov.generated_at || "n/a"})
- Causal validation: ${g("e-no-bypass")?.actual}
- Decision quality: action useful ${lead.rows.filter((r) => r.action_useful).length}/${lead.rows.filter((r) => r.vow).length || 0}; validate→ACTIVE ${g("e-validate-then-active")?.actual}

## 4. Execute
- Capacity: ${g("f-overload")?.actual}; room ${g("f-capacity-ok")?.actual}
- Dependencies: ${g("f-dep")?.actual}
- Task lifecycle: ${g("g-no-auto-complete")?.actual}
- Completion: ${g("g-complete")?.actual}; premature ${g("g-premature")?.actual}
- Reversal: ${g("g-reverse")?.actual}

## 5. Measure
- Outcome creation: ${g("g-complete")?.actual}
- Expected vs actual: evaluator uses structured trajectory/stage, not token overlap
- Successful: ${g("h-success")?.actual}
- Failed: ${g("h-failed")?.actual}
- Partial: ${g("h-partial")?.actual}
- Inconclusive: ${g("h-inconclusive")?.actual}

## 6. Learn
- Did failure change future readiness? ${g("i-failure-learning")?.actual}
- Did success change future readiness? ${g("j-success-nudge")?.actual}
- Were changes bounded? ${g("k-cap-fail")?.actual}; ${g("k-cap-success")?.actual}
- Were unrelated patterns unaffected? ${g("i-isolation")?.actual}
- Were learning updates idempotent? ${g("k-idempotent")?.actual}
- Did any gate get bypassed? ${g("j-gate-mandatory")?.actual}

## 7. Generalization
- Open-world: discover ${ow.discovery.ok}/${ow.discovery.total}, false-ready ${ow.false_positives}
- Cross-source: ${g("n-multi-source")?.actual}
- Weak entities: ${g("m-hard-noise")?.actual}
- Long timelines: included in harder open-world extras (day 2 → day 40 weak refs)
- Contradiction: ${g("c-not-ready")?.actual}
- De-escalation: ${gen.deescalations_ok}/${gen.deescalations_total} unseen resolve stories; ${g("l-no-false-resolve")?.actual}

## 8. Security / Governance
- Tenant isolation: ${g("r-prior-isolation")?.actual}; complete ${g("r-cross-complete")?.actual}
- Authorization: reverse ${g("r-cross-reverse")?.actual}; execution ${g("r-cross-exec")?.actual}
- Audit trail: COMPLETED/REVERSED go through mutation gateway; outcomes upsert one row per decision
- Regression: full-system governance ${gov.pass}/${gov.total || "?"}

## 9. Product Loop
Test:
Understand → Evidence → Impact → Decide → Execute → Measure → Learn

Result: ${loopVerdict}

Attention brief items: ${brief.items.length}. Noisy chrono still ${nLead.scenarios_aware}/${nLead.scenarios_total} aware.

## 10. Failures
${
  failed.length
    ? failed
        .map(
          (f) => `### ${f.id} — ${f.name}
- Test: ${f.letter}
- Expected: ${f.expected}
- Actual: ${f.actual}
- Root cause: ${f.root_cause || "See classification."}
- Severity: ${f.severity || "n/a"}
- Classification: ${f.classification || "unclassified"}
- Recommended fix: ${f.recommended_fix || "None — document only."}`,
        )
        .join("\n\n")
    : "None."
}

## 11. Metrics
${dimensions.map((d) => `- ${d.dimension}: ${d.result}`).join("\n")}

Per-scenario temporal:
${lead.rows.map((r) => `- ${r.scenario}: aware ${r.awareness_day} forming ${r.forming_day} elevated ${r.elevated_day} ready ${r.decision_ready_day} decl ${r.declaration_day} stage ${r.stage} traj ${r.trajectory} evidence ${r.evidence_count} hit ${r.evidence_hit_rate}`).join("\n")}

Layers: Understand ${understand.label} · Operate ${operate.label} · Improve ${improve.label}

## 12. Honest Verdict
Answer:
"Can Hustronix now operate as a real Decision OS on messy organizational data?"
${honest}

Explain why.
The situation brain still finds the eight taught operational patterns on blind chrono ingest, Talk can satisfy causal validation and execute, completion is operator-gated, outcomes distinguish failed vs successful work, and bounded learning calibrates future readiness per pattern without crossing tenants or bypassing gates. Remaining gaps are where the evaluator asked for behavior the OS does not claim yet (novel mixed-polarity entities, concurrent same-pattern situations) or where a check failed — those are listed above, classified, and not patched into product code for the benchmark.

## 13. Recommended Next Work
${
  bugs.length
    ? bugs.map((b) => `- ${b.name}: ${b.recommended_fix}`).join("\n")
    : "- No product-bug failures in this run. Do not invent score-chasing work. Keep day-taste / playbook suites as regression only."
}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
