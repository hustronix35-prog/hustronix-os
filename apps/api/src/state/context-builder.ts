import type { OrganizationState, PromptIntent } from "./organization-state.js";
import { formatOrganizationStateForPrompt, getOrganizationState } from "./organization-state.js";
import { getEntityNeighbors } from "../entities/store.js";
import { getTemporalSlice } from "./temporal.js";
import { resolveTenantContext } from "../security/tenant-context.js";

export type ContextIntent = PromptIntent;

const INTENT_PATTERNS: { intent: ContextIntent; re: RegExp }[] = [
  { intent: "temporal", re: /last (month|quarter|week|year)|since |what changed|what was true/i },
  { intent: "strategy", re: /strategy|positioning|competitor|market|doctrine|north star/i },
  { intent: "execution", re: /task|blocked|capacity|execute|ship|delivery|sprint/i },
  { intent: "incident", re: /incident|outage|urgent|critical|sev[0-9]|production down/i },
  { intent: "memory", re: /remember|fact|belief|recall|what do we know/i },
];

export function classifyContextIntent(query: string): ContextIntent {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(query)) return intent;
  }
  return "supervisor";
}

export interface BuiltContext {
  intent: ContextIntent;
  state: OrganizationState;
  promptBlock: string;
  graphNeighbors: unknown[];
  temporal?: ReturnType<typeof getTemporalSlice>;
}

export function buildContextForQuery(userId: string, query: string): BuiltContext {
  const tenant = resolveTenantContext(userId);
  const intent = classifyContextIntent(query);
  const state = getOrganizationState(tenant.orgId, userId);
  const promptBlock = formatOrganizationStateForPrompt(state, intent);

  const graphNeighbors: unknown[] = [];
  const focusEntity = state.activeDecisions.items[0]?.entity_id ?? state.activeDecisions.items[0]?.id;
  if (focusEntity && ["execution", "incident", "strategy"].includes(intent)) {
    graphNeighbors.push(...getEntityNeighbors(tenant.orgId, focusEntity).slice(0, 12));
  }

  const temporal = intent === "temporal" ? getTemporalSlice(tenant.orgId, query) : undefined;

  return { intent, state, promptBlock, graphNeighbors, temporal };
}
