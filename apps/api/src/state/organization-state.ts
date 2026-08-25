/**
 * OrganizationState compiler — incremental patches over entity/ledger projections.
 */
import { db } from "../database.js";
import type { AuditorWriteContext } from "../auditor-context.js";
import { resolveTenantContext } from "../security/tenant-context.js";
import { listDoctrineRules } from "./doctrine.js";
import { computeDynamicConfidence } from "./confidence.js";
import { saveStateVersion, getCurrentStateVersion } from "./versioning.js";
import { upsertEntityFromRef } from "../entities/store.js";
import { listBeliefs } from "../beliefs/belief-engine.js";

export interface StateItem {
  id?: string;
  label: string;
  entity_id?: string;
  task_id?: string;
  weight?: number;
  severity?: string;
  content?: string;
  statement?: string;
  confidence?: number;
  type?: string;
}

export interface StateSection<T = StateItem> {
  items: T[];
  confidence: number;
  freshness_at: string;
  factors?: ReturnType<typeof computeDynamicConfidence>;
}

export interface OrganizationState {
  objectives: StateSection;
  priorities: StateSection;
  activeDecisions: StateSection;
  blockers: StateSection;
  commitments: StateSection;
  risks: StateSection;
  facts: StateSection;
  beliefs: StateSection;
  doctrine: StateSection;
  externalContext: StateSection;
  teams: Array<{
    team_id: string;
    label: string;
    capacity_hours?: number;
    active_weight?: number;
  }>;
  meta: { version: number; compiled_at: string };
}

export type PromptIntent =
  | "supervisor"
  | "strategy"
  | "execution"
  | "incident"
  | "temporal"
  | "memory";

const DEBOUNCE_MS = 500;
const patchQueues = new Map<string, { timer: ReturnType<typeof setTimeout> | null; events: string[] }>();
const stateCache = new Map<string, OrganizationState>();

export function emptyOrganizationState(version = 0): OrganizationState {
  const now = new Date().toISOString();
  const empty = (): StateSection => ({ items: [], confidence: 0.5, freshness_at: now });
  return {
    objectives: empty(),
    priorities: empty(),
    blockers: empty(),
    commitments: empty(),
    risks: empty(),
    facts: empty(),
    beliefs: empty(),
    doctrine: empty(),
    externalContext: empty(),
    activeDecisions: empty(),
    teams: [],
    meta: { version, compiled_at: now },
  };
}

function sectionConfidence(items: StateItem[], base = 0.55): number {
  if (!items.length) return base * 0.5;
  const factors = computeDynamicConfidence({
    baseEvidenceWeight: base,
    evidenceCount: items.length,
    freshnessAt: new Date().toISOString(),
  });
  return factors.confidence;
}

function tenantFilter(orgId: string, userId: string): { sql: string; params: [string, string, string] } {
  return {
    sql: "(org_id = ? OR user_id IN (?, ?))",
    params: [orgId, orgId, userId],
  };
}

