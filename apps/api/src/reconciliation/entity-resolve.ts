/**
 * P1 entity resolution: stable ref ids + aliases onto one feature/launch entity.
 * Not full MDM — just enough so Slack + Jira + GitHub + meeting share a canonical id.
 */
import crypto from "crypto";
import { db } from "../database.js";
import {
  featureRefId,
  guessFeatureHint,
  parseClaimReady,
  type ClaimReadyMeta,
} from "../integrations/claimReady.js";

export function resolveAlias(tenantId: string, id: string): string {
  const row = db
    .rawGet(
      `SELECT entity_ref_id FROM entity_aliases WHERE tenant_id = ? AND alias_id = ? LIMIT 1`,
      [tenantId, id],
    )
    .at(0) as { entity_ref_id: string } | undefined;
  return row?.entity_ref_id || id;
}

export function registerAlias(tenantId: string, aliasId: string, canonicalRefId: string): void {
  if (!aliasId || !canonicalRefId || aliasId === canonicalRefId) return;
  db.rawRun(
    `INSERT INTO entity_aliases (tenant_id, alias_id, entity_ref_id)
     VALUES (?, ?, ?)
     ON CONFLICT(tenant_id, alias_id) DO UPDATE SET entity_ref_id = excluded.entity_ref_id`,
    [tenantId, aliasId, canonicalRefId],
  );
}

function ensureFeatureRow(tenantId: string, refId: string, label: string): void {
  const existing = db
    .rawGet(
      `SELECT ref_id FROM entities WHERE tenant_id = ? AND ref_id = ? LIMIT 1`,
      [tenantId, refId],
    )
    .at(0);
  if (existing) {
    db.rawRun(`UPDATE entities SET freshness_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND ref_id = ?`, [
      tenantId,
      refId,
    ]);
    return;
  }
  try {
    db.rawRun(
      `INSERT OR IGNORE INTO entities (id, tenant_id, type, label, ref_id, confidence, freshness_at)
       VALUES (?, ?, 'feature', ?, ?, 0.55, CURRENT_TIMESTAMP)`,
      [crypto.randomUUID(), tenantId, label.slice(0, 200), refId],
    );
  } catch {
    /* usable without row */
  }
}

function lookupExisting(tenantId: string, userId: string, token: string): { entityId: string; entityLabel: string } | null {
  const viaAlias = resolveAlias(tenantId, token);
  const ent = db
    .rawGet(
      `SELECT ref_id, label FROM entities
       WHERE tenant_id IN (?, ?) AND ref_id IS NOT NULL
         AND (ref_id = ? OR ref_id = ? OR lower(label) = ?)
       LIMIT 1`,
      [tenantId, userId, token, viaAlias, token.toLowerCase()],
    )
    .at(0) as { ref_id: string; label: string } | undefined;
  if (!ent?.ref_id) {
    if (viaAlias !== token) return { entityId: viaAlias, entityLabel: viaAlias };
    return null;
  }
  return { entityId: resolveAlias(tenantId, ent.ref_id), entityLabel: ent.label || ent.ref_id };
}

export function resolveEntityForSignal(params: {
  tenantId: string;
  userId: string;
  content: string;
  affectedSystems: string[];
  ingestMeta?: string | Record<string, unknown> | null;
  preferredLabel?: string;
}): { entityId: string; entityLabel: string } {
  const { tenantId, userId, content, affectedSystems } = params;
  const ready: ClaimReadyMeta = parseClaimReady(params.ingestMeta);

  const hint =
    ready.feature_hint ||
    params.preferredLabel ||
    guessFeatureHint(content, ready.entity_id, ...(affectedSystems || []));

  const canonicalLabel = hint || ready.entity_id || affectedSystems[0] || "general";
  const canonicalId = hint ? featureRefId(hint) : ready.entity_id || `feature:${canonicalLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64) || "general"}`;

  ensureFeatureRow(tenantId, canonicalId, hint || canonicalLabel);

  if (ready.entity_id) registerAlias(tenantId, ready.entity_id, canonicalId);
  for (const a of ready.aliases || []) registerAlias(tenantId, a, canonicalId);

  const jira = content.match(/\b([A-Z]{2,10}-\d+)\b/);
  if (jira) registerAlias(tenantId, `jira:${jira[1]}`, canonicalId);
  const pr = content.match(/\b(?:PR|pull\s*request)[#:\s-]*(\d+)\b/i);
  if (pr && ready.entity_id?.startsWith("github:")) {
    registerAlias(tenantId, ready.entity_id, canonicalId);
  } else if (pr) {
    registerAlias(tenantId, `github:#${pr[1]}`, canonicalId);
  }

  for (const sys of affectedSystems.slice(0, 8)) {
    const token = String(sys).trim();
    if (!token) continue;
    const hit = lookupExisting(tenantId, userId, token);
    if (hit) {
      registerAlias(tenantId, hit.entityId, canonicalId);
      registerAlias(tenantId, token, canonicalId);
    }
  }

  return { entityId: canonicalId, entityLabel: hint || canonicalLabel };
}
