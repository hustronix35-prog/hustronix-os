/**
 * Compatibility wrapper — Talk understanding lives in talk/talk-intent.ts
 */
import { classifyTalkIntent, isAnaphora as isAnaphoraNew, isGovernedActionMode as gov } from "./talk/talk-intent.js";
import type { TalkMode as NewMode } from "./talk/talk-intent.js";

export type TalkMode =
  | "COMPANY_QUESTION"
  | "BRAINSTORM"
  | "SITUATION_ANALYSIS"
  | "DECISION"
  | "EXECUTION"
  | "OUTCOME"
  | "GENERAL_CONVERSATION"
  | "CLARIFICATION"
  | NewMode;

export function isGovernedActionMode(mode: TalkMode): boolean {
  return gov(mode as NewMode) || mode === "DECISION" || mode === "EXECUTION" || mode === "OUTCOME";
}

export function classifyTalkMode(
  question: string,
  opts?: { action?: string | null; hasConversation?: boolean },
): TalkMode {
  const intent = classifyTalkIntent(question, { action: opts?.action || null });
  if (intent.mode === "CASUAL") return "GENERAL_CONVERSATION";
  if (intent.mode === "FOLLOWUP") return "CLARIFICATION";
  if (intent.mode === "STRATEGY" || intent.mode === "COMPANY_QA" || intent.mode === "COMPARISON") return "COMPANY_QUESTION";
  if (intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION") return "SITUATION_ANALYSIS";
  if (intent.mode === "COUNTERFACTUAL") return "BRAINSTORM";
  return intent.mode;
}

export const isAnaphora = isAnaphoraNew;