export function compileOrganizationState(orgId: string, userId: string): OrganizationState {
  const now = new Date().toISOString();
  const tf = tenantFilter(orgId, userId);
  const currentVersion = getCurrentStateVersion(orgId)?.version ?? 0;

  const activeRows = db.rawGet(
    `SELECT id, vow, confidence, last_update FROM decision_ledger
     WHERE ${tf.sql} AND status = 'ACTIVE'
     ORDER BY last_update DESC LIMIT 12`,
    tf.params,
  ) as { id: string; vow: string; confidence: number; last_update: string }[];

  const activeDecisions: StateItem[] = activeRows.map((r) => {
    upsertEntityFromRef({ tenantId: orgId, type: "decision", refId: r.id, label: r.vow.slice(0, 200) });
    return { id: r.id, label: r.vow.slice(0, 300), confidence: r.confidence };
  });

  const blockers = db.rawGet(
    `SELECT task_id, success_condition, blocked_reasons, last_update FROM execution_ledger
     WHERE status = 'BLOCKED' AND decision_id IN (
       SELECT id FROM decision_ledger WHERE org_id = ? OR user_id IN (?, ?)
     )
     ORDER BY last_update DESC LIMIT 20`,
    [orgId, orgId, userId],
  ) as { task_id: string; success_condition: string; blocked_reasons: string | null; last_update: string }[];

  const blockerItems: StateItem[] = blockers.map((b) => ({
    task_id: b.task_id,
    label: (b.success_condition || b.task_id).slice(0, 200),
    entity_id: b.task_id,
  }));

  const snapBlockers = db.rawGet(
    `SELECT entity_id, dimension, state, value, confidence FROM entity_state_snapshots
     WHERE tenant_id = ? AND dimension IN ('DEPENDENCY','CUSTOMER_READINESS','TASK_STATUS')
       AND upper(state) = 'BLOCKED'
     ORDER BY last_updated_at DESC LIMIT 20`,
    [orgId],
  ) as Array<{ entity_id: string; dimension: string; state: string; value: string | null; confidence: number }>;
  for (const s of snapBlockers) {
    blockerItems.push({
      id: `${s.entity_id}:${s.dimension}`,
      entity_id: s.entity_id,
      label: `${s.dimension} blocked (${s.entity_id})`,
      severity: "high",
      confidence: s.confidence,
      type: s.dimension,
    });
  }

  const conflictRisks = db.rawGet(
    `SELECT id, entity_id, dimension, severity, status, confidence FROM conflicts
     WHERE tenant_id = ? AND status IN ('OPEN','ESCALATED') AND severity IN ('HIGH','CRITICAL')
     ORDER BY updated_at DESC LIMIT 20`,
    [orgId],
  ) as Array<{
    id: string;
    entity_id: string;
    dimension: string;
    severity: string;
    status: string;
    confidence: number;
  }>;
  const snapRisks = db.rawGet(
    `SELECT entity_id, dimension, state, value, confidence FROM entity_state_snapshots
     WHERE tenant_id = ? AND dimension IN ('LAUNCH_READINESS','CUSTOMER_READINESS','DEADLINE')
       AND upper(state) IN ('AT_RISK','BLOCKED')
     ORDER BY last_updated_at DESC LIMIT 20`,
    [orgId],
  ) as Array<{ entity_id: string; dimension: string; state: string; value: string | null; confidence: number }>;

  const riskItems: StateItem[] = [
    ...conflictRisks.map((c) => ({
      id: c.id,
      entity_id: c.entity_id,
      label: `${c.dimension} conflict (${c.status.toLowerCase()}) on ${c.entity_id}`,
      severity: c.severity.toLowerCase(),
      confidence: c.confidence,
      type: "conflict",
    })),
    ...snapRisks.map((s) => ({
      id: `${s.entity_id}:${s.dimension}`,
      entity_id: s.entity_id,
      label: `${s.dimension}=${s.state} (${s.entity_id})`,
      severity: s.state.toLowerCase() === "blocked" ? "high" : "medium",
      confidence: s.confidence,
      type: s.dimension,
    })),
  ];

  const commitmentRows = db.rawGet(
    `SELECT id, entity_id, entity_label, value, state, confidence, last_seen_at FROM claims
     WHERE tenant_id = ? AND intent = 'COMMITMENT' AND status = 'ACTIVE'
     ORDER BY last_seen_at DESC LIMIT 20`,
    [orgId],
  ) as Array<{
    id: string;
    entity_id: string;
    entity_label: string | null;
    value: string;
    state: string | null;
    confidence: number;
  }>;
  const commitmentItems: StateItem[] = commitmentRows.map((c) => ({
    id: c.id,
    entity_id: c.entity_id,
    label: `${c.entity_label || c.entity_id}: ${c.value}`.slice(0, 240),
    statement: c.value,
    confidence: c.confidence,
    type: c.state || "COMMITMENT",
  }));

  const facts = db.rawGet(
    `SELECT id, content, confidence FROM memory_records
     WHERE tenant_id IN (?, ?) AND verification_state = 'VERIFIED'
     ORDER BY observed_at DESC LIMIT 25`,
    [orgId, userId],
  ) as { id: string; content: string; confidence: number }[];

  const factItems: StateItem[] = facts.map((f) => ({
    id: f.id,
    content: f.content.slice(0, 300),
    label: f.content.slice(0, 120),
    confidence: f.confidence,
  }));

  const ctx = resolveTenantContext(userId);
  const doctrineRules = listDoctrineRules(ctx, "ACTIVE");
  const doctrineItems: StateItem[] = doctrineRules.map((d) => ({
    id: d.id,
    statement: d.statement,
    label: d.statement.slice(0, 200),
    type: d.priority,
  }));

  const worldEntities = db.rawGet(
    `SELECT id, type, label, confidence FROM entities
     WHERE tenant_id IN (?, ?) AND type IN ('competitor', 'customer', 'metric', 'feature')
     ORDER BY freshness_at DESC LIMIT 20`,
    [orgId, userId],
  ) as { id: string; type: string; label: string; confidence: number }[];

  const externalItems: StateItem[] = worldEntities.map((e) => ({
    id: e.id,
    label: e.label,
    type: e.type,
    confidence: e.confidence,
  }));

  const capacityRow = db.getOwnerCapacity("system");
  const activeWeight = db
    .rawGet(
      `SELECT COALESCE(SUM(weight), 0) AS w FROM execution_ledger WHERE status = 'ACTIVE'`,
      [],
    )
    .at(0) as { w: number } | undefined;

  const beliefRows = listBeliefs(orgId).filter((b) => b.status !== "SUPERSEDED");
  const beliefItems: StateItem[] = beliefRows.slice(0, 15).map((b) => ({
    id: b.id,
    statement: b.statement,
    label: b.statement.slice(0, 200),
    confidence: b.confidence,
  }));

  const state: OrganizationState = {
    objectives: {
      items: activeDecisions.slice(0, 1).map((d) => ({ label: d.label, entity_id: d.id })),
      confidence: sectionConfidence(activeDecisions, 0.7),
      freshness_at: now,
    },
    priorities: {
      items: activeDecisions.slice(1).map((d) => ({ label: d.label, entity_id: d.id })),
      confidence: sectionConfidence(activeDecisions.slice(1), 0.6),
      freshness_at: now,
    },
    activeDecisions: {
      items: activeDecisions,
      confidence: sectionConfidence(activeDecisions, 0.75),
      freshness_at: now,
    },
    blockers: {
      items: blockerItems,
      confidence: sectionConfidence(blockerItems, 0.65),
      freshness_at: now,
    },
    commitments: {
      items: commitmentItems,
      confidence: sectionConfidence(commitmentItems, 0.6),
      freshness_at: now,
    },
    risks: {
      items: riskItems,
      confidence: sectionConfidence(riskItems, 0.6),
      freshness_at: now,
    },
    facts: {
      items: factItems,
      confidence: sectionConfidence(factItems, 0.8),
      freshness_at: now,
    },
    beliefs: {
      items: beliefItems,
      confidence: sectionConfidence(beliefItems, 0.55),
      freshness_at: now,
    },
    doctrine: {
      items: doctrineItems,
      confidence: sectionConfidence(doctrineItems, 0.9),
      freshness_at: now,
    },
    externalContext: {
      items: externalItems,
      confidence: sectionConfidence(externalItems, 0.55),
      freshness_at: now,
    },
    teams: [
      {
        team_id: "default",
        label: "Default team",
        capacity_hours: capacityRow?.capacity ?? 10,
        active_weight: activeWeight?.w ?? 0,
      },
    ],
    meta: { version: currentVersion + 1, compiled_at: now },
  };

  stateCache.set(orgId, state);
  return state;
}

