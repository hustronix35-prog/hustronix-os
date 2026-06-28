import { db } from "../database.js";
import { resolveTenantContext } from "../security/tenant-context.js";
import { findDriftSignals, findOverloadedOwners } from "../intelligence/operationalQuery.js";
import { getOrganizationState } from "../state/organization-state.js";
import { diffStateVersions, getCurrentStateVersion } from "../state/versioning.js";
import { getEntityNeighbors } from "../entities/store.js";
import { listDoctrineRules } from "../state/doctrine.js";
import { getGraphImpact } from "../security/evidence-graph.js";

export type ReasoningPath = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export interface L0Answer {
  path: ReasoningPath;
  answerable: true;
  response: string;
  data?: unknown;
}

export interface L0Defer {
  path?: ReasoningPath;
  answerable: false;
  reason: string;
}

export type CostOptimizerResult = L0Answer | L0Defer;

const ACTIVE_RE = /\b(active decision|what(?:'s| is) active|current active)\b/i;
const BLOCKED_RE = /\b(blocked task|what(?:'s| is) blocked|blocked execution)\b/i;
const CAPACITY_RE = /\b(capacity|overload|overloaded|team load)\b/i;
const DOCTRINE_RE = /\b(doctrine|never compete|constitutional|guidance rule)\b/i;
const TEMPORAL_RE = /\b(what changed|last (month|quarter|week)|diff|version)\b/i;
const ENTITY_RE = /\b(neighbor|depends on|impact|upstream|downstream)\b/i;

export function tryAnswerWithoutLlm(userId: string, query: string): CostOptimizerResult {
  const q = query.trim();
  if (!q) return { answerable: false, reason: "empty_query" };

  const tenant = resolveTenantContext(userId);
  const orgId = tenant.orgId;

  if (ACTIVE_RE.test(q)) {
    const state = getOrganizationState(orgId, userId);
    const items = state.activeDecisions.items;
    if (!items.length) {
      return { path: "L0", answerable: true, response: "No ACTIVE decisions in the ledger for this organization." };
    }
    return {
      path: "L0",
      answerable: true,
      response: `ACTIVE decisions (${items.length}): ${items.map((d) => d.label).join("; ")}`,
      data: items,
    };
  }

  if (BLOCKED_RE.test(q)) {
    const blocked = db.rawGet(
      `SELECT task_id, success_condition, blocked_reasons FROM execution_ledger
       WHERE status = 'BLOCKED' AND decision_id IN (
         SELECT id FROM decision_ledger WHERE org_id = ? OR user_id IN (?, ?)
       )
       ORDER BY last_update DESC LIMIT 20`,
      [orgId, orgId, tenant.userId],
    ) as { task_id: string; success_condition: string; blocked_reasons: string | null }[];
    if (!blocked.length) {
      return { path: "L0", answerable: true, response: "No blocked tasks in the execution ledger." };
    }
    return {
      path: "L0",
      answerable: true,
      response: `Blocked tasks: ${blocked.map((b) => b.success_condition || b.task_id).join("; ")}`,
      data: blocked,
    };
  }

  if (CAPACITY_RE.test(q)) {
    const owners = findOverloadedOwners(userId, { minTotal: 4, limit: 10 });
    if (!owners.length) {
      const cap = db.getOwnerCapacity("system");
      return {
        path: "L0",
        answerable: true,
        response: `Capacity within limits. Default owner capacity: ${cap?.capacity ?? "unknown"}.`,
      };
    }
    return {
      path: "L0",
      answerable: true,
      response: `Overloaded owners: ${owners.map((o) => `${o.owner} (${o.total} tasks, ${o.high_risk_signals} high-risk signals)`).join(", ")}`,
      data: owners,
    };
  }

  if (DOCTRINE_RE.test(q)) {
    const rules = listDoctrineRules(tenant, "ACTIVE");
    if (!rules.length) {
      return { path: "L0", answerable: true, response: "No ACTIVE doctrine rules recorded for this organization." };
    }
    return {
      path: "L0",
      answerable: true,
      response: `Doctrine (${rules.length}): ${rules.map((r) => `[${r.priority}] ${r.statement}`).join(" | ")}`,
      data: rules,
    };
  }

  if (TEMPORAL_RE.test(q)) {
    const current = getCurrentStateVersion(orgId);
    const prev = db
      .rawGet(
        `SELECT version FROM organization_state_versions WHERE tenant_id = ? AND version < ? ORDER BY version DESC LIMIT 1`,
        [orgId, current?.version ?? 999999],
      )
      .at(0) as { version: number } | undefined;
    if (current && prev) {
      const diff = diffStateVersions(orgId, prev.version, current.version);
      if (diff) {
        const sections = Object.keys((diff as { sections?: Record<string, unknown> }).sections ?? {});
        return {
          path: "L0",
          answerable: true,
          response: `State changed between v${prev.version} and v${current.version}. Sections: ${sections.join(", ") || "none"}.`,
          data: diff,
        };
      }
    }
    return { answerable: false, reason: "insufficient_version_history" };
  }

  const entityMatch = q.match(/\bentity[:\s]+([a-f0-9-]{36})\b/i);
  if (ENTITY_RE.test(q) && entityMatch) {
    const neighbors = getEntityNeighbors(orgId, entityMatch[1]);
    const impact = getGraphImpact({ tenantId: orgId, entityId: entityMatch[1], depth: 2 });
    return {
      path: "L0",
      answerable: true,
      response: `Entity graph: ${neighbors.length} neighbors; impact nodes ${impact.nodes.length}, edges ${impact.edges.length}.`,
      data: { neighbors, impact },
    };
  }

  if (/\bdrift\b/i.test(q)) {
    const drift = findDriftSignals(userId, { limit: 5 });
    if (drift.length) {
      return {
        path: "L0",
        answerable: true,
        response: `Drift signals (${drift.length}): ${drift.map((d) => d.content.slice(0, 80)).join(" | ")}`,
        data: drift,
      };
    }
  }

  return { answerable: false, reason: "needs_llm" };
}
