/**
 * Situation-specific Talk kernel — evidence, impact, and governed mutations.
 * Product Talk routing lives in talk/talk-orchestrator.ts. This module no longer
 * owns unknown-question fallback onto the current situation.
 */
import { db } from "../database.js";
import {
  mutationCreateDraftDecision,
  mutationCommitDecision,
  mutationCompleteDecision,
  mutationReverseDecision,
  mutationPatchDraftReasoning,
} from "../security/mutation-handlers.js";
import { SITUATION_PATTERNS } from "./situation-patterns.js";
import { buildTeamsIntelligence } from "./teams-intelligence.js";
import {
  buildInstitutionalMemoFromSituation,
  confirmHypothesesReviewed,
  confirmInstrumentation,
  describeValidationState,
  isCompleteableV3,
  loadDecisionMemo,
  satisfyNextValidation,
  sealCausalValidationIfReady,
  type SituationMemoInput,
} from "./situation-institutional.js";
import type { InstitutionalReasoningV3 } from "../institutional-reasoning.js";
import { getDecisionCompletionEligibility } from "../evaluation/completion-eligibility.js";
import { expectedOutcomeForSituation } from "../evaluation/expected-outcome.js";
import { getLatestDecisionOutcome } from "../evaluation/outcome-evaluation.js";
import { evaluateDecisionHoursFeasibility } from "../execution/feasibility.js";
import { getReadinessPrior } from "./readiness-learning.js";
import { buildOrgIntelligence } from "../org/intelligence.js";
import { resolveSituationImpact } from "./impact-resolver.js";
import { explainBottlenecks } from "../org/bottleneck-intelligence.js";
import { loadEvidenceReferences } from "./evidence-reference.js";
import { formatAlternativeHypotheses, formatEvidenceTrail } from "./talk-explanations.js";

export type SituationChatCard = {
  id: string;
  title: string;
  stage: string;
  confidence: number;
  trajectory: string;
  first_observed_day: number | null;
  explanation: string | null;
  facets: string[];
  entities?: string[];
  evidence: Array<{ sim_day: number | null; facet: string | null; snippet: string | null }>;
  decision_id: string | null;
  answer: string;
};

export type TalkAction = {
  id: string;
  label: string;
  kind:
    | "followup"
    | "create"
    | "execute"
    | "complete"
    | "reverse"
    | "validate"
    | "hypotheses"
    | "instrumentation"
    | "feasibility"
    | "outcome"
    | "learn";
  prompt?: string;
};

export type TalkIntent =
  | "company"
  | "brief"
  | "evidence"
  | "impact"
  | "blocked"
  | "recommend"
  | "create"
  | "validate"
  | "hypotheses"
  | "instrumentation"
  | "execute"
  | "complete"
  | "reverse"
  | "feasibility"
  | "outcome"
  | "learn";

export type TalkActionId =
  | "create_decision"
  | "execute"
  | "complete"
  | "reverse"
  | "validate"
  | "hypotheses"
  | "instrumentation"
  | "feasibility"
  | "outcome"
  | "learn";

