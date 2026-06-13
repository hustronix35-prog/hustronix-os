"use client";

import { cn } from "@/lib/cn";

export function FounderCredibility({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/88 p-8 backdrop-blur-xl md:p-10",
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.42em] text-landing-gold">
        Why Hustronix exists
      </p>
      <blockquote className="mt-6 text-lg font-medium leading-relaxed text-hx-text md:text-xl">
        Most enterprise systems capture data but fail to preserve operational
        understanding.
      </blockquote>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-hx-muted/85 md:text-base">
        <p>
          Teams accumulate signals in Slack, meetings, tickets, and docs—but
          decisions and blockers evaporate between channels. Execution fragments.
          Leadership loses line-of-sight. Priorities drift without anyone noticing
          until quarters slip.
        </p>
        <p>
          Hustronix was built to close that gap: a continuously updated operational
          context layer that connects signals, surfaces drift, and keeps execution
          accountable—not another dashboard, but infrastructure for how companies
          actually run.
        </p>
      </div>
    </div>
  );
}
