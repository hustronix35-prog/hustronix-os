import { db } from "../database.js";
import {
  diffStateVersions,
  getCurrentStateVersion,
  getStateVersion,
  listStateVersions,
  parseSnapshot,
} from "./versioning.js";
import type { OrganizationState } from "./organization-state.js";
import { getEntityTimeline } from "../entities/store.js";

export function getStateAt(tenantId: string, timestamp: string): OrganizationState | null {
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target)) return null;

  const rows = listStateVersions(tenantId, 200);
  let best: (typeof rows)[0] | null = null;
  for (const row of rows) {
    const compiled = Date.parse(row.compiled_at);
    if (compiled <= target && (!best || compiled > Date.parse(best.compiled_at))) {
      best = row;
    }
  }
  if (!best) {
    const current = getCurrentStateVersion(tenantId);
    if (current && Date.parse(current.compiled_at) <= target) {
      return parseSnapshot(current);
    }
    return null;
  }
  return parseSnapshot(best);
}

export function diffStates(
  tenantId: string,
  v1: number,
  v2: number,
): Record<string, unknown> | null {
  return diffStateVersions(tenantId, v1, v2);
}

export function getEntityTimelineForTenant(tenantId: string, entityId: string) {
  return getEntityTimeline(tenantId, entityId);
}

export function getTemporalSlice(
  tenantId: string,
  query: string,
): { mode: "past" | "current" | "future"; state: OrganizationState | null; diff?: Record<string, unknown> } {
  const q = query.toLowerCase();
  const temporalHints = /last (month|quarter|week|year)|since |what changed|what was true|historical|previously/;
  if (temporalHints.test(q)) {
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const past = getStateAt(tenantId, monthAgo);
    const currentRow = getCurrentStateVersion(tenantId);
    const current = currentRow ? parseSnapshot(currentRow) : null;
    let diff: Record<string, unknown> | undefined;
    if (past && currentRow && past.meta.version !== currentRow.version) {
      diff = diffStateVersions(tenantId, past.meta.version, currentRow.version) ?? undefined;
    }
    return { mode: "past", state: past, diff };
  }
  if (/what if|simulate|project|forecast/.test(q)) {
    return { mode: "future", state: null };
  }
  const currentRow = getCurrentStateVersion(tenantId);
  return { mode: "current", state: currentRow ? parseSnapshot(currentRow) : null };
}
