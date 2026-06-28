import type { TenantContext } from "./tenant-context.js";
import { resolveTenantContext } from "./tenant-context.js";

/** Canonical tenant key for V9 security boundaries (org, not user). */
export function canonicalTenantId(ctx: TenantContext): string {
  return ctx.orgId;
}

/** Resolve tenant context from a user id. */
export function tenantForUser(userId: string): TenantContext {
  return resolveTenantContext(userId);
}

/**
 * SQL fragment matching ledger rows owned by org or legacy user id.
 * Use for decision_ledger.user_id and external_signals.user_id back-compat.
 */
export function ledgerTenantParams(ctx: TenantContext): [string, string] {
  return [ctx.orgId, ctx.userId];
}

export function ledgerTenantInClause(): string {
  return "user_id IN (?, ?)";
}

/** Memory / evidence tables keyed by tenant_id. */
export function memoryTenantParams(ctx: TenantContext): [string, string] {
  return [ctx.orgId, ctx.userId];
}

export function memoryTenantInClause(): string {
  return "tenant_id IN (?, ?)";
}

export function assertLedgerTenantAccess(
  ctx: TenantContext,
  resourceUserId: string,
): void {
  if (ctx.userId === "system") return;
  if (resourceUserId !== ctx.orgId && resourceUserId !== ctx.userId) {
    throw new Error("Forbidden: resource belongs to another tenant.");
  }
}
