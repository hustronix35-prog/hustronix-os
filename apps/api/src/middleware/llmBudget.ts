/** Org daily LLM budget — key pattern ai:budget:{orgId}:{date} */

const dailySpend = new Map<string, number>();

function budgetKey(orgId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `ai:budget:${orgId}:${date}`;
}

function dailyLimit(): number {
  const raw = Number(process.env.ORG_LLM_DAILY_BUDGET ?? 500);
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
}

export function recordLlmTurn(orgId: string, units = 1): void {
  const key = budgetKey(orgId);
  dailySpend.set(key, (dailySpend.get(key) ?? 0) + units);
}

export function checkOrgLlmBudget(orgId: string): { allowed: boolean; used: number; limit: number } {
  const key = budgetKey(orgId);
  const used = dailySpend.get(key) ?? 0;
  const limit = dailyLimit();
  return { allowed: used < limit, used, limit };
}

export function resetLlmBudgetForTest(): void {
  dailySpend.clear();
}
