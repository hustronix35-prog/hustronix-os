import { db } from "../../database.js";
import { createEntity } from "../../entities/store.js";
import { reprocessUnenrichedSignals } from "../../intelligence/index.js";
import { ingestExternalBatch } from "../ingestRouter.js";
import { notify, defaultAppLink } from "../../notifications/dispatcher.js";
import {
  mutationCommitDecision,
  mutationCreateDraftDecision,
  mutationLinkSignal,
  mutationTransitionExecution,
} from "../../security/mutation-handlers.js";
import { resolveTenantContext } from "../../security/tenant-context.js";
import { artifactToIngestRecord } from "./artifactMap.js";
import { loadHsogBundle } from "./loadBundle.js";
import type { HsogIngestBundle, HsogIngestOptions, HsogIngestResult, HsogPerson } from "./types.js";

type Playbook = {
  vow: string;
  constraints: string[];
  tasks: { owner: string; success_condition: string; weight?: number }[];
  alert?: { title: string; body: string };
};

const PLAYBOOKS: Record<string, Playbook> = {
  product_launch_slip: {
    vow: "Hold NexusAI 2.0 GA until decision-trail evidence links pass the launch gate.",
    constraints: ["Do not ship without retrieval-trace coverage", "Do not silently slip Acme dates"],
    tasks: [
      { owner: "Imani", success_condition: "Launch checklist green including NEX-418 evidence links" },
      { owner: "Renata", success_condition: "P1 evidence-link bug closed with regression tests" },
      { owner: "Elena", success_condition: "Customer-facing slip communication sent" },
    ],
    alert: {
      title: "NexusAI 2.0 launch slipped 21 days",
      body: "Engineering/Security yellow on evidence trails. Acme was overpromised. Decide whether to hold GA.",
    },
  },
  customer_churn_risk: {
    vow: "Save the Acme Industrials renewal by closing ingestion latency and the NexusAI overpromise gap.",
    constraints: ["Do not discount without CFO review", "Do not hide health-score drop from exec"],
    tasks: [
      { owner: "Jordan", success_condition: "Acme health score plan + weekly exec update" },
      { owner: "Ethan", success_condition: "SignalGrid ingestion SLA restored for Acme" },
    ],
    alert: {
      title: "Acme renewal risk is high",
      body: "Health score 58. Competitor mentioned. Renewal decision is due.",
    },
  },
  security_incident: {
    vow: "Close the SEV1 support access exception and complete audit evidence before customer packets go out.",
    constraints: ["Do not grant new admin exceptions without expiry", "Do not claim no-exfil without evidence"],
    tasks: [
      { owner: "Omar", success_condition: "SEV1 closed with confirmed scope" },
      { owner: "Noor", success_condition: "Expired admin exception remediated + evidence register updated" },
    ],
    alert: {
      title: "SEV1: unusual export from support tooling",
      body: "Expired admin exception. No confirmed exfil yet. Northstar audit packet is blocked.",
    },
  },
  infrastructure_outage: {
    vow: "Restore SignalGrid ingestion SLA and finish the deferred partitioning work.",
    constraints: ["Do not mute Kafka lag alerts without owner", "Do not defer reliability for launch again"],
    tasks: [
      { owner: "Ethan", success_condition: "Ingestion delay under SLA for all affected customers" },
      { owner: "Priya", success_condition: "Partitioning tickets un-deferred with dates" },
    ],
    alert: {
      title: "SignalGrid ingestion SEV1",
      body: "SLA miss for three customers. Deferred partitioning is a contributing factor.",
    },
  },
  sales_forecast_miss: {
    vow: "Rebuild Q3 forecast from current Acme/Northstar risk, not stale CRM green.",
    constraints: ["Do not keep commit stage when CS health is red", "Do not surprise CEO on coverage"],
    tasks: [
      { owner: "Marcus", success_condition: "Forecast restated with current risk fields" },
      { owner: "Helen", success_condition: "Coverage gap briefed to exec" },
    ],
  },
  hiring_freeze: {
    vow: "Enforce hiring freeze with only GRC analyst + SRE exceptions.",
    constraints: ["No unapproved backfills", "Exceptions require Maya + Helen"],
    tasks: [
      { owner: "Leah", success_condition: "Freeze policy published in HRIS + Confluence" },
      { owner: "Helen", success_condition: "GRC + SRE exceptions documented" },
    ],
  },
  enterprise_deal_red_flags: {
    vow: "Do not mark SentryLine as commit until NexusAI trails are audit-ready.",
    constraints: ["No custom residency without legal + security", "No commit on incomplete traces"],
    tasks: [
      { owner: "Noor", success_condition: "Audit-complete trace checklist signed" },
      { owner: "Caleb", success_condition: "Residency requirement dispositioned" },
    ],
  },
  feature_quality_regression: {
    vow: "Keep FlowOps nested-approval flag off for GA customers until QA edge cases pass.",
    constraints: ["Do not re-enable flag for Kaldera without QA sign-off"],
    tasks: [
      { owner: "Skye", success_condition: "Nested approval groups covered by tests" },
      { owner: "Chris", success_condition: "Feature flag remains off outside beta" },
    ],
  },
};

