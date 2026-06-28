import { db } from "../database.js";
import { resolveTenantContext } from "./tenant-context.js";

const DEFAULT_DAILY_BUDGET_UNITS = 5000;

function budgetKey(orgId: string, date: string): string {
  return `ai:budget:${orgId}:${date}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyBudgetLimit(): number {
  const raw = process.env.ORG_LLM_DAILY_BUDGET?.trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_DAILY_BUDGET_UNITS;
}

export function getOrgLlmSpend(orgId: string, date = todayUtc()): number {
  const row = db.getSetting(orgId, budgetKey(orgId, date));
  const n = Number(row);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function assertOrgLlmBudget(userId: string): { orgId: string; remaining: number } {
  if (!userId || userId === "system") {
    return { orgId: "system", remaining: Number.MAX_SAFE_INTEGER };
  }
  const orgId = resolveTenantContext(userId).orgId;
  const limit = dailyBudgetLimit();
  const spent = getOrgLlmSpend(orgId);
  if (spent >= limit) {
    throw new Error(
      `Organization daily LLM budget exhausted (${spent}/${limit} units). Retry tomorrow or raise ORG_LLM_DAILY_BUDGET.`,
    );
  }
  return { orgId, remaining: limit - spent };
}

/** Rough token proxy — 1 unit ≈ 100 chars of model I/O. */
export function estimateLlmUnits(messages: { content?: string }[], outputText = ""): number {
  let chars = outputText.length;
  for (const m of messages) {
    chars += String(m.content ?? "").length;
  }
  return Math.max(1, Math.ceil(chars / 100));
}

export function recordOrgLlmSpend(orgId: string, units: number, date = todayUtc()): void {
  if (!orgId || orgId === "system" || units <= 0) return;
  const key = budgetKey(orgId, date);
  const next = getOrgLlmSpend(orgId, date) + units;
  db.updateSetting(orgId, key, String(next));
}
