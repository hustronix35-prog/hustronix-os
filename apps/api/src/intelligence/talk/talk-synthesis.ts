/**
 * Talk LLM synthesis — grounded reasoning over a bounded Company Brain packet.
 * Falls back to template answers when disabled, budget-limited, or validation fails.
 */
import { chat, hasLlmCredentials, type ModelTier } from "../../llm.js";
import { validateLlmInput, validateLlmOutput } from "../../security/llm-output-firewall.js";
import { wrapUntrustedContent } from "../../security/prompt-injection.js";
import type { TalkIntent, TalkMode } from "./talk-intent.js";
import type { TalkContext } from "./talk-context.js";
import type { CompanyContext } from "./talk-retrieval.js";
import type { TalkReasoning } from "./talk-reasoning.js";
import { stripJargon } from "./talk-evidence.js";
import { nextThought } from "./talk-followups.js";

export type TalkEvidencePacket = {
  situations: Array<{ id: string; title: string; trajectory: string; entities: string[]; summary: string }>;
  evidence: Array<{ id: string; source: string; snippet: string }>;
  outcomes: Array<{ id: string; result: string; notes?: string | null }>;
  people: Array<{ id: string; name: string; team: string; blocked: number }>;
  customers: Array<{ id: string; name: string; worsening: boolean }>;
  decisions: Array<{ id: string; vow: string; status: string }>;
  dependencies: Array<{ id: string; fromTeam: string; toTeam: string; work: string; status: string }>;
  bottleneck: string | null;
  deterministic: {
    evidence: string[];
    reasoning: string[];
    recommendations: string[];
    ideas: Array<{ n: number; label: string; summary: string }>;
  };
};

export type TalkSynthesisJson = {
  evidence_used: string[];
  inferences: string[];
  alternatives: string[];
  recommendation: string;
  uncertainty: string;
  confidence: number;
  answer: string;
};

export type TalkSynthesisResult = {
  answer: string;
  synthesis: TalkSynthesisJson;
  modelTier: ModelTier;
  evidenceIds: string[];
};

const PREMIUM_MODES = new Set<TalkMode>(["STRATEGY", "COUNTERFACTUAL", "COMPARISON"]);

function talkLlmEnabled(): boolean {
  const v = process.env.TALK_LLM_SYNTHESIS?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (process.env.HUSTRONIX_INTEL_NO_LLM === "1" || process.env.HUSTRONIX_INTEL_NO_LLM === "true") return false;
  return true;
}

function talkEscalationEnabled(): boolean {
  const v = process.env.TALK_LLM_ESCALATE?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

export function shouldUseTalkLlm(intent: TalkIntent, ctx: CompanyContext): boolean {
  if (!talkLlmEnabled()) return false;
  if (intent.mode === "CASUAL") return false;
  if (intent.governedAction) return false;
  // Templates already cover GENERAL/LEARN well; LLM optional for HYBRID/COMPANY synthesis.
  if (intent.contextMode === "GENERAL") return false;
  if (!intent.requiresCompanyContext && intent.mode !== "FOLLOWUP") return false;
  return true;
}

export function resolveTalkModelTier(intent: TalkIntent, reasoned: TalkReasoning): ModelTier {
  if (!talkEscalationEnabled()) return "fast";
  if (PREMIUM_MODES.has(intent.mode)) return "premium";
  if (intent.isCounterfactual) return "premium";
  if (reasoned.provenance.confidence < 0.45) return "premium";
  return "fast";
}

export function buildEvidencePacket(
  ctx: CompanyContext,
  reasoned: TalkReasoning,
): { packet: TalkEvidencePacket; allowedCitations: Set<string> } {
  const allowedCitations = new Set<string>();
  const situations = ctx.situations.slice(0, 6).map((s) => {
    allowedCitations.add(`situation:${s.id}`);
    return {
      id: s.id,
      title: s.title,
      trajectory: s.trajectory,
      entities: s.entities,
      summary: (s.explanation || s.title).slice(0, 220),
    };
  });
  const evidence = ctx.evidence.slice(0, 8).map((e) => {
    allowedCitations.add(`signal:${e.signalId}`);
    return { id: e.signalId, source: e.source, snippet: e.snippet.slice(0, 240) };
  });
  const outcomes = ctx.outcomes.slice(0, 4).map((o) => {
    allowedCitations.add(`outcome:${o.decision_id}`);
    return { id: o.decision_id, result: o.result, notes: o.notes ?? null };
  });
  const people = ctx.people.slice(0, 6).map((p) => {
    const id = `person:${p.name.toLowerCase()}`;
    allowedCitations.add(id);
    return { id, name: p.name, team: p.team, blocked: p.blocked };
  });
  const customers = ctx.customers.slice(0, 4).map((c) => {
    const id = `customer:${c.name.toLowerCase()}`;
    allowedCitations.add(id);
    return { id, name: c.name, worsening: c.worsening };
  });
  const decisions = ctx.decisions.slice(0, 4).map((d) => {
    allowedCitations.add(`decision:${d.id}`);
    return { id: d.id, vow: d.vow.slice(0, 160), status: d.status };
  });
  const dependencies = ctx.dependencies.slice(0, 4).map((d, i) => {
    const id = `dependency:${i + 1}`;
    allowedCitations.add(id);
    return { id, fromTeam: d.fromTeam, toTeam: d.toTeam, work: d.work.slice(0, 120), status: d.status };
  });

  return {
    packet: {
      situations,
      evidence,
      outcomes,
      people,
      customers,
      decisions,
      dependencies,
      bottleneck: ctx.bottleneckTalk ? ctx.bottleneckTalk.slice(0, 400) : null,
      deterministic: {
        evidence: reasoned.evidence.slice(0, 8),
        reasoning: reasoned.reasoning.slice(0, 6),
        recommendations: reasoned.recommendations.slice(0, 4),
        ideas: reasoned.ideas.slice(0, 5).map((o) => ({ n: o.n, label: o.label, summary: o.summary })),
      },
    },
    allowedCitations,
  };
}

export function parseTalkSynthesisJson(text: string): TalkSynthesisJson | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(raw.slice(first, last + 1));
      } catch {
        return null;
      }
    }
  }
  return coerceTalkSynthesis(parsed);
}