const ALERT_EVENT_TYPES = new Set([
  "launch_gate_failed",
  "incident_declared",
  "renewal_risk_detected",
  "hiring_freeze_started",
  "security_alert_triggered",
]);

function talentTier(seniority?: string): string | undefined {
  if (!seniority) return undefined;
  if (seniority === "executive") return "A";
  if (seniority === "principal" || seniority === "staff" || seniority === "lead") return "B";
  if (seniority === "senior") return "C";
  return undefined;
}

function seedEntities(orgId: string, bundle: HsogIngestBundle): number {
  let n = 0;
  const company = bundle.company || {};
  const companyId = String(company.id || "hustronix-systems");
  const companyName = String(company.name || company.short_name || "Hustronix Systems");
  createEntity({
    tenantId: orgId,
    type: "company",
    refId: companyId,
    label: companyName,
    metadata: { origin: "hsog", ...company },
    confidence: 0.95,
  });
  n += 1;

  for (const d of bundle.departments || []) {
    createEntity({
      tenantId: orgId,
      type: "team",
      refId: d.id,
      label: d.name,
      metadata: { origin: "hsog", leader_id: d.leader_id },
      confidence: 0.9,
    });
    n += 1;
  }
  for (const p of bundle.products || []) {
    createEntity({
      tenantId: orgId,
      type: "feature",
      refId: p.id,
      label: p.name,
      metadata: { origin: "hsog", subtype: "product", category: p.category },
      confidence: 0.9,
    });
    n += 1;
  }
  for (const p of bundle.projects || []) {
    createEntity({
      tenantId: orgId,
      type: "project",
      refId: p.id,
      label: p.name,
      metadata: { origin: "hsog", ...p },
      confidence: 0.9,
    });
    n += 1;
  }
  for (const c of bundle.customers || []) {
    createEntity({
      tenantId: orgId,
      type: "customer",
      refId: c.id,
      label: c.name,
      metadata: { origin: "hsog", ...c },
      confidence: 0.9,
    });
    n += 1;
  }
  for (const p of bundle.people || []) {
    createEntity({
      tenantId: orgId,
      type: "person",
      refId: p.id,
      label: p.name,
      metadata: { origin: "hsog", role: p.role, department: p.department, email: p.email },
      confidence: 0.85,
    });
    n += 1;
  }
  return n;
}

function seedRoster(userId: string, people: HsogPerson[]): number {
  let n = 0;
  for (const p of people) {
    const email = (p.email || `${p.id}@hustronix.io`).toLowerCase();
    db.upsertTeamRosterByEmail(userId, {
      name: p.name,
      email,
      role: p.role || "Member",
      team: p.department || "General",
      capacity: "40h / week",
      slackId: p.first_name || p.name.split(/\s+/)[0],
      talentTier: talentTier(p.seniority),
    });
    n += 1;
  }
  return n;
}

function applyOrgProfile(userId: string, bundle: HsogIngestBundle): void {
  const c = bundle.company || {};
  const name = String(c.short_name || c.name || "Hustronix Systems");
  const patch: Record<string, string> = {
    "org.name": name,
    "org.value_prop_one_liner": String(
      c.industry || "B2B SaaS for industrial operations — FlowOps, SignalGrid, NexusAI.",
    ),
    "org.company_stage": String(c.stage || "Series C"),
    "org.team_size_band": "200+",
    "org.stack_snapshot": "Slack, Jira, GitHub, Confluence, CRM, email, SIEM",
    "org.agent_context_digest": [
      `Organization: ${c.name || name}`,
      `Industry: ${c.industry || ""}`,
      `HQ: ${c.headquarters || ""}`,
      `Products: FlowOps, SignalGrid, NexusAI`,
      `Benchmark seed: ${bundle.seed || "hsog-2026-08"}`,
    ].join("\n"),
  };
  for (const [k, v] of Object.entries(patch)) db.updateSetting(userId, k, v);
}

