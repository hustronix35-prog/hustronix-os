import { db } from "../database.js";
import type { OrganizationState } from "./organization-state.js";

export interface StateVersionRow {
  version: number;
  tenant_id: string;
  snapshot_json: string;
  parent_version: number | null;
  diff_from_parent_json: string | null;
  compiled_at: string;
  trigger_event: string | null;
  author: string | null;
}

export function getCurrentStateVersion(tenantId: string): StateVersionRow | null {
  const row = db
    .rawGet(
      `SELECT * FROM organization_state_versions
       WHERE tenant_id = ? ORDER BY version DESC LIMIT 1`,
      [tenantId],
    )
    .at(0) as StateVersionRow | undefined;
  return row ?? null;
}

export function getStateVersion(tenantId: string, version: number): StateVersionRow | null {
  const row = db
    .rawGet(
      `SELECT * FROM organization_state_versions WHERE tenant_id = ? AND version = ?`,
      [tenantId, version],
    )
    .at(0) as StateVersionRow | undefined;
  return row ?? null;
}

export function listStateVersions(tenantId: string, limit = 50): StateVersionRow[] {
  return db.rawGet(
    `SELECT * FROM organization_state_versions
     WHERE tenant_id = ? ORDER BY version DESC LIMIT ?`,
    [tenantId, Math.min(limit, 200)],
  ) as StateVersionRow[];
}

function shallowSectionDiff(
  prev: OrganizationState,
  next: OrganizationState,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  const keys: (keyof OrganizationState)[] = [
    "objectives",
    "priorities",
    "activeDecisions",
    "blockers",
    "commitments",
    "risks",
    "facts",
    "beliefs",
    "doctrine",
    "externalContext",
    "teams",
    "meta",
  ];
  for (const key of keys) {
    const a = JSON.stringify(prev[key]);
    const b = JSON.stringify(next[key]);
    if (a !== b) diff[key as string] = { before: prev[key], after: next[key] };
  }
  return diff;
}

export function saveStateVersion(params: {
  tenantId: string;
  snapshot: OrganizationState;
  parentVersion?: number | null;
  triggerEvent?: string;
  author?: string;
}): StateVersionRow {
  const current = getCurrentStateVersion(params.tenantId);
  const nextVersion = (current?.version ?? 0) + 1;
  const parentVersion = params.parentVersion ?? current?.version ?? null;

  let diffJson: string | null = null;
  if (current) {
    try {
      const prev = JSON.parse(current.snapshot_json) as OrganizationState;
      diffJson = JSON.stringify(shallowSectionDiff(prev, params.snapshot));
    } catch {
      diffJson = null;
    }
  }

  db.rawRun(
    `INSERT INTO organization_state_versions (
      version, tenant_id, snapshot_json, parent_version, diff_from_parent_json,
      compiled_at, trigger_event, author
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
    [
      nextVersion,
      params.tenantId,
      JSON.stringify(params.snapshot),
      parentVersion,
      diffJson,
      params.triggerEvent ?? null,
      params.author ?? null,
    ],
  );

  const row = getStateVersion(params.tenantId, nextVersion);
  if (!row) throw new Error("Failed to persist state version.");
  return row;
}

export function diffStateVersions(
  tenantId: string,
  v1: number,
  v2: number,
): Record<string, unknown> | null {
  const a = getStateVersion(tenantId, v1);
  const b = getStateVersion(tenantId, v2);
  if (!a || !b) return null;
  try {
    const snapA = JSON.parse(a.snapshot_json) as OrganizationState;
    const snapB = JSON.parse(b.snapshot_json) as OrganizationState;
    return {
      v1,
      v2,
      sections: shallowSectionDiff(snapA, snapB),
    };
  } catch {
    return null;
  }
}

export function rollbackStateVersion(
  tenantId: string,
  toVersion: number,
  author: string,
): StateVersionRow | null {
  const target = getStateVersion(tenantId, toVersion);
  if (!target) return null;
  try {
    const snapshot = JSON.parse(target.snapshot_json) as OrganizationState;
    snapshot.meta.version = toVersion;
    return saveStateVersion({
      tenantId,
      snapshot,
      parentVersion: getCurrentStateVersion(tenantId)?.version ?? null,
      triggerEvent: `STATE_ROLLBACK:${toVersion}`,
      author,
    });
  } catch {
    return null;
  }
}

export function parseSnapshot(row: StateVersionRow): OrganizationState | null {
  try {
    return JSON.parse(row.snapshot_json) as OrganizationState;
  } catch {
    return null;
  }
}
