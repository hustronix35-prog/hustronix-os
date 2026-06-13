"use client";

import { cn } from "@/lib/cn";
import { RevealStaggerItem, RevealStaggerList } from "@/components/landing/ScrollReveal";

const CASES = [
  {
    role: "Founders",
    question: "Is the company executing what we decided?",
    signals: "Board priorities vs. Slack/Jira reality, initiative slip, conflicting commitments.",
    outcome:
      "One operational picture: what is blocked, who owns it, and what needs a leadership decision today.",
  },
  {
    role: "Operations",
    question: "Where is execution drifting before it becomes a fire?",
    signals: "Cross-team dependencies, stale owners, meeting decisions that never hit the ledger.",
    outcome:
      "Drift detection with escalation paths—blockers surfaced while there is still runway.",
  },
  {
    role: "Product",
    question: "Did the roadmap commit actually ship?",
    signals: "Specs in Notion, tickets in Jira, status in standups—rarely one chain.",
    outcome:
      "Execution continuity from decision to verification, not another status dashboard.",
  },
  {
    role: "GTM",
    question: "Are we selling what product can actually deliver?",
    signals: "Pipeline pushes, launch dates, and engineering capacity in different tools.",
    outcome:
      "Aligned campaign, sales, and delivery priorities against the same live context.",
  },
] as const;

export function LandingUseCases({ className }: { className?: string }) {
  return (
    <RevealStaggerList
      className={cn("grid list-none gap-5 md:grid-cols-2 md:gap-6", className)}
    >
      {CASES.map((c) => (
        <RevealStaggerItem
          key={c.role}
          className="landing-glass-card rounded-2xl p-6 md:p-7"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-landing-gold">
            {c.role}
          </p>
          <h3 className="mt-3 text-lg font-semibold text-hx-text">{c.question}</h3>
          <div className="mt-5 space-y-4 text-sm leading-relaxed">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-hx-muted">
                Signals ingested
              </p>
              <p className="mt-1.5 text-hx-muted/85">{c.signals}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--landing-accent-green)]">
                What you get
              </p>
              <p className="mt-1.5 text-hx-text/90">{c.outcome}</p>
            </div>
          </div>
        </RevealStaggerItem>
      ))}
    </RevealStaggerList>
  );
}