export function getOrganizationState(orgId: string, userId: string): OrganizationState {
  const cached = stateCache.get(orgId);
  if (cached) return cached;
  const versionRow = getCurrentStateVersion(orgId);
  if (versionRow) {
    try {
      const parsed = JSON.parse(versionRow.snapshot_json) as OrganizationState;
      stateCache.set(orgId, parsed);
      return parsed;
    } catch {
      /* fall through */
    }
  }
  return compileOrganizationState(orgId, userId);
}

function applyPatchToState(state: OrganizationState, event: string): OrganizationState {
  const next = structuredClone(state) as OrganizationState;
  next.meta = {
    version: (next.meta.version ?? 0) + 1,
    compiled_at: new Date().toISOString(),
  };
  if (event.startsWith("decision:")) next.activeDecisions.freshness_at = next.meta.compiled_at;
  if (event.startsWith("execution:")) next.blockers.freshness_at = next.meta.compiled_at;
  if (event.startsWith("signal:")) next.risks.freshness_at = next.meta.compiled_at;
  return next;
}

function flushPatches(orgId: string, userId: string): void {
  const q = patchQueues.get(orgId);
  if (!q) return;
  patchQueues.set(orgId, { timer: null, events: [] });

  let state = getOrganizationState(orgId, userId);
  for (const ev of q.events) {
    state = applyPatchToState(state, ev);
  }
  state = compileOrganizationState(orgId, userId);
  stateCache.set(orgId, state);
  saveStateVersion({
    tenantId: orgId,
    snapshot: state,
    triggerEvent: q.events.join("|") || "patch",
    author: userId,
  });
}

