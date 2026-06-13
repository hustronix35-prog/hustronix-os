"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type ScenarioId = "delayed" | "conflict" | "ownership";

const SCENARIOS: {
  id: ScenarioId;
  label: string;
  trigger: string;
  sources: string[];
  insight: string;
  graph: string[];
  action: string;
  confidence: string;
}[] = [
  {
    id: "delayed",
    label: "Delayed initiative",
    trigger: "Q2 launch slipped 3 weeks with no owner update in Jira.",
    sources: ["Jira · EPIC-204", "Slack · #launch-war-room", "Notion · PRD v3"],
    insight:
      "Marketing still references the old milestone in last week's campaign brief. Engineering is blocked on an unapproved spec delta.",
    graph: [
      "Initiative: Q2 Launch → blocked by Spec approval",
      "Owner: unset on customer escalation sub-task",
      "Decision D-118 (Feb) not linked to current sprint scope",
    ],
    action:
      "Escalate to ops lead · Reconcile priority in Mission Control · Notify #launch-war-room with DRI assignment",
    confidence: "High — 3 corroborating signals in 48h",
  },
  {
    id: "conflict",
    label: "Conflicting priorities",
    trigger: "Sales pipeline push conflicts with product freeze communicated in Slack.",
    sources: ["HubSpot · deal stage change", "Slack · #product", "Linear · freeze label"],
    insight:
      "Two active commitments share overlapping owners with deadlines 9 days apart. No leadership decision record resolves the conflict.",
    graph: [
      "Commitment A: Enterprise upsell (Sales)",
      "Commitment B: Stability freeze (Product)",
      "Overlap: shared eng capacity, no arbiter",
    ],
    action:
      "Surface decision record · Request leadership commit · Pause conflicting execution paths until resolved",
    confidence: "High — explicit conflict in context graph",
  },
  {
    id: "ownership",
    label: "Ownership ambiguity",
    trigger: "Customer escalation thread has 4 participants, zero assigned DRI.",
    sources: ["Gmail · escalation thread", "Slack · #support", "CRM · account tier"],
    insight:
      "No ledger entry ties this escalation to an active decision. Similar pattern preceded a 12-day slip last quarter.",
    graph: [
      "Thread participants: 4 · DRI: none",
      "Related initiative: Platform reliability (no owner)",
      "SLA risk: 36h without assignment",
    ],
    action:
      "Assign DRI · Link to active decision · Start execution trace with SLA and notify leadership view",
    confidence: "Medium-high — pattern match + SLA timer",
  },
];

export function WorkflowDriftDemo({ className }: { className?: string }) {
  const [active, setActive] = useState<ScenarioId>("delayed");
  const scenario = SCENARIOS.find((s) => s.id === active) ?? SCENARIOS[0];

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.1] bg-[#080808]/95 p-5 md:p-8 lg:p-10",
        className,
      )}
    >
      <div className="flex flex-wrap gap-2 md:gap-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            className={cn(
              "rounded-full border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors",
              active === s.id
                ? "border-landing-gold/45 bg-landing-gold/12 text-landing-gold"
                : "border-white/10 bg-black/40 text-hx-muted hover:border-white/20 hover:text-hx-text",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="space-y-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-landing-gold/90">
              Signal detected
            </p>
            <p className="mt-2 text-base leading-relaxed text-hx-text">{scenario.trigger}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {scenario.sources.map((src) => (
                <li
                  key={src}
                  className="rounded-md border border-white/[0.08] bg-black/50 px-2.5 py-1 font-mono text-[10px] text-hx-muted md:text-xs"
                >
                  {src}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-hx-muted">
              Reasoning
            </p>
            <p className="mt-2 text-sm leading-relaxed text-hx-muted/90 md:text-base">
              {scenario.insight}
            </p>
          </div>
        </div>

        <div className="space-y-5 rounded-xl border border-white/[0.08] bg-black/45 p-5 md:p-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-hx-muted">
              Context graph (excerpt)
            </p>
            <ul className="mt-3 space-y-2 font-mono text-xs leading-relaxed text-hx-text/85 md:text-sm">
              {scenario.graph.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-landing-gold/60" aria-hidden>
                    →
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-white/[0.06] pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--landing-accent-green)]">
              Recommended execution path
            </p>
            <p className="mt-2 text-sm leading-relaxed text-hx-text/90 md:text-base">
              {scenario.action}
            </p>
          </div>
          <p className="text-xs text-hx-muted/70">
            Confidence: <span className="text-landing-gold/90">{scenario.confidence}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
