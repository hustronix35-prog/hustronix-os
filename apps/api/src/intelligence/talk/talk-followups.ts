/**
 * Dynamic next thoughts — contextual, not a chatbot menu.
 */
import type { TalkAction } from "../situation-chat.js";
import type { TalkIntent } from "./talk-understanding.js";
import type { TalkReasoning } from "./talk-reasoning.js";
import type { CompanyContext } from "./talk-retrieval.js";

export function nextThought(intent: TalkIntent, ctx: CompanyContext, reasoned: TalkReasoning): string {
  if (intent.mode === "CASUAL") return "What's on your mind?";
  if (intent.mode === "LEARN" || intent.mode === "GENERAL") {
    if (intent.contextMode === "GENERAL") {
      return "Want me to map this onto your actual customers and pipeline next?";
    }
    return "We can go deeper on one account, or turn a lesson into a 30-day plan.";
  }
  if (intent.isCounterfactual) {
    return "If you want, we can put that assumption next to the live evidence and see what still holds.";
  }
  if (intent.mode === "BRAINSTORM") {
    return "If you want, give me a constraint — half the sales capacity, ignore one account — and I'll reshape the list.";
  }
  if (intent.mode === "STRATEGY") {
    return "If you want, I can work through your actual customers and pipeline and sketch the highest-leverage 30-day plan.";
  }
  if (intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION") {
    return "If you want, let's pressure-test that before doing anything.";
  }
  if (reasoned.uncertainties[0] && intent.contextMode !== "GENERAL") return reasoned.uncertainties[0];
  return "We can go deeper, or turn a recommendation into a governed decision when you're ready.";
}

export function followupActions(intent: TalkIntent, ctx: CompanyContext): TalkAction[] {
  if (intent.mode === "CASUAL") {
    return [
      { id: "worry", label: "What's worrying me right now?", kind: "followup", prompt: "What's worrying me right now?" },
      { id: "sales", label: "How can we increase sales?", kind: "followup", prompt: "How can I increase sales?" },
      { id: "teach", label: "Teach me enterprise sales", kind: "followup", prompt: "Teach me enterprise sales." },
    ];
  }
  if (intent.mode === "LEARN" || intent.mode === "GENERAL") {
    return [
      { id: "company", label: "Use our company as an example", kind: "followup", prompt: "Teach me sales using our company as an example." },
      { id: "increase", label: "How can we increase sales?", kind: "followup", prompt: "How can I increase sales?" },
      { id: "deeper", label: "Go deeper on conversion", kind: "followup", prompt: "Explain conversion and forecast quality." },
    ];
  }
  if (intent.mode === "BRAINSTORM" || intent.mode === "STRATEGY") {
    return [
      { id: "why", label: "What would you do?", kind: "followup", prompt: "What would you do?" },
      { id: "missing", label: "What am I missing?", kind: "followup", prompt: "What are we missing?" },
      { id: "wrong", label: "What if we're wrong?", kind: "followup", prompt: "What if that's wrong?" },
      { id: "option2", label: "Let's do option 2", kind: "followup", prompt: "Let's do option 2." },
    ];
  }
  if (intent.mode === "CUSTOMER_ANALYSIS" || intent.mode === "SITUATION_INVESTIGATION") {
    const actions: TalkAction[] = [
      { id: "evidence", label: "Show me the evidence", kind: "followup", prompt: "What evidence supports that?" },
      { id: "else", label: "What else could explain it?", kind: "followup", prompt: "What else could be true?" },
      { id: "who", label: "Who needs to act?", kind: "followup", prompt: "Who is affected?" },
    ];
    if (ctx.situations[0]?.stage === "DECISION_READY" || ctx.situations[0]?.decision_id) {
      actions.push({
        id: "validate",
        label: "Can we execute the response?",
        kind: "feasibility",
        prompt: "Can we actually execute this?",
      });
    }
    return actions;
  }
  if (intent.mode === "COUNTERFACTUAL") {
    return [
      { id: "hold", label: "What still holds?", kind: "followup", prompt: "What still holds if we do that?" },
      { id: "do", label: "Let's do it anyway", kind: "followup", prompt: "Let's do option 1." },
    ];
  }
  return [];
}
