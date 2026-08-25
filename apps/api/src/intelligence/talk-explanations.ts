/**
 * Founder-native Talk presentation. Intelligence stays on the engine;
 * this module only formats claims for a human operator.
 */
import type { RankedHypothesis } from "../institutional-reasoning.js";
import { formatEvidenceLine, type EvidenceReference } from "./evidence-reference.js";

export function formatEvidenceTrail(title: string, evidence: EvidenceReference[]): string {
  if (!evidence.length) {
    return `${title} is on the ledger, but the evidence trail is still thin.`;
  }
  const lines = evidence.map((e) => `• ${formatEvidenceLine(e)}`);
  return [`This is the evidence trail for ${title}:`, "", ...lines].join("\n");
}

/**
 * Internally: hypothesis / confidence / evidence_for / evidence_against.
 * Externally: another possibility, why we think this, what would confirm, what would disprove.
 */
export function formatAlternativeHypotheses(hyps: RankedHypothesis[]): string {
  const alts = hyps.filter((h) => h.id !== "h_primary").slice(0, 2);
  const primary = hyps.find((h) => h.id === "h_primary") || hyps[0];
  if (!alts.length && !primary) return "No competing explanations are on the memo yet.";

  const blocks: string[] = [];
  for (const h of alts.length ? alts : hyps.slice(1, 2)) {
    const confirm = h.supporting_evidence?.[0]?.description;
    const disprove = h.counter_signals?.[0];
    blocks.push(`Another possibility: ${stripInternalJargon(h.statement)}`);
    blocks.push("");
    blocks.push(
      `Why we think this: ${
        confirm
          ? stripInternalJargon(confirm)
          : "Independent signals can disagree with the headline metric or stated risk."
      }`,
    );
    blocks.push("");
    blocks.push(
      `What would confirm it: ${
        confirm
          ? "verify the underlying telemetry and the original source of each signal."
          : "an independent source showing the same pattern."
      }`,
    );
    blocks.push("");
    blocks.push(
      `What would disprove it: ${
        disprove
          ? stripInternalJargon(disprove)
          : "independent customer-health or operational data showing the same decline."
      }`,
    );
    blocks.push("");
  }
  if (primary) {
    blocks.push(
      `Leading view (${Math.round((primary.probability_0_1 || 0) * 100)}%): ${stripInternalJargon(primary.statement)}`,
    );
  }
  return blocks.join("\n").trim();
}

function stripInternalJargon(text: string): string {
  return String(text || "")
    .replace(/\b(facet|gateOk|trajectory|readiness_score|pattern_id|causal_cluster)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