export type TalkTurn = {
  question: string;
  intent: TalkIntent;
  grounded: boolean;
  answer: string;
  focus_id: string | null;
  decision_id: string | null;
  situations: SituationChatCard[];
  actions: TalkAction[];
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function stagePlain(stage: string): string {
  if (stage === "DECISION_READY" || stage === "DECIDED") return "decision-ready";
  if (stage === "ELEVATED") return "elevated";
  if (stage === "FORMING") return "forming";
  if (stage === "RESOLVED") return "resolved";
  return "early awareness";
}

function trajPlain(t: string): string {
  if (t === "WORSENING") return "worsening";
  if (t === "IMPROVING") return "improving";
  return "stable";
}

function loadRows(userId: string) {
  return db.rawGet(
    `SELECT * FROM situations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 40`,
    [userId],
  ) as Array<{
    id: string;
    title: string;
    pattern_id: string;
    stage: string;
    confidence: number;
    trajectory: string;
    first_observed_day: number | null;
    potential_impact: string | null;
    explanation: string | null;
    facets_json: string | null;
    entities_json: string | null;
    sources_json: string | null;
    people_json: string | null;
    teams_json: string | null;
    recommended_actions_json: string | null;
    decision_id: string | null;
    evidence_count: number;
  }>;
}

function loadEvidence(situationId: string) {
  return db.rawGet(
    `SELECT sim_day, facet, snippet FROM situation_evidence WHERE situation_id = ?
     ORDER BY COALESCE(sim_day, 0) ASC LIMIT 12`,
    [situationId],
  ) as Array<{ sim_day: number | null; facet: string | null; snippet: string | null }>;
}

function severity(stage: string, trajectory: string): number {
  let n = 0;
  if (stage === "DECIDED" || stage === "DECISION_READY") n = 5;
  else if (stage === "ELEVATED") n = 4;
  else if (stage === "FORMING") n = 3;
  else if (stage === "AWARENESS") n = 2;
  else if (stage === "RESOLVED") n = 0;
  if (trajectory === "WORSENING") n += 1;
  if (trajectory === "IMPROVING") n -= 1;
  return n;
}

function scoreRow(
  q: string,
  r: ReturnType<typeof loadRows>[number],
  facets: string[],
  entities: string[],
): number {
  const hay = `${r.title} ${facets.join(" ")} ${entities.join(" ")} ${r.explanation || ""}`.toLowerCase();
  let score = 0;
  for (const token of q.split(/\W+/).filter((t) => t.length > 2)) {
    if (hay.includes(token)) score += 1;
    if (entities.some((e) => e.toLowerCase().includes(token))) score += 2;
    if (r.title.toLowerCase().includes(token)) score += 1;
  }
  if (score > 0) {
    score += severity(r.stage, r.trajectory) * 0.15;
    score += (r.confidence || 0) * 0.5;
  }
  return score;
}

export function classifySituationIntent(question: string): TalkIntent {
  return classifyIntent(question);
}

function classifyIntent(question: string): TalkIntent {
  const q = question.toLowerCase();
  if (/\b(what did we learn|what have we learned|readiness prior)\b/.test(q)) return "learn";
  if (/\b(did it work|what was the outcome|outcome of (the |this )?decision)\b/.test(q)) return "outcome";
  if (/\b(it didn'?t work|reverse (the |this )?decision|undo (the |this )?decision)\b/.test(q)) {
    return "reverse";
  }
  if (
    /\b(mark as done|close this|it worked|complete (the )?decision|mark (it|this) (as )?(done|complete))\b/.test(
      q,
    )
  ) {
    return "complete";
  }
  if (/\b(can we (actually )?execute|is there capacity|are we overloaded|feasib)\b/.test(q)) {
    return "feasibility";
  }
  if (/\b(execute|commit|approve and execute|approve & execute)\b/.test(q)) return "execute";
  if (/\b(instrumentation|evidence is trustworthy|signals are trustworthy|instrumentation ok)\b/.test(q)) {
    return "instrumentation";
  }
  if (/\b(what else could be true|competing (explanation|hypothesis)|alternative hypothes)\b/.test(q)) {
    return "hypotheses";
  }
  if (/\b(validate|confirm the check|next validation|satisfy validation)\b/.test(q)) return "validate";
  if (/\b(create the decision|create a decision|draft the decision|open the decision)\b/.test(q)) {
    return "create";
  }
  if (/\b(who is blocked|who is waiting|where is the bottleneck|waiting on whom)\b/.test(q)) {
    return "blocked";
  }
  if (/\b(who is affected|who('s| is) involved|which teams|people affected)\b/.test(q)) return "impact";
  if (/\b(what evidence|why do you think|timeline|supports that|prove it)\b/.test(q)) return "evidence";
  if (/\b(what should we do|recommend|what do we do)\b/.test(q)) return "recommend";
  if (
    /\b(what('s| is) going wrong|what('s| is) happening in the company|what matters|overnight|executive (brief|update)|company)\b/.test(
      q,
    )
  ) {
    return "company";
  }
  return "brief";
}

function toCard(
  r: ReturnType<typeof loadRows>[number],
  facets: string[],
  entities: string[],
  sources: string[],
): SituationChatCard {
  const evidence = loadEvidence(r.id);
  const timeline = evidence
    .filter((e) => e.snippet)
    .map((e) => `• Day ${e.sim_day ?? "?"}: ${(e.snippet || "").slice(0, 120)}`)
    .join("\n");
  const answer = [
    `${r.title} is ${trajPlain(r.trajectory)} (stage: ${r.stage}).`,
    r.first_observed_day != null ? `First observed on day ${r.first_observed_day}.` : null,
    r.explanation || null,
    `Confidence: ${Math.round((r.confidence || 0) * 100)}%.`,
    facets.length ? `Evidence dimensions: ${facets.join(", ")}.` : null,
    entities.length ? `Entities: ${entities.join(", ")}.` : null,
    sources.length ? `Sources: ${sources.join(", ")}.` : null,
    timeline ? `Timeline:\n${timeline}` : null,
    r.decision_id
      ? `A decision is linked (${r.decision_id}).`
      : r.stage === "DECISION_READY" || r.stage === "DECIDED"
        ? "Decision-ready — create or open the recovery decision."
        : "Not decision-ready yet — continue accumulating evidence.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: r.id,
    title: r.title,
    stage: r.stage,
    confidence: r.confidence,
    trajectory: r.trajectory,
    first_observed_day: r.first_observed_day,
    explanation: r.explanation,
    facets,
    evidence,
    decision_id: r.decision_id,
    answer,
    entities: parseJsonArray(r.entities_json),
  };
}

/** Find situations matching a free-text question (entity / title / facet hints). */
export function findSituationsForQuestion(userId: string, question: string, limit = 3): SituationChatCard[] {
  const q = String(question || "").toLowerCase();
  const rows = loadRows(userId);
  const scored = rows
    .map((r) => {
      const facets = parseJsonArray(r.facets_json);
      const entities = parseJsonArray(r.entities_json);
      const sources = parseJsonArray(r.sources_json);
      return { r, facets, entities, sources, score: scoreRow(q, r, facets, entities) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ r, facets, entities, sources }) => toCard(r, facets, entities, sources));
}

function actionsFor(sit: SituationChatCard | null, intent: TalkIntent): TalkAction[] {
  const out: TalkAction[] = [];
  if (!sit) {
    return [
      {
        id: "company",
        label: "What's going wrong in the company?",
        kind: "followup",
        prompt: "What's going wrong in the company?",
      },
    ];
  }
  if (intent !== "evidence") {
    out.push({
      id: "evidence",
      label: "What evidence supports that?",
      kind: "followup",
      prompt: `What evidence supports ${sit.title}?`,
    });
  }
  if (intent !== "impact") {
    out.push({
      id: "who",
      label: "Who is affected?",
      kind: "followup",
      prompt: `Who is affected by ${sit.title}?`,
    });
  }
  if (intent !== "blocked") {
    out.push({
      id: "blocked",
      label: "Who is blocked?",
      kind: "followup",
      prompt: "Who is blocked?",
    });
  }
  if (intent !== "recommend") {
    out.push({
      id: "recommend",
      label: "What should we do?",
      kind: "followup",
      prompt: `What should we do about ${sit.title}?`,
    });
  }
  const ready = sit.stage === "DECISION_READY" || sit.stage === "DECIDED";
  if (ready && !sit.decision_id) {
    out.push({ id: "create", label: "Create the decision", kind: "create" });
  }
  if (sit.decision_id && sit.stage !== "RESOLVED") {
    const memo = loadDecisionMemo(sit.decision_id);
    const sealed = memo?.causal_validation?.complete === true;
    const status = String(db.getDecisionLedgerRow(sit.decision_id)?.status || "");
    if (!sealed) {
      if (intent !== "hypotheses") {
        out.push({
          id: "hypotheses",
          label: "What else could be true?",
          kind: "hypotheses",
          prompt: "What else could be true?",
        });
      }
      if (intent !== "instrumentation") {
        out.push({
          id: "instrumentation",
          label: "Instrumentation is OK",
          kind: "instrumentation",
          prompt: "Instrumentation is OK.",
        });
      }
      if (intent !== "validate") {
        out.push({
          id: "validate",
          label: "Validate next check",
          kind: "validate",
          prompt: "Validate the next check.",
        });
      }
    }
    if (sealed && intent !== "execute" && status !== "ACTIVE" && status !== "COMPLETED" && status !== "REVERSED") {
      out.push({ id: "execute", label: "Execute it", kind: "execute" });
      if (intent !== "feasibility") {
        out.push({
          id: "feasibility",
          label: "Can we execute this?",
          kind: "feasibility",
          prompt: "Can we actually execute this?",
        });
      }
    }
    if (status === "ACTIVE" && sit.decision_id) {
      const elig = getDecisionCompletionEligibility(sit.decision_id);
      if (elig.eligible && intent !== "complete") {
        out.push({
          id: "complete",
          label: "Mark as done",
          kind: "complete",
          prompt: "Mark as done.",
        });
      }
      if (intent !== "reverse") {
        out.push({
          id: "reverse",
          label: "It didn't work — reverse",
          kind: "reverse",
          prompt: "It didn't work. Reverse this decision.",
        });
      }
      if (intent !== "feasibility") {
        out.push({
          id: "feasibility",
          label: "Can we execute this?",
          kind: "feasibility",
          prompt: "Can we actually execute this?",
        });
      }
      if (intent !== "outcome") {
        out.push({
          id: "outcome",
          label: "Did it work?",
          kind: "outcome",
          prompt: "Did it work?",
        });
      }
    }
    if ((status === "COMPLETED" || status === "REVERSED") && intent !== "learn") {
      out.push({
        id: "learn",
        label: "What did we learn?",
        kind: "learn",
        prompt: "What did we learn?",
      });
      if (intent !== "outcome") {
        out.push({
          id: "outcome",
          label: "Did it work?",
          kind: "outcome",
          prompt: "Did it work?",
        });
      }
    }
    if (status === "UNDER_REVIEW" && intent !== "reverse") {
      out.push({
        id: "reverse",
        label: "Reverse this decision",
        kind: "reverse",
        prompt: "Reverse this decision.",
      });
    }
  }
  return out;
}

function briefParagraph(sit: SituationChatCard, entities: string[]): string {
  const conf = Math.round((sit.confidence || 0) * 100);
  const traj = trajPlain(sit.trajectory);
  const stage = stagePlain(sit.stage);
  const who = entities.length ? ` Involves ${entities.slice(0, 4).join(", ")}.` : "";
  return `${sit.title} is currently ${stage}. It developed from connected signals across the company. Confidence is ${conf}% and the trajectory is ${traj}.${who}`;
}

function evidenceAnswer(sit: SituationChatCard): string {
  return formatEvidenceTrail(sit.title, loadEvidenceReferences(sit.id, 12));
}

function impactAnswer(userId: string, sit: SituationChatCard, people: string[], teams: string[]): string {
  const impact = resolveSituationImpact(userId, sit.id);
  if (!impact) {
    const intel = buildTeamsIntelligence(userId);
    return intel.summary || `No impact graph available for ${sit.title} yet.`;
  }

  const lines: string[] = [`Who is affected by ${sit.title}:`];
  if (impact.entity) lines.push(`Entity: ${impact.entity}.`);
  if (impact.owner) lines.push(`Owner: ${impact.owner.name} (${impact.owner.team}).`);
  if (impact.affected_teams.length) lines.push(`Affected teams: ${impact.affected_teams.join(", ")}.`);

  for (const p of impact.affected_people.slice(0, 6)) {
    lines.push(`• ${p.name} (${p.team}, ${p.role}) — ${p.reason}.`);
  }

  if (impact.waiting_on.length) {
    const bottleneck = explainBottlenecks(userId);
    if (bottleneck.talk && bottleneck.bottleneck) {
      lines.push("");
      lines.push(bottleneck.talk);
    } else {
      const first = impact.waiting_on[0];
      lines.push(
        `Dependency: ${first.from_team} is waiting on ${first.to_team}${
          first.blocker_work ? ` for ${first.blocker_work}` : ""
        } (${first.status}).`,
      );
    }
  }
  if (impact.evidence.length) {
    lines.push("");
    lines.push("Evidence:");
    for (const sn of impact.evidence.slice(0, 3)) lines.push(`• ${sn.slice(0, 160)}`);
  }
  if (lines.length === 1) {
    const intel = buildTeamsIntelligence(userId);
    lines.push(intel.summary || "No impact graph edges for this situation yet.");
  }
  return lines.join("\n");
}

function recommendAnswer(sit: SituationChatCard, recommended: string[]): string {
  const ready = sit.stage === "DECISION_READY" || sit.stage === "DECIDED";
  const recs = recommended.length
    ? recommended.slice(0, 4).map((r, i) => `${i + 1}. ${r}`)
    : ["Review the evidence trail with the owning teams.", "Create a governed decision only if this is still worsening."];
  const gate = ready
    ? "This is decision-ready. Create the decision, validate competing explanations and instrumentation in Talk, then execute."
    : "This is not decision-ready yet. Keep accumulating evidence before committing the ledger.";
  return [`Recommended next steps for ${sit.title}:`, "", ...recs, "", gate].join("\n");
}

function companyAnswer(cards: SituationChatCard[]): string {
  const live = cards.filter((c) => c.stage !== "RESOLVED");
  if (!live.length) {
    return "Nothing material is forming on the situation ledger yet. New signals will show up here as they connect.";
  }
  const lines = live.slice(0, 5).map((c, i) => {
    return `${i + 1}. ${c.title} — ${stagePlain(c.stage)}, ${trajPlain(c.trajectory)} (${Math.round((c.confidence || 0) * 100)}% confidence).`;
  });
  return [
    "Here's what's developing in the company:",
    "",
    ...lines,
    "",
    "Ask about any of these. I can show evidence, who is affected, what to do, then validate and execute a decision.",
  ].join("\n");
}

function competingTitles(userId: string, entities: string[], selfId: string): string[] {
  const keys = new Set(entities.map((e) => e.toLowerCase()).filter(Boolean));
  if (!keys.size) return [];
  const rows = loadRows(userId);
  const out: string[] = [];
  for (const r of rows) {
    if (r.id === selfId || r.stage === "RESOLVED") continue;
    const ents = parseJsonArray(r.entities_json).map((e) => e.toLowerCase());
    if (ents.some((e) => keys.has(e))) out.push(r.title);
  }
  return out.slice(0, 4);
}

function memoInput(
  userId: string,
  row: ReturnType<typeof loadRows>[number],
  extra?: { proposed_tasks?: unknown },
): SituationMemoInput {
  return {
    id: row.id,
    title: row.title,
    pattern_id: row.pattern_id,
    stage: row.stage,
    confidence: row.confidence,
    trajectory: row.trajectory,
    explanation: row.explanation,
    first_observed_day: row.first_observed_day,
    facets: parseJsonArray(row.facets_json),
    entities: parseJsonArray(row.entities_json),
    recommended: parseJsonArray(row.recommended_actions_json),
    evidence: loadEvidence(row.id),
    competingTitles: competingTitles(userId, parseJsonArray(row.entities_json), row.id),
    proposed_tasks: extra?.proposed_tasks,
  };
}

function persistMemo(userId: string, decisionId: string, memo: InstitutionalReasoningV3) {
  mutationPatchDraftReasoning(userId, decisionId, memo as unknown as Record<string, unknown>);
}

function upgradeMemo(userId: string, decisionId: string, row: ReturnType<typeof loadRows>[number]): InstitutionalReasoningV3 {
  const existing = loadDecisionMemo(decisionId);
  const proposed =
    existing && (existing as InstitutionalReasoningV3 & { proposed_tasks?: unknown }).proposed_tasks
      ? (existing as InstitutionalReasoningV3 & { proposed_tasks?: unknown }).proposed_tasks
      : undefined;
  if (isCompleteableV3(existing) && existing.ranked_hypotheses.length >= 3) return existing;
  const memo = buildInstitutionalMemoFromSituation(memoInput(userId, row, { proposed_tasks: proposed }));
  persistMemo(userId, decisionId, memo);
  return loadDecisionMemo(decisionId) || memo;
}

function ensureDraft(userId: string, row: ReturnType<typeof loadRows>[number]): { id: string; created: boolean } {
  if (row.decision_id) {
    upgradeMemo(userId, row.decision_id, row);
    return { id: row.decision_id, created: false };
  }
  const pattern = SITUATION_PATTERNS.find((p) => p.id === row.pattern_id);
  const recs = parseJsonArray(row.recommended_actions_json);
  const vow = pattern?.vow || `Address ${row.title} with linked evidence.`;
  const tasks = pattern?.tasks?.map((t) => ({
    type: "ACTION" as const,
    owner: t.owner,
    weight: t.weight ?? 1,
    success_condition: t.success_condition,
  })) || [
    {
      type: "ACTION" as const,
      owner: "Unassigned",
      weight: 1,
      success_condition: recs[0] || `Evidence review for ${row.title}`,
    },
  ];
  const memo = buildInstitutionalMemoFromSituation(memoInput(userId, row, { proposed_tasks: tasks }));
  const draft = mutationCreateDraftDecision(userId, {
    vow,
    expected_outcomes: [
      expectedOutcomeForSituation({ title: row.title, trajectory: row.trajectory, windowDays: 14 }),
    ],
    constraints: pattern?.constraints || ["Do not ignore later contradictory evidence"],
    materializeTasks: false,
    tasks,
    institutional_reasoning: memo,
    reversal_conditions: "Improving evidence or explicit resolve",
  });
  db.rawRun(`UPDATE situations SET decision_id = ?, stage = 'DECIDED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    draft.id,
    row.id,
  ]);
  upgradeMemo(userId, draft.id, { ...row, decision_id: draft.id });
  return { id: draft.id, created: true };
}

/**
 * Situation-specific Talk kernel: evidence, impact, and governed mutations.
 * Product Talk entry is `talkToHustronix` in talk-orchestrator.ts.
 */
export function talkSituationKernel(
  userId: string,
  question: string,
  opts?: { focusId?: string | null; action?: TalkActionId | null },
): TalkTurn {
  const q = String(question || "").trim();
  const intent =
    opts?.action === "create_decision"
      ? "create"
      : opts?.action === "execute"
        ? "execute"
        : opts?.action === "complete"
          ? "complete"
          : opts?.action === "reverse"
            ? "reverse"
            : opts?.action === "feasibility"
              ? "feasibility"
              : opts?.action === "outcome"
                ? "outcome"
                : opts?.action === "learn"
                  ? "learn"
                  : opts?.action === "validate"
          ? "validate"
          : opts?.action === "hypotheses"
            ? "hypotheses"
            : opts?.action === "instrumentation"
              ? "instrumentation"
              : classifyIntent(q);
  const rows = loadRows(userId);
  const decorated = rows.map((r) => {
    const facets = parseJsonArray(r.facets_json);
    const entities = parseJsonArray(r.entities_json);
    const sources = parseJsonArray(r.sources_json);
    const people = parseJsonArray(r.people_json);
    const teams = parseJsonArray(r.teams_json);
    const recommended = parseJsonArray(r.recommended_actions_json);
    return {
      r,
      facets,
      entities,
      sources,
      people,
      teams,
      recommended,
      score: scoreRow(q.toLowerCase(), r, facets, entities),
      sev: severity(r.stage, r.trajectory),
    };
  });

  const companyCards = [...decorated]
    .sort((a, b) => b.sev - a.sev)
    .filter((x) => x.r.stage !== "RESOLVED")
    .slice(0, 5)
    .map((x) => toCard(x.r, x.facets, x.entities, x.sources));

  const scoredHit = [...decorated].filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0] || null;
  const focused = decorated.find((x) => x.r.id === opts?.focusId) || null;
  const followup =
    intent === "evidence" ||
    intent === "impact" ||
    intent === "recommend" ||
    intent === "create" ||
    intent === "execute" ||
    intent === "complete" ||
    intent === "reverse" ||
    intent === "feasibility" ||
    intent === "outcome" ||
    intent === "learn" ||
    intent === "validate" ||
    intent === "hypotheses" ||
    intent === "instrumentation";
  let focus = followup ? focused || scoredHit : scoredHit || focused;
  if (
    !focus &&
    (intent === "create" ||
      intent === "execute" ||
      intent === "complete" ||
      intent === "reverse" ||
      intent === "feasibility" ||
      intent === "outcome" ||
      intent === "learn" ||
      intent === "validate" ||
      intent === "hypotheses" ||
      intent === "instrumentation")
  ) {
    focus =
      [...decorated]
        .filter((x) => x.r.stage === "DECISION_READY" || x.r.stage === "DECIDED")
        .sort((a, b) => b.sev - a.sev)[0] ||
      [...decorated].sort((a, b) => b.sev - a.sev)[0] ||
      null;
  }

  if (intent === "blocked") {
    const report = explainBottlenecks(userId);
    return {
      question: q,
      intent: "blocked",
      grounded: Boolean(report.bottleneck || report.chain.length),
      answer: report.talk,
      focus_id: report.situationId || companyCards[0]?.id || null,
      decision_id: null,
      situations: companyCards,
      actions: actionsFor(companyCards[0] || null, "blocked"),
    };
  }

  if (intent === "company" || (!focus && intent === "brief")) {
    const situations = companyCards;
    return {
      question: q,
      intent: "company",
      grounded: situations.length > 0,
      answer: companyAnswer(situations),
      focus_id: situations[0]?.id || null,
      decision_id: situations[0]?.decision_id || null,
      situations,
      actions: actionsFor(situations[0] || null, "company"),
    };
  }

  if (!focus) {
    return {
      question: q,
      intent,
      grounded: companyCards.length > 0,
      answer:
        companyCards.length > 0
          ? `I don't have a matching situation for that yet.\n\n${companyAnswer(companyCards)}`
          : "No matching situation object yet — signals may still be accumulating.",
      focus_id: companyCards[0]?.id || null,
      decision_id: null,
      situations: companyCards,
      actions: actionsFor(companyCards[0] || null, intent),
    };
  }

  const sit = toCard(focus.r, focus.facets, focus.entities, focus.sources);
  let decisionId = sit.decision_id;
  let answer = "";

  if (intent === "create") {
    const ready = sit.stage === "DECISION_READY" || sit.stage === "DECIDED" || !!focus.r.decision_id;
    if (!ready) {
      answer = `${sit.title} is ${stagePlain(sit.stage)} — not decision-ready yet. I won't mint a ledger decision until the evidence supports it.`;
    } else {
      const d = ensureDraft(userId, { ...focus.r, decision_id: focus.r.decision_id });
      decisionId = d.id;
      sit.decision_id = d.id;
      sit.stage = "DECIDED";
      const memo = loadDecisionMemo(d.id);
      answer = d.created
        ? `Created a DRAFT decision for ${sit.title}. It is on the ledger. Next: review competing explanations and confirm instrumentation — then execute.`
        : `A decision already exists for ${sit.title}. Next: validate it in Talk, then execute.`;
      if (memo) answer += `\n\n${describeValidationState(memo)}`;
    }
  } else if (intent === "hypotheses" || intent === "validate" || intent === "instrumentation") {
    const ready = sit.stage === "DECISION_READY" || sit.stage === "DECIDED" || !!focus.r.decision_id;
    if (!ready) {
      answer = `${sit.title} is not decision-ready yet — nothing to validate.`;
    } else {
      const d = ensureDraft(userId, { ...focus.r, decision_id: focus.r.decision_id });
      decisionId = d.id;
      sit.decision_id = d.id;
      const status = String(db.getDecisionLedgerRow(d.id)?.status || "DRAFT");
      if (status === "ACTIVE") {
        answer = `Already executed. The decision for ${sit.title} is ACTIVE.`;
      } else {
      const memo = upgradeMemo(userId, d.id, { ...focus.r, decision_id: d.id });
      if (intent === "hypotheses") {
        confirmHypothesesReviewed(memo);
        persistMemo(userId, d.id, memo);
        const sealed = sealCausalValidationIfReady(userId, memo);
        persistMemo(userId, d.id, memo);
        const hyps = formatAlternativeHypotheses(memo.ranked_hypotheses);
        answer = [
          `Competing explanations for ${sit.title}:`,
          "",
          hyps,
          "",
          sealed.sealed
            ? "Validation is complete. You can execute."
            : sealed.gap || describeValidationState(memo),
        ].join("\n");
      } else if (intent === "instrumentation") {
        confirmInstrumentation(memo);
        persistMemo(userId, d.id, memo);
        const sealed = sealCausalValidationIfReady(userId, memo);
        persistMemo(userId, d.id, memo);
        answer = sealed.sealed
          ? `Instrumentation confirmed for ${sit.title}. Validation is complete. You can execute — this commits the decision and spawns governed tasks.`
          : `Instrumentation confirmed for ${sit.title}.\n\n${sealed.gap || describeValidationState(memo)}`;
      } else {
        const step = satisfyNextValidation(memo);
        persistMemo(userId, d.id, memo);
        const sealed = sealCausalValidationIfReady(userId, memo);
        persistMemo(userId, d.id, memo);
        answer = step.did
          ? `Recorded: ${step.description}.\n\n${sealed.sealed ? "Validation is complete. You can execute." : describeValidationState(memo)}`
          : sealed.sealed
            ? "All validation checks are already satisfied. You can execute."
            : describeValidationState(memo);
      }
      }
    }
  } else if (intent === "execute") {
    const d = sit.decision_id || (sit.stage === "DECISION_READY" ? ensureDraft(userId, focus.r).id : null);
    if (!d) {
      answer = `${sit.title} has no decision to execute yet. It needs to be decision-ready first.`;
    } else {
      decisionId = d;
      sit.decision_id = d;
      const row = db.getDecisionLedgerRow(d);
      if (String(row?.status || "") === "COMPLETED") {
        answer = `Already completed. The decision for ${sit.title} is COMPLETED.`;
      } else if (String(row?.status || "") === "ACTIVE") {
        const elig = getDecisionCompletionEligibility(d);
        if (elig.eligible) {
          answer = `Already executed. All ${elig.taskCount} governed task${elig.taskCount === 1 ? " is" : "s are"} DONE for ${sit.title}. Confirm with Mark as done — I will not auto-complete.`;
        } else {
          const open = elig.openOrFailed.length;
          answer = `Already executed. The decision for ${sit.title} is ACTIVE with ${elig.taskCount} governed task${elig.taskCount === 1 ? "" : "s"} (${elig.doneCount} done${open ? `, ${open} still open or killed` : ""}).`;
        }
      } else {
      const memo = upgradeMemo(userId, d, { ...focus.r, decision_id: d });
      const sealed = sealCausalValidationIfReady(userId, memo);
      persistMemo(userId, d, memo);
      if (!sealed.sealed) {
        answer = `Could not execute yet — governance is incomplete.\n\n${sealed.gap || describeValidationState(memo)}\n\nI will not skip causal validation. Confirm the remaining checks in Talk.`;
      } else {
        try {
          mutationCommitDecision(userId, d, "Executed from Talk to Hustronix");
          const tasks = db.rawGet(
            `SELECT COUNT(*) AS c FROM execution_ledger WHERE decision_id = ?`,
            [d],
          ) as { c: number }[];
          const n = Number(tasks[0]?.c || 0);
          const feas = evaluateDecisionHoursFeasibility(userId, d);
          answer = `Executed. The decision for ${sit.title} is ACTIVE${n ? ` with ${n} governed task${n === 1 ? "" : "s"} on the execution ledger` : ""}.`;
          if (!feas.ok) answer += `\n\nCapacity: ${feas.message}`;
        } catch (e) {
          answer = `Could not execute: ${e instanceof Error ? e.message : String(e)}. Remaining checks stay on this DRAFT — I did not skip the gate.`;
        }
      }
      }
    }
  } else if (intent === "complete") {
    const d = sit.decision_id;
    if (!d) {
      answer = `${sit.title} has no decision to complete yet.`;
    } else {
      decisionId = d;
      const elig = getDecisionCompletionEligibility(d);
      if (String(db.getDecisionLedgerRow(d)?.status || "") === "COMPLETED") {
        answer = `Already completed. The decision for ${sit.title} is COMPLETED.`;
      } else if (!elig.eligible) {
        answer = `Cannot complete yet.\n\n${elig.reason}\n\nThe decision stays ACTIVE until every governed task is DONE. I will not auto-complete.`;
      } else {
        try {
          mutationCompleteDecision(userId, d, "Completed from Talk to Hustronix");
          const outcome = getLatestDecisionOutcome(d);
          const result = outcome?.result ? ` Result: ${outcome.result}.` : "";
          const notes = outcome?.learning_notes ? ` ${outcome.learning_notes}` : "";
          answer = `Completed. The decision for ${sit.title} is COMPLETED.${result}${notes}`.trim();
        } catch (e) {
          answer = `Could not complete: ${e instanceof Error ? e.message : String(e)}. The decision stays ACTIVE.`;
        }
      }
    }
  } else if (intent === "reverse") {
    const d = sit.decision_id;
    if (!d) {
      answer = `${sit.title} has no decision to reverse.`;
    } else {
      decisionId = d;
      const status = String(db.getDecisionLedgerRow(d)?.status || "");
      if (status === "REVERSED") {
        answer = `Already reversed. The decision for ${sit.title} is REVERSED.`;
      } else {
        try {
          mutationReverseDecision(userId, d, "Reversed from Talk to Hustronix");
          const outcome = getLatestDecisionOutcome(d);
          const notes = outcome?.learning_notes ? ` ${outcome.learning_notes}` : "";
          answer = `Reversed. The decision for ${sit.title} is REVERSED. This is a terminal state — it will not silently retry.${notes}`.trim();
        } catch (e) {
          answer = `Could not reverse: ${e instanceof Error ? e.message : String(e)}.`;
        }
      }
    }
  } else if (intent === "feasibility") {
    const d = sit.decision_id;
    if (!d) {
      answer = `${sit.title} has no decision yet, so there is nothing to size against capacity.`;
    } else {
      decisionId = d;
      const feas = evaluateDecisionHoursFeasibility(userId, d);
      answer = feas.ok
        ? `Yes — this is feasible.\n\n${feas.message}`
        : `Not yet. Execution is constrained by capacity.\n\n${feas.message}`;
    }
  } else if (intent === "outcome") {
    const d = sit.decision_id;
    if (!d) {
      answer = `${sit.title} has no evaluated decision yet.`;
    } else {
      decisionId = d;
      const status = String(db.getDecisionLedgerRow(d)?.status || "");
      const outcome = getLatestDecisionOutcome(d);
      if (!outcome) {
        answer =
          status === "ACTIVE"
            ? `Not yet. The decision for ${sit.title} is still ACTIVE. Task completion is not business success — mark it done when the work is finished, then I will compare expected vs actual.`
            : `No outcome recorded yet for ${sit.title}.`;
      } else {
        answer = `Did it work? ${String(outcome.result || "inconclusive").toUpperCase()}.\n\n${outcome.learning_notes || ""}`.trim();
      }
    }
  } else if (intent === "learn") {
    const prior = getReadinessPrior(userId, focus.r.pattern_id);
    const outcome = sit.decision_id ? getLatestDecisionOutcome(sit.decision_id) : null;
    const lines = [
      `What we learned from ${sit.title}:`,
      outcome?.learning_notes || "No evaluated decision outcome yet.",
      "",
      prior.sample_count
        ? `Pattern prior (${prior.pattern_id}): ${prior.explanation} Samples ${prior.sample_count} (${prior.successful_count} successful / ${prior.failed_count} failed). Gates are never bypassed.`
        : "No bounded readiness prior yet — need 5 successful/failed outcomes on this pattern before the floor moves.",
    ];
    answer = lines.join("\n");
  } else if (intent === "evidence") {
    answer = evidenceAnswer(sit);
  } else if (intent === "impact") {
    answer = impactAnswer(userId, sit, focus.people, focus.teams);
  } else if (intent === "recommend") {
    answer = recommendAnswer(sit, focus.recommended);
  } else {
    answer = briefParagraph(sit, focus.entities);
  }

  return {
    question: q,
    intent,
    grounded: true,
    answer,
    focus_id: sit.id,
    decision_id: decisionId,
    situations: [sit],
    actions: actionsFor(sit, intent),
  };
}

/** Tests and probes that import the kernel directly. Product Talk uses the orchestrator. */
export { talkSituationKernel as talkToHustronix };
