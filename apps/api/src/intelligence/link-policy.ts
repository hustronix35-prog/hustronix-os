import type { DetectedSignal } from "./signalDetector.js";
import type { LinkSuggestion } from "./autoLinker.js";

export type LinkImpactTier = "auto" | "suggest" | "manual";

export interface LinkPolicyResult {
  tier: LinkImpactTier;
  score: number;
  method: string;
  provenance: Record<string, unknown>;
  shouldAutoApply: boolean;
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const PR_RE = /\b(?:PR|pull\s*request)[#:\s-]*(\d+)\b/i;
const ISSUE_RE = /\b(?:[A-Z]{2,10}-\d+|#\d+)\b/;

function deterministicMatch(content: string, taskId: string): { hit: boolean; reason: string } {
  const normalized = content.toLowerCase();
  const tid = taskId.toLowerCase();
  if (normalized.includes(tid)) {
    return { hit: true, reason: "task_uuid_in_content" };
  }
  const uuids = content.match(new RegExp(UUID_RE.source, "gi")) ?? [];
  if (uuids.some((u) => u.toLowerCase() === tid)) {
    return { hit: true, reason: "task_uuid_token" };
  }
  const pr = content.match(PR_RE);
  if (pr && normalized.includes(String(pr[1]))) {
    return { hit: true, reason: "pr_number_ref" };
  }
  const issue = content.match(ISSUE_RE);
  if (issue && normalized.includes(issue[0].toLowerCase())) {
    return { hit: true, reason: "issue_key_ref" };
  }
  return { hit: false, reason: "none" };
}

function riskWeight(detected: DetectedSignal): number {
  if (detected.risk === "high") return 0.15;
  if (detected.risk === "medium") return 0.35;
  return 0.55;
}

function signalTypeWeight(detected: DetectedSignal): number {
  if (detected.signal_type === "execution") return 0.25;
  if (detected.signal_type === "observation") return 0.1;
  return -0.2;
}

/**
 * Adaptive link policy — deterministic matchers for low-impact auto links;
 * fused score + risk for suggest/manual tiers.
 */
export class LinkPolicyEngine {
  evaluate(params: {
    content: string;
    detected: DetectedSignal;
    candidate: LinkSuggestion | null;
  }): LinkPolicyResult {
    const { content, detected, candidate } = params;
    if (!candidate) {
      return {
        tier: "manual",
        score: 0,
        method: "none",
        provenance: { reason: "no_candidate" },
        shouldAutoApply: false,
      };
    }

    const det = deterministicMatch(content, candidate.taskId);
    if (det.hit && detected.risk !== "high") {
      return {
        tier: "auto",
        score: 0.95,
        method: "deterministic",
        provenance: {
          matcher: det.reason,
          taskId: candidate.taskId,
          decisionId: candidate.decisionId,
          detected: { signal_type: detected.signal_type, risk: detected.risk },
        },
        shouldAutoApply: true,
      };
    }

    const fused = candidate.fusedScore;
    const score =
      fused +
      riskWeight(detected) +
      signalTypeWeight(detected) +
      (candidate.cosineScore != null ? candidate.cosineScore * 0.15 : 0);

    let tier: LinkImpactTier = "manual";
    if (score >= 0.72 && detected.risk === "low") tier = "auto";
    else if (score >= 0.48) tier = "suggest";

    return {
      tier,
      score,
      method: det.hit ? "deterministic+score" : "adaptive_score",
      provenance: {
        fusedScore: fused,
        compositeScore: score,
        matcher: det.reason,
        taskId: candidate.taskId,
        decisionId: candidate.decisionId,
        source: candidate.source,
        detected: { signal_type: detected.signal_type, risk: detected.risk },
      },
      shouldAutoApply: tier === "auto",
    };
  }
}

export function adaptiveLinkPolicyEnabled(): boolean {
  const v = (process.env.AUTO_LINK_POLICY || "adaptive").trim().toLowerCase();
  return v === "adaptive" || v === "1" || v === "true";
}

export const linkPolicyEngine = new LinkPolicyEngine();