export function patchOrganizationState(orgId: string, userId: string, event: string): void {
  let q = patchQueues.get(orgId);
  if (!q) {
    q = { timer: null, events: [] };
    patchQueues.set(orgId, q);
  }
  q.events.push(event);
  if (q.timer) clearTimeout(q.timer);
  q.timer = setTimeout(() => flushPatches(orgId, userId), DEBOUNCE_MS);
}

export function onLedgerEventForState(ctx: AuditorWriteContext): void {
  if (ctx.type === "decision" && "decisionId" in ctx) {
    const row = db.getDecisionLedgerRow(ctx.decisionId);
    const orgId = String(row?.org_id ?? row?.user_id ?? "system");
    const userId = String(row?.user_id ?? "system");
    patchOrganizationState(orgId, userId, `decision:${ctx.decisionId}`);
  } else if (ctx.type === "signal" && "signalId" in ctx) {
    const tenant = db.getSignalTenant(ctx.signalId);
    if (tenant) patchOrganizationState(tenant, tenant, `signal:${ctx.signalId}`);
  } else if (ctx.type === "signal_link" && "signalId" in ctx) {
    const tenant = db.getSignalTenant(ctx.signalId);
    if (tenant) patchOrganizationState(tenant, tenant, `signal_link:${ctx.signalId}`);
  }
}

/** Chain ledger auditor hook with incremental state patches. */
export function chainOrganizationStateHook(existing: (ctx: AuditorWriteContext) => void): void {
  db.setLedgerAuditorHook((ctx) => {
    existing(ctx);
    onLedgerEventForState(ctx);
  });
}

export function rebuildOrganizationState(orgId: string, userId: string): OrganizationState {
  stateCache.delete(orgId);
  const state = compileOrganizationState(orgId, userId);
  saveStateVersion({
    tenantId: orgId,
    snapshot: state,
    triggerEvent: "admin_rebuild",
    author: userId,
  });
  return state;
}

export function flushOrganizationStateForTest(orgId?: string): void {
  if (orgId) {
    patchQueues.delete(orgId);
    stateCache.delete(orgId);
    return;
  }
  patchQueues.clear();
  stateCache.clear();
}

const INTENT_SECTIONS: Record<PromptIntent, (keyof OrganizationState)[]> = {
  supervisor: ["activeDecisions", "blockers", "risks", "doctrine", "facts"],
  strategy: ["objectives", "beliefs", "doctrine", "externalContext"],
  execution: ["activeDecisions", "blockers", "teams", "risks"],
  incident: ["risks", "blockers", "activeDecisions"],
  temporal: ["activeDecisions", "facts"],
  memory: ["facts", "beliefs", "doctrine"],
};

export function formatOrganizationStateForPrompt(
  state: OrganizationState,
  intent: PromptIntent = "supervisor",
): string {
  const keys = INTENT_SECTIONS[intent] ?? INTENT_SECTIONS.supervisor;
  const lines: string[] = ["### Organization State (compiled projection)"];
  for (const key of keys) {
    if (key === "teams") {
      if (state.teams.length) {
        lines.push(`**Teams:** ${JSON.stringify(state.teams.slice(0, 5))}`);
      }
      continue;
    }
    const section = state[key] as StateSection;
    if (!section?.items?.length) continue;
    lines.push(
      `**${String(key)}** (confidence ${Math.round(section.confidence * 100)}%): ${section.items
        .slice(0, 8)
        .map((i) => i.label || i.statement || i.content || i.id)
        .join("; ")}`,
    );
  }
  lines.push(`_State version ${state.meta.version}, compiled ${state.meta.compiled_at}_`);
  return `\n${lines.join("\n")}\n`;
}