function asStringArray(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function coerceTalkSynthesis(v: unknown): TalkSynthesisJson | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const answer = String(o.answer || "").trim();
  if (!answer) return null;
  const confidenceRaw = Number(o.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  return {
    evidence_used: asStringArray(o.evidence_used, 12),
    inferences: asStringArray(o.inferences, 6),
    alternatives: asStringArray(o.alternatives, 4),
    recommendation: String(o.recommendation || "").trim(),
    uncertainty: String(o.uncertainty || "").trim(),
    confidence,
    answer,
  };
}

export function validateSynthesisCitations(
  synthesis: TalkSynthesisJson,
  allowed: Set<string>,
): { ok: boolean; invalid: string[] } {
  const invalid: string[] = [];
  for (const cite of synthesis.evidence_used) {
    const c = String(cite || "").trim();
    if (!c) continue;
    if (!allowed.has(c)) invalid.push(c);
  }
  if (synthesis.evidence_used.length > 0 && invalid.length === synthesis.evidence_used.length) {
    return { ok: false, invalid };
  }
  return { ok: invalid.length === 0, invalid };
}

function synthesisEvidenceIds(synthesis: TalkSynthesisJson): string[] {
  return synthesis.evidence_used
    .map((c) => {
      const m = /^signal:([^\s]+)/i.exec(c);
      return m ? m[1] : null;
    })
    .filter(Boolean) as string[];
}

function modeGuidance(mode: TalkMode, intent: TalkIntent): string {
  if (mode === "BRAINSTORM") {
    return "Offer structured options. Label them as possibilities, not committed decisions.";
  }
  if (mode === "COUNTERFACTUAL") {
    return "Stress-test the assumption against live evidence. Do not pretend signals disappear.";
  }
  if (mode === "CUSTOMER_ANALYSIS" || mode === "SITUATION_INVESTIGATION") {
    return "Separate evidence for vs against. Name uncertainty explicitly.";
  }
  if (mode === "LEARN" || mode === "GENERAL") {
    return "Teach or define clearly. Do NOT dump company situations unless contextMode is HYBRID. Offer to use the company as an example.";
  }
  if (mode === "STRATEGY") {
    return "Prioritize recommendations with clear ordering when multiple threads compete. Ground every point in packet situations/evidence. Lead with judgment, not a raw list.";
  }
  if (mode === "COMPANY_QA") {
    if (intent.objective === "basics" || intent.objective === "explain") {
      return "Explain the requested concept clearly. Then map it to live company threads only as examples — do not pretend they asked for a growth strategy.";
    }
    return "Answer the company question from the evidence. Summarize relevant live threads; do not invent a three-part sales playbook.";
  }
  if (mode === "FOLLOWUP") {
    return `Follow up on the prior thread${intent.deepen ? ` (${intent.deepen})` : ""}. Do not repeat the entire prior answer verbatim.`;
  }
  return "Answer naturally for a founder. No internal mode names or jargon.";
}

async function callTalkSynthesisLlm(
  userId: string,
  opts: {
    question: string;
    intent: TalkIntent;
    packet: TalkEvidencePacket;
    conversation?: TalkContext | null;
    insufficient: boolean;
    modelTier: ModelTier;
  },
): Promise<TalkSynthesisJson | null> {
  const inputCheck = validateLlmInput(opts.question);
  if (!inputCheck.allowed) return null;

  const recent = (opts.conversation?.recentMessages || [])
    .slice(-4)
    .map((t) => `${t.role}: ${t.text.slice(0, 280)}`)
    .join("\n");

  const reply = await chat(
    userId,
    [
      {
        role: "system",
        content: [
          "You are Hustronix Talk — a Company Brain reasoning assistant for a founder.",
          "Use ONLY the evidence packet. Do not invent accounts, decisions, approvals, deadlines, or financial figures.",
          "Answer the founder's actual question. Do not default to a retention/pipeline/expansion playbook unless they asked how to grow sales or similar.",
          "If they ask for basics/fundamentals/definitions, explain clearly first, then optionally map to live company threads as examples.",
          "If evidence is insufficient, say so plainly and stay useful.",
          "Output STRICT JSON only. No markdown fences. No prose outside JSON.",
          'Schema: {"evidence_used":["situation:uuid|signal:uuid|outcome:id|person:name|customer:name|decision:id|dependency:n"],',
          '"inferences":["..."], "alternatives":["..."], "recommendation":"...", "uncertainty":"...",',
          '"confidence":0.0-1.0, "answer":"founder-facing natural language (2-6 short paragraphs max)"}',
          "Cite packet ids in evidence_used when you rely on them.",
          modeGuidance(opts.intent.mode, opts.intent),
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Mode (internal): ${opts.intent.mode}`,
          `Question:\n${wrapUntrustedContent(opts.question, "talk_question")}`,
          recent ? `Recent conversation:\n${wrapUntrustedContent(recent, "talk_history")}` : null,
          opts.insufficient ? "Note: retrieval marked context as insufficient for this question." : null,
          `Evidence packet (trusted company data):\n${JSON.stringify(opts.packet)}`,
          "Return JSON only.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    [],
    undefined,
    { modelTier: opts.modelTier },
  );

  return parseTalkSynthesisJson(reply.text);
}

export async function synthesizeTalkAnswer(opts: {
  userId: string;
  question: string;
  intent: TalkIntent;
  ctx: CompanyContext;
  reasoned: TalkReasoning;
  conversation?: TalkContext | null;
  templateFallback: string;
}): Promise<TalkSynthesisResult | null> {
  const { userId, question, intent, ctx, reasoned, conversation, templateFallback } = opts;

  if (!shouldUseTalkLlm(intent, ctx)) return null;
  if (!hasLlmCredentials(userId)) return null;

  const { packet, allowedCitations } = buildEvidencePacket(ctx, reasoned);
  let tier = resolveTalkModelTier(intent, reasoned);

  try {
    let synthesis = await callTalkSynthesisLlm(userId, {
      question,
      intent,
      packet,
      conversation,
      insufficient: ctx.insufficient,
      modelTier: tier,
    });

    if (
      !synthesis &&
      tier === "fast" &&
      talkEscalationEnabled() &&
      PREMIUM_MODES.has(intent.mode)
    ) {
      tier = "premium";
      synthesis = await callTalkSynthesisLlm(userId, {
        question,
        intent,
        packet,
        conversation,
        insufficient: ctx.insufficient,
        modelTier: tier,
      });
    }

    if (!synthesis) return null;

    const cites = validateSynthesisCitations(synthesis, allowedCitations);
    if (!cites.ok && synthesis.evidence_used.length > 0) {
      console.warn("[talk-synthesis] citation mismatch:", cites.invalid.slice(0, 4));
      if (cites.invalid.length >= synthesis.evidence_used.length) return null;
    }

    const firewall = validateLlmOutput(synthesis.answer);
    if (!firewall.allowed) {
      console.warn("[talk-synthesis] firewall blocked:", firewall.blockedReasons.join(", "));
      return null;
    }

    const next = nextThought(intent, ctx, reasoned);
    const answer = stripJargon(
      synthesis.answer.includes(next) ? synthesis.answer : `${synthesis.answer.trim()}\n\n${next}`,
    );

    return {
      answer,
      synthesis,
      modelTier: tier,
      evidenceIds: synthesisEvidenceIds(synthesis).length
        ? synthesisEvidenceIds(synthesis)
        : reasoned.provenance.supportingEvidence,
    };
  } catch (err) {
    console.warn("[talk-synthesis] failed, using template:", err instanceof Error ? err.message : err);
    if (templateFallback) return null;
    return null;
  }
}
