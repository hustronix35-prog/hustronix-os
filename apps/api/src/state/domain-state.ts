import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import {
  emptyOrganizationState,
  type OrganizationState,
  type StateSection,
} from "./organization-state.js";

export type DomainName = "engineering" | "sales" | "marketing" | "coordinator";

export interface DomainStatePatch {
  domain: DomainName;
  sections: Partial<{
    blockers: StateSection<{ label: string; task_id?: string }>;
    risks: StateSection<{ label: string; severity?: string }>;
    commitments: StateSection<{ label: string; entity_id?: string }>;
    priorities: StateSection<{ label: string; weight?: number }>;
    externalContext: StateSection<{ label: string; type?: string }>;
    teams: OrganizationState["teams"];
  }>;
  version?: number;
}

export interface DomainPatchRow {
  id: string;
  tenant_id: string;
  domain: DomainName;
  section_json: string;
  version: number;
  author: string | null;
  updated_at: string;
}

const DOMAIN_PRECEDENCE: DomainName[] = ["engineering", "sales", "marketing"];

function mergeSection<T>(
  base: StateSection<T>,
  patch: StateSection<T> | undefined,
  opts: { doctrineWins?: boolean; activeDecisionIds?: Set<string> },
): StateSection<T> {
  if (!patch?.items?.length) return base;
  const merged = [...base.items];
  for (const item of patch.items) {
    const key = JSON.stringify(item);
    if (!merged.some((m) => JSON.stringify(m) === key)) merged.push(item);
  }
  const confidence = Math.max(base.confidence, patch.confidence ?? base.confidence);
  const freshness_at =
    (patch.freshness_at && patch.freshness_at > base.freshness_at)
      ? patch.freshness_at
      : base.freshness_at;
  void opts;
  return { items: merged, confidence, freshness_at };
}

/**
 * Merge domain patches into OrganizationState.
 * Conflict rules: doctrine wins (caller injects); ACTIVE decision wins over domain blockers.
 */
export function mergeDomainStates(
  base: OrganizationState,
  patches: DomainStatePatch[],
  options?: { activeDecisionIds?: string[]; doctrineStatements?: string[] },
): OrganizationState {
  const activeIds = new Set(options?.activeDecisionIds ?? []);
  const doctrine = new Set((options?.doctrineStatements ?? []).map((s) => s.toLowerCase()));

  const result = { ...base, meta: { ...base.meta } };
  const ordered = [...patches].sort(
    (a, b) => DOMAIN_PRECEDENCE.indexOf(a.domain) - DOMAIN_PRECEDENCE.indexOf(b.domain),
  );

  for (const patch of ordered) {
    if (patch.sections.blockers) {
      const filtered = patch.sections.blockers.items.filter((b) => {
        if (!b.task_id) return true;
        return !activeIds.has(b.task_id);
      });
      result.blockers = mergeSection(result.blockers, {
        ...patch.sections.blockers,
        items: filtered.filter((b) => !doctrine.has(b.label.toLowerCase())),
      }, {});
    }
    if (patch.sections.risks) {
      result.risks = mergeSection(result.risks, patch.sections.risks, {});
    }
    if (patch.sections.commitments) {
      result.commitments = mergeSection(result.commitments, patch.sections.commitments, {});
    }
    if (patch.sections.priorities) {
      result.priorities = mergeSection(result.priorities, patch.sections.priorities, {});
    }
    if (patch.sections.externalContext) {
      result.externalContext = mergeSection(result.externalContext, patch.sections.externalContext, {});
    }
    if (patch.sections.teams?.length) {
      const byId = new Map(result.teams.map((t) => [t.team_id, t]));
      for (const t of patch.sections.teams) byId.set(t.team_id, { ...byId.get(t.team_id), ...t });
      result.teams = [...byId.values()];
    }
    result.meta.version = Math.max(result.meta.version, patch.version ?? result.meta.version);
  }

  result.meta.compiled_at = new Date().toISOString();
  return result;
}

export function upsertDomainStatePatch(params: {
  tenantId: string;
  domain: DomainName;
  sections: DomainStatePatch["sections"];
  author?: string;
}): DomainPatchRow {
  const existing = db
    .rawGet(`SELECT * FROM domain_state_patches WHERE tenant_id = ? AND domain = ?`, [
      params.tenantId,
      params.domain,
    ])
    .at(0) as DomainPatchRow | undefined;

  const version = (existing?.version ?? 0) + 1;
  const sectionJson = JSON.stringify({ sections: params.sections, version });

  if (existing) {
    db.rawRun(
      `UPDATE domain_state_patches SET section_json = ?, version = ?, author = ?, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND domain = ?`,
      [sectionJson, version, params.author ?? null, params.tenantId, params.domain],
    );
    return {
      ...existing,
      section_json: sectionJson,
      version,
      author: params.author ?? existing.author,
      updated_at: new Date().toISOString(),
    };
  }

  const id = uuidv4();
  db.rawRun(
    `INSERT INTO domain_state_patches (id, tenant_id, domain, section_json, version, author)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, params.tenantId, params.domain, sectionJson, version, params.author ?? null],
  );
  return {
    id,
    tenant_id: params.tenantId,
    domain: params.domain,
    section_json: sectionJson,
    version,
    author: params.author ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function listDomainPatches(tenantId: string): DomainStatePatch[] {
  const rows = db.rawGet(
    `SELECT domain, section_json, version FROM domain_state_patches WHERE tenant_id = ?`,
    [tenantId],
  ) as { domain: DomainName; section_json: string; version: number }[];

  return rows.map((r) => {
    const parsed = JSON.parse(r.section_json) as { sections: DomainStatePatch["sections"] };
    return { domain: r.domain, sections: parsed.sections ?? {}, version: r.version };
  });
}

export function compileMergedOrganizationState(tenantId: string): OrganizationState {
  const base = emptyOrganizationState();
  const patches = listDomainPatches(tenantId);

  const active = db.rawGet(
    `SELECT id FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
    [tenantId],
  ) as { id: string }[];

  const doctrine = db.rawGet(
    `SELECT statement FROM doctrine_rules WHERE tenant_id = ? AND status = 'ACTIVE'`,
    [tenantId],
  ) as { statement: string }[];

  return mergeDomainStates(base, patches, {
    activeDecisionIds: active.map((d) => d.id),
    doctrineStatements: doctrine.map((d) => d.statement),
  });
}
