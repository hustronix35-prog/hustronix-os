import { tryAnswerWithoutLlm, type ReasoningPath, type CostOptimizerResult } from "./cost-optimizer.js";
import { buildContextForQuery } from "../state/context-builder.js";
import { classifyPromptInjection, shouldBlockLlmProcessing } from "../security/prompt-injection.js";
import { findDriftSignals } from "../intelligence/operationalQuery.js";
import { listDoctrineRules } from "../state/doctrine.js";
import { resolveTenantContext } from "../security/tenant-context.js";

export interface RouterDecision {
  level: ReasoningPath;
  useLlm: boolean;
  useSubAgents: boolean;
  requiresDualControl: boolean;
  l0Result?: CostOptimizerResult;
  contextBlock?: string;
  reason: string;
}

const HIGH_RISK_RE = /\b(commit|activate|kill all|delete all|override|emergency)\b/i;

export function routeUserQuery(userId: string, query: string): RouterDecision {
  const injection = classifyPromptInjection(query);
  if (shouldBlockLlmProcessing(injection)) {
    return {
      level: "L5",
      useLlm: false,
      useSubAgents: false,
      requiresDualControl: true,
      reason: "prompt_injection_blocked",
    };
  }

  const l0 = tryAnswerWithoutLlm(userId, query);
  if (l0.answerable) {
    return {
      level: "L0",
      useLlm: false,
      useSubAgents: false,
      requiresDualControl: false,
      l0Result: l0,
      reason: "sqlite_or_graph_answer",
    };
  }

  const tenant = resolveTenantContext(userId);
  const doctrine = listDoctrineRules(tenant, "ACTIVE");
  const constitutional = doctrine.filter((d) => d.priority === "constitutional");
  if (constitutional.length && /\b(violate|ignore doctrine|override rule)\b/i.test(query)) {
    return {
      level: "L1",
      useLlm: false,
      useSubAgents: false,
      requiresDualControl: true,
      reason: "constitutional_doctrine_violation_request",
    };
  }

  if (/\b(drift|overload|conflict|blocked)\b/i.test(query)) {
    const drift = findDriftSignals(userId, { limit: 3 });
    if (drift.length) {
      return {
        level: "L2",
        useLlm: true,
        useSubAgents: false,
        requiresDualControl: false,
        contextBlock: buildContextForQuery(userId, query).promptBlock,
        reason: "operational_heuristics",
      };
    }
  }

  if (HIGH_RISK_RE.test(query)) {
    return {
      level: "L5",
      useLlm: true,
      useSubAgents: false,
      requiresDualControl: true,
      contextBlock: buildContextForQuery(userId, query).promptBlock,
      reason: "high_risk_mutation_language",
    };
  }

  const ctx = buildContextForQuery(userId, query);
  const complex = query.length > 280 || /\b(analyze|simulate|hypothesis|institutional|strategic plan)\b/i.test(query);

  if (complex) {
    return {
      level: "L4",
      useLlm: true,
      useSubAgents: true,
      requiresDualControl: false,
      contextBlock: ctx.promptBlock,
      reason: "coordinator_premium",
    };
  }

  return {
    level: "L3",
    useLlm: true,
    useSubAgents: false,
    requiresDualControl: false,
    contextBlock: ctx.promptBlock,
    reason: "fast_llm_default",
  };
}

export function logReasoningPath(userId: string, level: ReasoningPath, queryPreview: string): void {
  console.log(`[router] user=${userId.slice(0, 8)} path=${level} q="${queryPreview.slice(0, 60)}"`);
}
