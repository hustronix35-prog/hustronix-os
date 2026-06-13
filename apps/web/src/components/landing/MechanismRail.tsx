"use client";

import { cn } from "@/lib/cn";

const STEPS = [
  {
    step: "01",
    title: "Connect company signals",
    body: "Slack, meetings, Notion, Jira, CRM, email, and GitHub feed one ingestion layer.",
    detail:
      "No rip-and-replace: Hustronix reads operational events from tools your teams already use and normalizes them into a single signal stream.",
  },
  {
    step: "02",
    title: "Build operational context",
    body: "Shared memory, execution relationships, and decision dependencies form a live graph.",
    detail:
      "The context engine links people, initiatives, and commitments so “who owns this?” and “what blocked it?” are answerable without another status meeting.",
  },
  {
    step: "03",
    title: "Detect execution drift",
    body: "Blocked priorities, ambiguous ownership, conflicts, delays, and communication gaps surface early.",
    detail:
      "Drift is measured against committed decisions—not generic sentiment. You see misalignment while there is still time to correct course.",
  },
  {
    step: "04",
    title: "Generate aligned intelligence",
    body: "Summaries, recommendations, prioritization, and escalation suggestions grounded in context.",
    detail:
      "LLM-assisted reasoning sits on top of a deterministic ledger: recommendations cite signals and decisions your team can verify.",
  },
  {
    step: "05",
    title: "Track follow-through",
    body: "Execution continuity and accountability—insight without follow-through is where most tools stop.",
    detail:
      "Transitions, owners, and verification states are recorded. Leadership sees what moved, not just what was discussed.",
  },
] as const;

export function MechanismRail() {
  return (
    <ol className="mt-10 space-y-0">
      {STEPS.map((item, i) => (
        <li
          key={item.step}
          className={cn(
            "relative grid gap-3 border-l border-landing-gold/25 py-6 pl-6 md:grid-cols-[4.5rem_1fr] md:gap-6 md:py-8 md:pl-8",
            i === 0 && "pt-0",
            i === STEPS.length - 1 && "pb-0",
          )}
        >
          <span className="absolute -left-px top-8 h-2 w-2 -translate-x-1/2 rounded-full bg-landing-gold md:top-10" aria-hidden />
          <span className="text-xs font-bold tabular-nums text-landing-gold md:pt-1">
            {item.step}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-hx-text">{item.title}</h3>
            <p className="mt-2 text-base leading-relaxed text-hx-text/90">
              {item.body}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-hx-muted/80">
              {item.detail}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
