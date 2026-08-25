/**
 * Human-readable evidence packing. Technical fields stay internal.
 */
import { formatEvidenceLine, type EvidenceReference } from "../evidence-reference.js";
import type { CompanyContext, SituationContext } from "./talk-retrieval.js";

export function humanTrajectory(t: string): string {
  if (t === "WORSENING") return "getting worse";
  if (t === "IMPROVING") return "improving";
  return "holding steady";
}

export function humanStage(stage: string): string {
  if (stage === "DECISION_READY" || stage === "DECIDED") return "ready to decide";
  if (stage === "ELEVATED") return "elevated";
  if (stage === "FORMING") return "still forming";
  if (stage === "RESOLVED") return "resolved";
  return "early";
}

export function situationFact(s: SituationContext): string {
  const who = s.entities.filter((e) => !/^(sales|engineering|security|finance|product|support)$/i.test(e));
  const name = who[0] ? `${who[0]}: ${s.title}` : s.title;
  return `${name} is ${humanTrajectory(s.trajectory)}.`;
}

export function evidenceFacts(ctx: CompanyContext, limit = 4): string[] {
  const lines: string[] = [];
  for (const s of ctx.situations.slice(0, 3)) lines.push(situationFact(s));
  for (const ev of ctx.evidence.slice(0, 3)) lines.push(formatEvidenceLine(ev));
  for (const o of ctx.outcomes.slice(0, 2)) {
    if (o.result === "failed") {
      lines.push(`A similar move was tried before and did not improve the underlying outcome.`);
    } else if (o.result) {
      lines.push(`A prior related decision evaluated as ${o.result}.`);
    }
  }
  if (ctx.people.some((p) => /sales/i.test(p.team))) {
    const sales = ctx.people.filter((p) => /sales/i.test(p.team));
    if (sales.length) {
      const blocked = sales.filter((p) => p.blocked > 0);
      lines.push(
        blocked.length
          ? `Sales capacity is constrained — ${blocked[0].name} is blocked.`
          : `Sales has people on the graph; check capacity before adding work.`,
      );
    }
  }
  if (ctx.bottleneckTalk) {
    const first = ctx.bottleneckTalk.split("\n")[0];
    if (first) lines.push(first);
  }
  return unique(lines).slice(0, limit);
}

export function evidenceIds(ctx: CompanyContext): string[] {
  return ctx.evidence.map((e) => e.signalId).filter(Boolean).slice(0, 8);
}

export function stripJargon(text: string): string {
  return String(text || "")
    .replace(/\bCompany Brain\b/gi, "your company data")
    .replace(/\bin the Brain\b/gi, "in your company data")
    .replace(/\bthe Brain\b/gi, "your company data")
    .replace(/\bnot decision-ready\b/gi, "not enough evidence to recommend committing")
    .replace(/\bdecision-ready\b/gi, "ready to commit")
    .replace(/\bledger decision\b/gi, "decision")
    .replace(/\bfrom the ledger\b/gi, "from your company data")
    .replace(/\bonto your ledger\b/gi, "onto your company")
    .replace(/\bthe ledger\b/gi, "the decision record")
    .replace(/\bcommit(ting)? the ledger\b/gi, "committing a decision")
    .replace(/\bevidence reference\b/gi, "source")
    .replace(/\bDECISION_READY\b/g, "ready to decide")
    .replace(/\bgateOk\s*=\s*true\b/gi, "the checks line up")
    .replace(/\bpattern_id\b/gi, "pattern")
    .replace(/\bconfidence_0_1\b/gi, "confidence")
    .replace(/\bevidence_count\b/gi, "supporting information")
    .replace(/\bHSOG\b/g, "the operating loop");
}

/** Provenance-only lines (never invent polarity). */
export function provenanceLines(ctx: CompanyContext, limit = 6): string[] {
  return unique(ctx.evidence.map((e) => formatEvidenceLine(e))).slice(0, limit);
}

function unique(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export type { EvidenceReference };