function alreadyNotified(userId: string, title: string): boolean {
  const rows = db.rawGet(
    `SELECT id FROM notifications WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, title],
  ) as { id: string }[];
  return rows.length > 0;
}

function seedDecisions(
  userId: string,
  bundle: HsogIngestBundle,
  activateScenarioId: string | null,
): { created: number; activated: string | null; byScenario: Record<string, string> } {
  let created = 0;
  let activated: string | null = null;
  const byScenario: Record<string, string> = {};
  const scenarioIds = [...new Set((bundle.events || []).map((e) => e.scenario_id))];

  for (const sid of scenarioIds) {
    const play = PLAYBOOKS[sid];
    if (!play) continue;
    const title = bundle.scenarios?.find((s) => s.id === sid)?.title || sid;
    const { id } = mutationCreateDraftDecision(userId, {
      vow: play.vow,
      expected_outcomes: [{ metric: title, target: "Resolve with cited evidence" }],
      constraints: play.constraints,
      tasks: play.tasks.map((t) => ({
        type: "ACTION",
        owner: t.owner,
        weight: t.weight ?? 1,
        success_condition: t.success_condition,
      })),
    });
    if (db.getDecisionTenant(id) !== userId) {
      console.warn(`[hsog] skipped cross-tenant decision hit for ${sid}`);
      continue;
    }
    created += 1;
    byScenario[sid] = id;

    if (activateScenarioId && sid === activateScenarioId && !activated) {
      try {
        mutationCommitDecision(userId, id, "HSOG taste ingest — activate primary scenario");
        activated = id;
      } catch (e) {
        console.warn("[hsog] could not activate decision:", e instanceof Error ? e.message : e);
      }
    }
  }
  return { created, activated, byScenario };
}

function linkScenarioSignals(userId: string, byScenario: Record<string, string>): void {
  for (const [sid, decisionId] of Object.entries(byScenario)) {
    const tasks = db.rawGet(
      `SELECT task_id FROM execution_ledger WHERE decision_id = ? ORDER BY rowid ASC`,
      [decisionId],
    ) as { task_id: string }[];
    const firstTask = tasks[0]?.task_id;
    if (!firstTask) continue;
    const scenarioSignals = db.rawGet(
      `SELECT id FROM external_signals
       WHERE user_id = ? AND json_extract(ingest_meta, '$.hsog_scenario_id') = ?
       ORDER BY detected_at ASC LIMIT 8`,
      [userId, sid],
    ) as { id: string }[];
    for (const sig of scenarioSignals.slice(0, 4)) {
      try {
        mutationLinkSignal(userId, {
          signalId: sig.id,
          taskId: firstTask,
          linkMethod: "hsog_scenario",
          linkProvenance: { scenario_id: sid, origin: "hsog" },
        });
      } catch {
        /* auditor may block some links; signals still remain */
      }
    }
  }
}

async function notifyHsogAlerts(
  userId: string,
  bundle: HsogIngestBundle,
  byScenario: Record<string, string>,
): Promise<number> {
  let notifications = 0;
  for (const [sid, id] of Object.entries(byScenario)) {
    const play = PLAYBOOKS[sid];
    if (!play?.alert || alreadyNotified(userId, play.alert.title)) continue;
    await notify(userId, {
      kind: "decision.hsog",
      title: play.alert.title,
      body: play.alert.body,
      linkUrl: defaultAppLink("/decide"),
      payload: { scenario_id: sid, decision_id: id, origin: "hsog" },
    });
    notifications += 1;
  }

  for (const ev of bundle.events || []) {
    if (!ALERT_EVENT_TYPES.has(ev.event_type)) continue;
    if (ev.visibility_scope && !/company|executive/.test(ev.visibility_scope) && ev.event_type !== "incident_declared") {
      continue;
    }
    const title = `${ev.event_type.replace(/_/g, " ")} · day ${ev.day}`;
    if (alreadyNotified(userId, title)) continue;
    await notify(userId, {
      kind: "signal.hsog",
      title,
      body: ev.summary || ev.event_id,
      linkUrl: defaultAppLink("/alerts"),
      payload: { event_id: ev.event_id, scenario_id: ev.scenario_id, day: ev.day, origin: "hsog" },
    });
    notifications += 1;
  }
  return notifications;
}

/** Activate PENDING tasks under ACTIVE decisions, stopping at owner capacity. */
export function startHsogSprint(userId: string): { activated: number; blocked: number } {
  const tasks = db.rawGet(
    `SELECT e.task_id, e.owner
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ? AND d.status = 'ACTIVE' AND e.status = 'PENDING'
     ORDER BY e.priority DESC, e.rowid ASC`,
    [userId],
  ) as { task_id: string; owner: string }[];
  let activated = 0;
  let blocked = 0;
  for (const t of tasks) {
    try {
      const out = mutationTransitionExecution(userId, {
        taskId: t.task_id,
        newState: "ACTIVE",
        reason: "HSOG start-sprint",
      });
      if (String(out.status) === "ACTIVE") activated += 1;
      else blocked += 1;
    } catch {
      blocked += 1;
    }
  }
  return { activated, blocked };
}

export async function ingestHsogBundle(
  bundlePath: string | undefined,
  opts: HsogIngestOptions,
): Promise<HsogIngestResult> {
  const { path, bundle } = loadHsogBundle(bundlePath || "");
  return runHsogIngest(bundle, path, opts);
}

export async function runHsogIngest(
  bundle: HsogIngestBundle,
  path: string,
  opts: HsogIngestOptions,
): Promise<HsogIngestResult> {
  const user = db.getUserById(opts.userId) || db.getUser(opts.userId);
  if (!user) throw new Error(`Unknown user: ${opts.userId}`);
  const userId = (user as { id: string }).id;
  const ctx = resolveTenantContext(userId);

  const events = bundle.events || [];
  const records = [];
  for (const event of events) {
    for (const artifact of event.artifacts || []) {
      records.push(
        artifactToIngestRecord({
          tenantId: userId,
          startDate: bundle.start_date || "2026-02-02",
          event,
          artifact,
        }),
      );
    }
  }

  if (opts.dryRun) {
    return {
      userId,
      orgId: ctx.orgId,
      bundle: {
        path,
        events: events.length,
        artifacts: records.length,
        people: bundle.people?.length || 0,
        customers: bundle.customers?.length || 0,
      },
      signals: { inserted: 0, duplicates: 0, errors: 0 },
      entities: { upserted: 0 },
      roster: { upserted: 0 },
      decisions: { created: 0, activated: null },
      sprint: { activated: 0, blocked: 0 },
      notifications: 0,
      enriched: 0,
    };
  }

  if (opts.orgProfile) applyOrgProfile(userId, bundle);

  const entitiesUpserted = seedEntities(ctx.orgId, bundle);
  const rosterUpserted = seedRoster(userId, bundle.people || []);

  let decisions = { created: 0, activated: null as string | null };
  let byScenario: Record<string, string> = {};
  let notifications = 0;
  if (opts.decisions !== false) {
    const activate =
      opts.activateScenarioId === null || opts.activateScenarioId === ""
        ? null
        : (opts.activateScenarioId ?? "product_launch_slip");
    const seeded = seedDecisions(userId, bundle, activate);
    decisions = { created: seeded.created, activated: seeded.activated };
    byScenario = seeded.byScenario;
  }

  let sprint = { activated: 0, blocked: 0 };
  if (opts.startSprint) sprint = startHsogSprint(userId);

  const batch = ingestExternalBatch(records);
  const inserted = batch.results.filter((r) => !r.duplicate).length;
  const duplicates = batch.results.filter((r) => r.duplicate).length;

  let enriched = 0;
  if (opts.enrich !== false) {
    enriched = await reprocessUnenrichedSignals(userId, 200);
  }

  if (opts.decisions !== false) {
    linkScenarioSignals(userId, byScenario);
    notifications = await notifyHsogAlerts(userId, bundle, byScenario);
  }

  return {
    userId,
    orgId: ctx.orgId,
    bundle: {
      path,
      events: events.length,
      artifacts: records.length,
      people: bundle.people?.length || 0,
      customers: bundle.customers?.length || 0,
    },
    signals: { inserted, duplicates, errors: batch.errors.length },
    entities: { upserted: entitiesUpserted },
    roster: { upserted: rosterUpserted },
    decisions: { created: decisions.created, activated: decisions.activated },
    sprint,
    notifications,
    enriched,
  };
}

export { PLAYBOOKS };
