/**
 * LLM Output Firewall — all model-generated claims are untrusted until validated.
 */
import { classifyPromptInjection } from "./prompt-injection.js";

export interface LlmFirewallResult {
  allowed: boolean;
  blockedReasons: string[];
  requiresHumanReview: boolean;
  sanitizedText: string;
}

const AUTHORITY_FABRICATION =
  /\b(ceo|cto|cfo|founder|board|executive)\s+(approved|authorized|signed\s+off|mandated)\b/i;
const FINANCIAL_HALLUCINATION =
  /\b(\$[\d,.]+\s*(million|billion|m|b)|raised\s+\$|acquired\s+for\s+\$|valuation\s+of\s+\$)/i;
const OWNERSHIP_FABRICATION =
  /\b(project|initiative|bet)\s+owner\s+is\s+[A-Z][a-z]+/i;
const DEADLINE_FABRICATION =
  /\b(launch|ship|release|deadline)\s+(is|on)\s+(monday|tuesday|wednesday|thursday|friday|tomorrow|next\s+week)/i;
const DECISION_FABRICATION =
  /\b(we\s+decided|decision\s+was\s+made|officially\s+committed)\s+to\b/i;

export function validateLlmOutput(text: string): LlmFirewallResult {
  const blockedReasons: string[] = [];
  const injection = classifyPromptInjection(text);

  if (injection.classification === "MALICIOUS") {
    blockedReasons.push("prompt_injection_pattern");
  }
  if (AUTHORITY_FABRICATION.test(text)) {
    blockedReasons.push("authority_fabrication");
  }
  if (FINANCIAL_HALLUCINATION.test(text)) {
    blockedReasons.push("unverifiable_financial_claim");
  }
  if (OWNERSHIP_FABRICATION.test(text)) {
    blockedReasons.push("hallucinated_ownership");
  }
  if (DEADLINE_FABRICATION.test(text)) {
    blockedReasons.push("hallucinated_deadline");
  }
  if (DECISION_FABRICATION.test(text)) {
    blockedReasons.push("hallucinated_decision");
  }

  const requiresHumanReview = blockedReasons.length > 0;
  const allowed = blockedReasons.length === 0;

  return {
    allowed,
    blockedReasons,
    requiresHumanReview,
    sanitizedText: text,
  };
}

/** Scan user chat input before it reaches the LLM. */
export function validateLlmInput(text: string): LlmFirewallResult {
  const injection = classifyPromptInjection(text);
  const blockedReasons: string[] = [];
  if (injection.classification === "MALICIOUS") {
    blockedReasons.push("malicious_user_input");
  }
  if (injection.classification === "SUSPICIOUS") {
    blockedReasons.push("suspicious_user_input");
  }
  return {
    allowed: injection.classification === "SAFE",
    blockedReasons,
    requiresHumanReview: injection.classification !== "SAFE",
    sanitizedText: text,
  };
}
