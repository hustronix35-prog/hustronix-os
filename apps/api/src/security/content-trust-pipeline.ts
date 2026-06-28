import {
  classifyPromptInjection,
  wrapUntrustedContent,
  type InjectionClassification,
  type InjectionScanResult,
} from "./prompt-injection.js";
import { recordSecurityEventV8 } from "./security-observability.js";

export type ContentTrustStage =
  | "input"
  | "classification"
  | "isolation"
  | "sanitization"
  | "reasoning"
  | "storage";

export interface ContentTrustResult {
  classification: InjectionClassification;
  score: number;
  matchedPatterns: string[];
  isolatedContent: string;
  allowLlmReasoning: boolean;
  allowMemoryWrite: boolean;
  allowToolExecution: boolean;
  stage: ContentTrustStage;
}

export interface ContentTrustInput {
  content: string;
  sourceLabel: string;
  tenantId: string;
  actorId?: string;
  workspaceId?: string;
}

/**
 * ContentTrustPipeline — all external content passes through before LLM/memory/tools.
 */
export function runContentTrustPipeline(input: ContentTrustInput): ContentTrustResult {
  const scan = classifyPromptInjection(input.content);
  const isolated = wrapUntrustedContent(input.content, input.sourceLabel);

  if (scan.classification !== "SAFE") {
    recordSecurityEventV8({
      actorId: input.actorId ?? null,
      action: `content.injection.${scan.classification.toLowerCase()}`,
      resourceType: "content",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId ?? null,
      result: scan.classification === "MALICIOUS" ? "BLOCKED" : "DENIED",
      riskLevel: scan.classification === "MALICIOUS" ? "CRITICAL" : scan.classification === "SUSPICIOUS" ? "HIGH" : "MEDIUM",
      metadata: { patterns: scan.matchedPatterns, score: scan.score, source: input.sourceLabel },
    });
  }

  return {
    classification: scan.classification,
    score: scan.score,
    matchedPatterns: scan.matchedPatterns,
    isolatedContent: isolated,
    allowLlmReasoning: scan.classification === "SAFE",
    allowMemoryWrite: scan.classification === "SAFE",
    allowToolExecution: scan.classification === "SAFE",
    stage: scan.classification === "SAFE" ? "reasoning" : "classification",
  };
}

export { classifyPromptInjection, wrapUntrustedContent, type InjectionScanResult };
