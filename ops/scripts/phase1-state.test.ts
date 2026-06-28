/**
 * Phase 1 — entity registry, dynamic confidence, organization state compiler.
 * Run: npm run test:phase1 (from apps/api)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { computeDynamicConfidence } from "../../apps/api/src/state/confidence.js";
import {
  createEntity,
  getEntity,
  linkEntityNeighbor,
  listEntities,
} from "../../apps/api/src/entities/index.js";
import {
  compileOrganizationState,
  patchOrganizationState,
  formatOrganizationStateForPrompt,
} from "../../apps/api/src/state/organization-state.js";
import { createDoctrineRule, listDoctrineRules } from "../../apps/api/src/state/doctrine.js";
import { getCurrentStateVersion } from "../../apps/api/src/state/versioning.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";

function ensureTestTenant(seed: string): { tenantId: string; userId: string; workspaceId: string } {
  const userId = `test_state_${seed}`;
  if (!db.getUser(userId)) {
    db.createUser(userId, userId, hashPassword(`test-${userId}`));
  }
  const ctx = resolveTenantContext(userId);
  return { tenantId: ctx.orgId, userId: ctx.userId, workspaceId: ctx.workspaceId };
}

describe("Phase 1 — dynamic confidence", () => {
  it("increases confidence with human verification and decays over time", () => {
    const fresh = computeDynamicConfidence({
      baseEvidenceWeight: 0.6,
      evidenceCount: 3,
      humanVerified: true,
      freshnessAt: new Date().toISOString(),
    });
    const stale = computeDynamicConfidence({
      baseEvidenceWeight: 0.6,
      evidenceCount: 3,
      humanVerified: true,
      observedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert.ok(fresh.confidence > stale.confidence);
    assert.ok(fresh.human_verification_boost === 0.15);
  });

  it("applies contradiction penalty", () => {
    const clean = computeDynamicConfidence({ evidenceCount: 2, contradictionCount: 0 });
    const noisy = computeDynamicConfidence({ evidenceCount: 2, contradictionCount: 3 });
    assert.ok(clean.confidence > noisy.confidence);
  });
});

describe("Phase 1 — entity registry", () => {
  const tenantId = `test_org_${uuidv4().slice(0, 8)}`;

  it("creates, lists, and links entities", () => {
    const a = createEntity({ tenantId, type: "decision", label: "Test decision", refId: uuidv4() });
    const b = createEntity({ tenantId, type: "task", label: "Test task", refId: uuidv4() });
    assert.equal(getEntity(tenantId, a.id)?.label, "Test decision");

    const ctx = { userId: tenantId, orgId: tenantId, workspaceId: "ws", role: "owner" as const };
    const listed = listEntities(ctx, { type: "decision" });
    assert.ok(listed.some((e) => e.id === a.id));

    const edgeId = linkEntityNeighbor({
      tenantId,
      fromEntityId: a.id,
      toEntityId: b.id,
      edgeType: "SUPPORTS",
    });
    assert.ok(edgeId);
  });
});

describe("Phase 1 — organization state", () => {
  const seed = uuidv4().slice(0, 8);
  const { tenantId, userId, workspaceId } = ensureTestTenant(seed);

  it("compiles state with doctrine and formats for prompt", () => {
    createDoctrineRule({
      tenantId,
      statement: "Enterprise first",
      priority: "constitutional",
    });
    const rules = listDoctrineRules({ userId, orgId: tenantId, workspaceId, role: "owner" });
    assert.equal(rules.length, 1);

    const state = compileOrganizationState(tenantId, userId);
    assert.ok(state.doctrine.items.length >= 1);
    const prompt = formatOrganizationStateForPrompt(state, "supervisor");
    assert.match(prompt, /Organization State/);
    assert.match(prompt, /Enterprise first/);
  });

  it("patches state incrementally on ledger events", async () => {
    const decisionId = uuidv4();
    db.rawRun(
      `INSERT INTO decision_ledger (id, user_id, org_id, vow, status, confidence, created_at, last_update)
       VALUES (?, ?, ?, ?, 'ACTIVE', 0.8, datetime('now'), datetime('now'))`,
      [decisionId, userId, tenantId, "Patch test vow"],
    );
    patchOrganizationState(tenantId, userId, `decision:${decisionId}`);
    await new Promise((r) => setTimeout(r, 600));
    const version = getCurrentStateVersion(tenantId);
    assert.ok(version);
    assert.ok(version!.version >= 1);
  });
});
